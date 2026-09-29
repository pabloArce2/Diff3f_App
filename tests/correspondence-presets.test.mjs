import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCorrespondencePresets,
  resolveCorrespondenceAsset,
} from "../server/correspondence-presets.mjs";

const CSV_FIELDS = [
  "label",
  "source_index",
  "target_gt_index",
  "predicted_target_index",
  "cosine_score",
  "second_cosine_score",
  "nn_margin",
  "gt_cosine_score",
  "gt_feature_rank",
  "target_error",
  "target_error_bbox",
  "target_error_bbox_pct",
  "target_vertex_error",
  "target_vertex_error_bbox",
  "source_snap_distance",
  "target_snap_distance",
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
  "pck_0.1",
];

test("loads a preset, parses quoted CSV fields and returns only project-relative paths", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fsp.rm(fixture.root, { recursive: true, force: true }));

  const payload = await loadCorrespondencePresets(fixture.root);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.presets.length, 1);

  const preset = payload.presets[0];
  assert.equal(preset.id, "source-to-target");
  assert.equal(preset.source.vertexCount, 2);
  assert.equal(preset.target.vertexCount, 3);
  assert.equal(preset.matches.length, 2);
  assert.equal(preset.matches[0].label, 'quoted "wing", left');
  assert.deepEqual(preset.matches[1].manualTarget, [0, 0, 0]);
  assert.deepEqual(preset.matches[1].targetGroundTruthVertex, [0, 1, 0]);
  assert.equal(preset.matches[1].metrics.targetError, 5);
  assert.equal(preset.matches[1].metrics.pckBBox["0.1"], false);
  assert.match(preset.source.displayGeometry.assetUrl, /^\/api\/correspondence-asset\?path=/);
  assert.ok(!JSON.stringify(payload).includes(fixture.root));
  assert.ok(!preset.source.displayGeometry.path.includes("\\"));

  const asset = await resolveCorrespondenceAsset(fixture.root, preset.source.displayGeometry.path);
  assert.equal(asset.projectRelativePath, fixture.paths.sourceDisplay);
  assert.equal(asset.absolutePath, await fsp.realpath(path.join(fixture.root, ...fixture.paths.sourceDisplay.split("/"))));
});

test("asset route refuses traversal, absolute paths, OBJ files and PLYs not listed in a preset", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fsp.rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    resolveCorrespondenceAsset(fixture.root, "../outside.ply"),
    /disallowed path segment/,
  );
  await assert.rejects(
    resolveCorrespondenceAsset(fixture.root, "C:\\outside\\mesh.ply"),
    /must be project-relative/,
  );
  await assert.rejects(
    resolveCorrespondenceAsset(fixture.root, fixture.paths.sourceIndex),
    /must be display-geometry PLY files/,
  );
  await assert.rejects(
    resolveCorrespondenceAsset(fixture.root, fixture.paths.unlistedDisplay),
    /not a display geometry/,
  );
});

