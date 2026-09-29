// Loads the landmark-benchmark datasets shown in the Correspondences viewer.
//
// Every `correspondence_presets.json` found under <diff3f>/visualizations lists
// benchmark directions (source -> target). Each direction points at the files
// written by scripts/evaluate_landmark_benchmark.py plus two PLYs to display.
// All paths are relative to the Diff3F folder and must stay inside it.

import fsp from "node:fs/promises";
import path from "node:path";

const MANIFEST_NAME = "correspondence_presets.json";
const MAX_MANIFESTS = 100;
const MAX_DIRECTORIES = 5000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const REQUIRED_COLUMNS = [
  "label",
  "source_index",
  "target_gt_index",
  "predicted_target_index",
  "cosine_score",
  "target_error",
  "target_error_bbox_pct",
  "source_landmark_x",
  "source_landmark_y",
  "source_landmark_z",
  "target_landmark_x",
  "target_landmark_y",
  "target_landmark_z",
  "source_x",
  "source_y",
  "source_z",
  "target_gt_x",
  "target_gt_y",
  "target_gt_z",
  "pred_target_x",
  "pred_target_y",
  "pred_target_z",
];

// CSV column -> field name in the match metrics sent to the browser.
const METRIC_COLUMNS = {
  cosine_score: "cosineScore",
  second_cosine_score: "secondCosineScore",
  nn_margin: "nearestNeighborMargin",
  gt_cosine_score: "groundTruthCosineScore",
  gt_feature_rank: "groundTruthFeatureRank",
  target_error: "targetError",
  target_error_bbox: "targetErrorBBox",
  target_error_bbox_pct: "targetErrorBBoxPct",
  target_vertex_error: "targetVertexError",
  target_vertex_error_bbox: "targetVertexErrorBBox",
  source_snap_distance: "sourceSnapDistance",
  target_snap_distance: "targetSnapDistance",
};

const SUMMARY_STATS = {
  target_error_bbox: "targetErrorBBox",
  target_vertex_error_bbox: "targetVertexErrorBBox",
  cosine: "cosineScore",
  nn_margin: "nearestNeighborMargin",
  gt_feature_rank: "groundTruthFeatureRank",
};

export async function loadCorrespondencePresets(diff3fRoot) {
  const root = await fsp.realpath(path.resolve(diff3fRoot));
  const presets = [];
  const datasetIds = new Set();
  const presetIds = new Set();

  for (const manifestPath of await findManifests(root)) {
    const manifest = await readJson(root, manifestPath);
    if (manifest?.schemaVersion !== 1) throw new Error(`${manifestPath}: schemaVersion must be 1.`);
    const datasetId = requireId(manifest.id, `${manifestPath}: id`);
    if (datasetIds.has(datasetId)) throw new Error(`${manifestPath}: duplicate dataset id "${datasetId}".`);
    datasetIds.add(datasetId);
    if (!Array.isArray(manifest.presets) || manifest.presets.length === 0) {
      throw new Error(`${manifestPath}: presets must be a non-empty array.`);
    }

    for (const [index, raw] of manifest.presets.entries()) {
      const label = `${manifestPath}: presets[${index}]`;
      const id = requireId(raw?.id, `${label}.id`);
      if (presetIds.has(id)) throw new Error(`${label}: duplicate preset id "${id}".`);
      presetIds.add(id);
      presets.push(
        await loadPreset(root, raw, {
          id,
          label,
          datasetId,
          datasetTitle: requireText(manifest.title, `${manifestPath}: title`),
          manifestPath,
        }),
      );
    }
  }

  return { schemaVersion: 1, presets };
}

// Only the display PLYs of a valid preset can be downloaded through this route.
export async function resolveCorrespondenceAsset(diff3fRoot, requestedPath) {
  const relativePath = projectRelative(requestedPath, "asset path");
  if (path.posix.extname(relativePath).toLowerCase() !== ".ply") {
    throw new Error("Correspondence assets must be display-geometry PLY files.");
  }
  const { presets } = await loadCorrespondencePresets(diff3fRoot);
  const allowed = new Set(presets.flatMap((preset) => [preset.source.displayGeometry.path, preset.target.displayGeometry.path]));
  if (!allowed.has(relativePath)) {
    throw new Error("Asset is not a display geometry in a correspondence preset.");
  }
  const root = await fsp.realpath(path.resolve(diff3fRoot));
  return resolveFile(root, relativePath, "display geometry", [".ply"]);
}

async function loadPreset(root, raw, { id, label, datasetId, datasetTitle, manifestPath }) {
  const source = side(raw.source, `${label}.source`);
  const target = side(raw.target, `${label}.target`);
  if (source.name === target.name) throw new Error(`${label}: source and target names must differ.`);

  for (const [file, name, extensions] of [
    [source.indexGeometry, "source.indexGeometry", [".obj"]],
    [source.displayGeometry, "source.displayGeometry", [".ply"]],
    [target.indexGeometry, "target.indexGeometry", [".obj"]],
    [target.displayGeometry, "target.displayGeometry", [".ply"]],
  ]) {
    await resolveFile(root, file, `${label}.${name}`, extensions);
  }

  const benchmarkCsv = projectRelative(raw.benchmarkCsv, `${label}.benchmarkCsv`);
  const summaryJson = projectRelative(raw.summaryJson, `${label}.summaryJson`);
  await resolveFile(root, benchmarkCsv, `${label}.benchmarkCsv`, [".csv"]);
  await resolveFile(root, summaryJson, `${label}.summaryJson`, [".json"]);

  const summary = parseSummary(await readJson(root, summaryJson), source.name, target.name, summaryJson);
  const table = parseCsv(await readText(root, benchmarkCsv), benchmarkCsv);
  for (const column of REQUIRED_COLUMNS) {
    if (!table.headers.includes(column)) throw new Error(`${benchmarkCsv}: missing column "${column}".`);
  }
  const pckColumns = table.headers.filter((header) => header.startsWith("pck_"));
  const matches = table.rows.map((row, index) => parseMatch(row, `${benchmarkCsv}: row ${index + 2}`, summary, pckColumns));
  if (matches.length !== summary.numCommonLandmarks) {
    throw new Error(`${label}: CSV row count does not equal num_common_landmarks in the summary.`);
  }

  return {
    id,
    datasetId,
    datasetTitle,
    label: requireText(raw.label, `${label}.label`),
    manifestPath,
    source: sideOutput(source, summary.sourceVertexCount),
    target: sideOutput(target, summary.targetVertexCount),
    benchmarkCsv,
    summaryJson,
    summary,
    matches,
  };
}

function side(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object.`);
  return {
    name: requireText(value.name, `${label}.name`),
    indexGeometry: projectRelative(value.indexGeometry, `${label}.indexGeometry`),
    displayGeometry: projectRelative(value.displayGeometry, `${label}.displayGeometry`),
  };
}

function sideOutput(sideValue, vertexCount) {
  return {
    name: sideValue.name,
    vertexCount,
    indexGeometry: { path: sideValue.indexGeometry },
    displayGeometry: {
      path: sideValue.displayGeometry,
      assetUrl: `/api/correspondence-asset?path=${encodeURIComponent(sideValue.displayGeometry)}`,
    },
  };
}

function parseSummary(value, sourceName, targetName, label) {
  if (value?.source !== sourceName || value?.target !== targetName) {
    throw new Error(`${label}: summary direction ${value?.source} -> ${value?.target} does not match the manifest.`);
  }
  const statistics = {};
  for (const [prefix, name] of Object.entries(SUMMARY_STATS)) {
    statistics[name] = {};
    for (const stat of ["mean", "median", "std", "min", "max"]) {
      const number = value[`${prefix}_${stat}`];
      if (Number.isFinite(number)) statistics[name][stat] = number;
    }
  }
  const pckAtBBox = {};
  for (const [key, number] of Object.entries(value)) {
    const match = /^pck_at_(.+)_bbox$/.exec(key);
    if (match && Number.isFinite(number)) pckAtBBox[match[1]] = number;
  }
  return {
    numCommonLandmarks: requireCount(value.num_common_landmarks, `${label}.num_common_landmarks`, 0),
    commonLabels: Array.isArray(value.common_labels) ? value.common_labels : [],
    missingInSource: value.missing_in_source ?? [],
    missingInTarget: value.missing_in_target ?? [],
    sourceVertexCount: requireCount(value.source_geometry_rows, `${label}.source_geometry_rows`, 1),
    targetVertexCount: requireCount(value.target_geometry_rows, `${label}.target_geometry_rows`, 1),
    featureDimension: value.feature_dim,
    targetBBoxDiagonal: value.target_bbox_diagonal,
    top1ExactIndexRatio: value.top1_exact_index_ratio,
    pckAtBBox,
    statistics,
  };
}

function parseMatch(row, label, summary, pckColumns) {
  const index = (column, limit) => {
    const text = String(row[column] ?? "").trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || value >= limit) throw new Error(`${label}: ${column} is not a valid vertex index.`);
    return value;
  };
  const xyz = (prefix) =>
    ["x", "y", "z"].map((axis) => {
      const value = Number(row[`${prefix}_${axis}`]);
      if (!Number.isFinite(value)) throw new Error(`${label}: ${prefix}_${axis} is not a number.`);
      return value;
    });

  const metrics = { pckBBox: {} };
  for (const [column, name] of Object.entries(METRIC_COLUMNS)) {
    if (row[column] !== undefined && row[column] !== "") metrics[name] = Number(row[column]);
  }
  for (const column of pckColumns) {
    metrics.pckBBox[column.slice("pck_".length)] = String(row[column]).trim().toLowerCase() === "true";
  }

  return {
    label: requireText(row.label, `${label}: label`),
    sourceIndex: index("source_index", summary.sourceVertexCount),
    targetGroundTruthIndex: index("target_gt_index", summary.targetVertexCount),
    predictedTargetIndex: index("predicted_target_index", summary.targetVertexCount),
    sourceManual: xyz("source_landmark"),
    sourceVertex: xyz("source"),
    manualTarget: xyz("target_landmark"),
    targetGroundTruthVertex: xyz("target_gt"),
    predictedTarget: xyz("pred_target"),
    metrics,
  };
}

// Small RFC 4180 reader: quoted fields may contain commas, quotes ("") and newlines.
function parseCsv(text, label) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`${label}: unterminated quoted field.`);
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((item) => !(item.length === 1 && item[0].trim() === ""));
  if (nonEmpty.length < 2) throw new Error(`${label}: expected a header and at least one row.`);
  const headers = nonEmpty[0].map((header, i) => (i === 0 ? header.replace(/^﻿/, "") : header).trim());
  const rows = nonEmpty.slice(1).map((values, i) => {
    if (values.length !== headers.length) {
      throw new Error(`${label}: row ${i + 2} has ${values.length} fields, expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, j) => [header, values[j]]));
  });
  return { headers, rows };
}