test("rejects vertex indices outside the geometry", async (t) => {
  const fixture = await makeFixture(({ rows }) => {
    rows[1].predicted_target_index = 3;
  });
  t.after(() => fsp.rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(loadCorrespondencePresets(fixture.root), /predicted_target_index is not a valid vertex index/);
});

test("rejects a benchmark CSV without the required columns", async (t) => {
  const fixture = await makeFixture(({ columns }) => {
    columns.splice(columns.indexOf("pred_target_x"), 1);
  });
  t.after(() => fsp.rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(loadCorrespondencePresets(fixture.root), /missing column "pred_target_x"/);
});

test("rejects paths that leave the project and summaries that do not match the CSV", async (t) => {
  const traversalFixture = await makeFixture(({ manifest }) => {
    manifest.presets[0].source.displayGeometry = "../outside.ply";
  });
  t.after(() => fsp.rm(traversalFixture.root, { recursive: true, force: true }));
  await assert.rejects(loadCorrespondencePresets(traversalFixture.root), /disallowed path segment/);

  const directionFixture = await makeFixture(({ summary }) => {
    summary.target = "wrongTarget";
  });
  t.after(() => fsp.rm(directionFixture.root, { recursive: true, force: true }));
  await assert.rejects(loadCorrespondencePresets(directionFixture.root), /does not match the manifest/);

  const countFixture = await makeFixture(({ summary }) => {
    summary.num_common_landmarks = 3;
    summary.common_labels.push("not-in-csv");
  });
  t.after(() => fsp.rm(countFixture.root, { recursive: true, force: true }));
  await assert.rejects(loadCorrespondencePresets(countFixture.root), /CSV row count/);
});

async function makeFixture(mutate) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "correspondence-presets-"));
  const paths = {
    manifest: "visualizations/fixture/correspondence_presets.json",
    benchmark: "visualizations/fixture/source_to_target_landmark_benchmark.csv",
    summary: "visualizations/fixture/source_to_target_landmark_summary.json",
    sourceIndex: "meshes/source.obj",
    targetIndex: "meshes/target.obj",
    sourceDisplay: "visualizations/colors/source.ply",
    targetDisplay: "visualizations/colors/target.ply",
    unlistedDisplay: "visualizations/colors/unlisted.ply",
  };

  const manifest = {
    schemaVersion: 1,
    id: "fixture-dataset",
    title: "Fixture dataset",
    presets: [
      {
        id: "source-to-target",
        label: "Source to target",
        source: {
          name: "source",
          indexGeometry: paths.sourceIndex,
          displayGeometry: paths.sourceDisplay,
        },
        target: {
          name: "target",
          indexGeometry: paths.targetIndex,
          displayGeometry: paths.targetDisplay,
        },
        benchmarkCsv: paths.benchmark,
        summaryJson: paths.summary,
      },
    ],
  };

  const sqrt18 = Math.sqrt(18);
  const rows = [
    {
      label: 'quoted "wing", left',
      source_index: 0,
      target_gt_index: 0,
      predicted_target_index: 0,
      cosine_score: 0.9,
      second_cosine_score: 0.8,
      nn_margin: 0.1,
      gt_cosine_score: 0.9,
      gt_feature_rank: 1,
      target_error: 0,
      target_error_bbox: 0,
      target_error_bbox_pct: 0,
      target_vertex_error: 0,
      target_vertex_error_bbox: 0,
      source_snap_distance: 0,
      target_snap_distance: 0,
      source_landmark_x: 0,
      source_landmark_y: 0,
      source_landmark_z: 0,
      target_landmark_x: 1,
      target_landmark_y: 0,
      target_landmark_z: 0,
      source_x: 0,
      source_y: 0,
      source_z: 0,
      target_gt_x: 1,
      target_gt_y: 0,
      target_gt_z: 0,
      pred_target_x: 1,
      pred_target_y: 0,
      pred_target_z: 0,
      "pck_0.1": "True",
    },
    {
      label: "plain",
      source_index: 1,
      target_gt_index: 1,
      predicted_target_index: 2,
      cosine_score: 0.7,
      second_cosine_score: 0.65,
      nn_margin: 0.05,
      gt_cosine_score: 0.6,
      gt_feature_rank: 20,
      target_error: 5,
      target_error_bbox: 0.5,
      target_error_bbox_pct: 50,
      target_vertex_error: sqrt18,
      target_vertex_error_bbox: sqrt18 / 10,
      source_snap_distance: 0,
      target_snap_distance: 1,
      source_landmark_x: 1,
      source_landmark_y: 1,
      source_landmark_z: 1,
      target_landmark_x: 0,
      target_landmark_y: 0,
      target_landmark_z: 0,
      source_x: 1,
      source_y: 1,
      source_z: 1,
      target_gt_x: 0,
      target_gt_y: 1,
      target_gt_z: 0,
      pred_target_x: 3,
      pred_target_y: 4,
      pred_target_z: 0,
      "pck_0.1": "False",
    },
  ];

  const summary = {
    source: "source",
    target: "target",
    num_common_landmarks: 2,
    common_labels: rows.map((row) => row.label),
    missing_in_source: [],
    missing_in_target: [],
    source_geometry_rows: 2,
    target_geometry_rows: 3,
    feature_dim: 8,
    target_bbox_diagonal: 10,
    top1_exact_index_ratio: 0.5,
    gt_rank_top5_ratio: 0.5,
    gt_rank_top10_ratio: 0.5,
    gt_rank_top100_ratio: 1,
    gt_rank_top1000_ratio: 1,
    "pck_at_0.1_bbox": 0.5,
    target_error_bbox_mean: 0.25,
    target_error_bbox_median: 0.25,
    target_error_bbox_std: 0.25,
    target_error_bbox_min: 0,
    target_error_bbox_max: 0.5,
    target_vertex_error_bbox_mean: sqrt18 / 20,
    target_vertex_error_bbox_median: sqrt18 / 20,
    target_vertex_error_bbox_std: sqrt18 / 20,
    target_vertex_error_bbox_min: 0,
    target_vertex_error_bbox_max: sqrt18 / 10,
    cosine_mean: 0.8,
    cosine_median: 0.8,
    cosine_std: 0.1,
    cosine_min: 0.7,
    cosine_max: 0.9,
    nn_margin_mean: 0.075,
    nn_margin_median: 0.075,
    nn_margin_std: 0.025,
    nn_margin_min: 0.05,
    nn_margin_max: 0.1,
    gt_feature_rank_mean: 10.5,
    gt_feature_rank_median: 10.5,
    gt_feature_rank_std: 9.5,
    gt_feature_rank_min: 1,
    gt_feature_rank_max: 20,
  };

  const columns = [...CSV_FIELDS];
  mutate?.({ manifest, rows, summary, paths, columns });

  for (const relativePath of Object.values(paths)) {
    await fsp.mkdir(path.dirname(path.join(root, ...relativePath.split("/"))), { recursive: true });
  }
  await Promise.all([
    writeProjectFile(root, paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`),
    writeProjectFile(root, paths.summary, `${JSON.stringify(summary, null, 2)}\n`),
    writeProjectFile(root, paths.benchmark, encodeCsv(rows, columns)),
    writeProjectFile(root, paths.sourceIndex, "v 0 0 0\n"),
    writeProjectFile(root, paths.targetIndex, "v 0 0 0\n"),
    writeProjectFile(root, paths.sourceDisplay, "ply\nformat ascii 1.0\nend_header\n"),
    writeProjectFile(root, paths.targetDisplay, "ply\nformat ascii 1.0\nend_header\n"),
    writeProjectFile(root, paths.unlistedDisplay, "ply\nformat ascii 1.0\nend_header\n"),
  ]);
  return { root, paths };
}

function encodeCsv(rows, columns) {
  const records = [columns, ...rows.map((row) => columns.map((field) => row[field]))];
  return `${records.map((record) => record.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function writeProjectFile(root, relativePath, contents) {
  return fsp.writeFile(path.join(root, ...relativePath.split("/")), contents, "utf8");
}