async function findManifests(root) {
  const start = path.join(root, "visualizations");
  const found = [];
  let visited = 0;

  async function walk(directory) {
    visited += 1;
    if (visited > MAX_DIRECTORIES) throw new Error(`Stopped searching for ${MANIFEST_NAME} after ${MAX_DIRECTORIES} folders.`);
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === MANIFEST_NAME) {
        if (found.length >= MAX_MANIFESTS) throw new Error(`More than ${MAX_MANIFESTS} ${MANIFEST_NAME} files.`);
        found.push(path.relative(root, full).replaceAll("\\", "/"));
      }
    }
  }

  try {
    if (!(await fsp.stat(start)).isDirectory()) return [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  await walk(start);
  return found;
}

// A clean "a/b/c.ext" path: no drive letters, no leading slash, no "." or ".." parts.
function projectRelative(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a project-relative path.`);
  const text = value.trim();
  const portable = text.replaceAll("\\", "/");
  if (text.includes("\0") || path.win32.isAbsolute(text) || path.posix.isAbsolute(portable)) {
    throw new Error(`${label} must be project-relative.`);
  }
  const parts = portable.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} contains a disallowed path segment.`);
  }
  return parts.join("/");
}

async function resolveFile(root, relativePath, label, extensions) {
  if (!extensions.includes(path.posix.extname(relativePath).toLowerCase())) {
    throw new Error(`${label} must be one of: ${extensions.join(", ")}.`);
  }
  let real;
  try {
    real = await fsp.realpath(path.join(root, ...relativePath.split("/")));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist: ${relativePath}`);
    throw error;
  }
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} resolves outside the project.`);
  if (!(await fsp.stat(real)).isFile()) throw new Error(`${label} must be a file.`);
  return { absolutePath: real, projectRelativePath: relativePath };
}

async function readText(root, relativePath) {
  const file = path.join(root, ...relativePath.split("/"));
  if ((await fsp.stat(file)).size > MAX_TEXT_BYTES) throw new Error(`${relativePath} is larger than ${MAX_TEXT_BYTES} bytes.`);
  return fsp.readFile(file, "utf8");
}

async function readJson(root, relativePath) {
  const text = await readText(root, relativePath);
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`${relativePath}: invalid JSON (${error.message}).`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function requireId(value, label) {
  const id = requireText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error(`${label} may only contain letters, digits, ".", "_" and "-".`);
  }
  return id;
}

function requireCount(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}.`);
  return value;
}
