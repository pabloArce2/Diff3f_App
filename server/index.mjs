// Local web server: serves the Vue app and runs the Diff3F scripts as background jobs.
//
//   DIFF3F_ROOT    backend checkout (default: ../bugnist-diff3f-features or ../Diffusion-3D-Features)
//   DIFF3F_PYTHON  python of the diff3f conda env (default: found automatically)
//   BLENDER_EXE    blender executable (default: found automatically)
//   HOST, PORT     where to listen (default: 127.0.0.1:5180)

import express from "express";
import multer from "multer";
import archiver from "archiver";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer as createViteServer } from "vite";
import { loadCorrespondencePresets, resolveCorrespondenceAsset } from "./correspondence-presets.mjs";
import { environmentFor, findBlender, findPython, isExecutableFound } from "./tools.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A GitHub clone of the backend is called bugnist-diff3f-features; older checkouts Diffusion-3D-Features.
const BACKEND_FOLDERS = ["bugnist-diff3f-features", "Diffusion-3D-Features"].map((name) => path.join(APP_ROOT, "..", name));
const DIFF3F_ROOT = path.resolve(
  process.env.DIFF3F_ROOT || BACKEND_FOLDERS.find((folder) => fs.existsSync(folder)) || BACKEND_FOLDERS[0],
);
const PYTHON_EXE = findPython();
const BLENDER_EXE = findBlender();
const UPLOAD_ROOT = path.join(DIFF3F_ROOT, "pipeline_app_uploads");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5180);
const isProduction = process.argv.includes("--production") || process.env.NODE_ENV === "production";

const app = express();
const jobs = new Map();

app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
      cb(null, UPLOAD_ROOT);
    },
    filename(_req, file, cb) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      cb(null, `${stamp}_${safeBasename(file.originalname)}`);
    },
  }),
});

const extensionGroups = {
  tif: [".tif", ".tiff"],
  geometry: [".obj", ".ply", ".npy", ".xyz", ".txt"],
  mesh: [".obj", ".ply"],
  pointcloud: [".ply", ".npy", ".xyz", ".txt"],
  features: [".pt"],
  landmarks: [".csv"],
  indices: [".txt"],
  blend: [".blend"],
  preview: [".png", ".jpg", ".jpeg", ".html", ".blend", ".csv", ".json", ".npz", ".pt", ".obj", ".ply"],
};

const ignoredProjectDirectories = new Set([".git", "__pycache__", "node_modules", ".ipynb_checkpoints"]);

const projectPathRoots = new Set(
  [
    "bugNIST",
    "debug",
    "documentation",
    "landmarks",
    "meshes",
    "output",
    "pipeline_app_uploads",
    "pointclouds",
    "previews",
    "scripts",
    "visualizations",
  ].map((item) => item.toLowerCase()),
);

const stepDefinitions = {
  previewTif: {
    label: "Preview CT Volume",
    command: "python",
    script: "scripts/preview_tif_volume.py",
    args: (p) => [
      "--tif",
      ...listPathValue(p.tif),
      "--outdir",
      requiredPath(p.outdir, "outdir"),
      "--slices",
      intValue(p.slices, 12),
      "--axis",
      value(p.axis, "all"),
      ...thresholdArgs(p),
      ...roiArgs(p),
      ...flagArgs(p.noOverlay, "--no-overlay"),
    ],
  },
  tifToMesh: {
    label: "TIFF To Mesh",
    command: "python",
    script: "scripts/bugnist_tif_to_mesh.py",
    args: (p) => [
      "--tif",
      requiredPath(p.tif, "tif"),
      "--out",
      requiredPath(p.out, "out"),
      ...thresholdArgs(p),
      ...roiArgs(p),
      ...flagArgs(p.autoCrop, "--auto-crop"),
      ...zyxArgs("--auto-crop-padding", p.autoCropPadding),
      "--downsample",
      intValue(p.downsample, 1),
      "--min-size",
      intValue(p.minSize, 512),
      "--opening-radius",
      intValue(p.openingRadius, 0),
      "--closing-radius",
      intValue(p.closingRadius, 0),
      ...flagArgs(p.fillHoles, "--fill-holes"),
      ...flagArgs(p.keepLargest, "--keep-largest"),
      ...flagArgs(p.center, "--center"),
    ],
  },
  tifToPointcloud: {
    label: "TIFF To Point Cloud",
    command: "python",
    script: "scripts/bugnist_tif_to_pointcloud.py",
    args: (p) => [
      "--tif",
      requiredPath(p.tif, "tif"),
      "--out",
      requiredPath(p.out, "out"),
      ...optionalPathArg("--npy", p.npy),
      ...thresholdArgs(p),
      ...roiArgs(p),
      ...flagArgs(p.autoCrop, "--auto-crop"),
      ...zyxArgs("--auto-crop-padding", p.autoCropPadding),
      "--downsample",
      intValue(p.downsample, 1),
      "--num-points",
      intValue(p.numPoints, 20000),
      "--method",
      value(p.method, "mesh-surface"),
      "--min-size",
      intValue(p.minSize, 512),
      "--opening-radius",
      intValue(p.openingRadius, 0),
      "--closing-radius",
      intValue(p.closingRadius, 0),
      ...optionalArg("--seed", p.seed),
      ...flagArgs(p.fillHoles, "--fill-holes"),
      ...flagArgs(p.keepLargest, "--keep-largest"),
      ...flagArgs(p.center, "--center"),
    ],
  },
  smoothMesh: {
    label: "Smooth And Simplify Mesh",
    command: "python",
    script: "scripts/smooth_simplify_mesh.py",
    args: (p) => [
      "--input",
      requiredPath(p.input, "input"),
      "--out",
      requiredPath(p.out, "out"),
      "--smooth-method",
      value(p.smoothMethod, "taubin"),
      "--smooth-iterations",
      intValue(p.smoothIterations, 10),
      "--target-faces",
      intValue(p.targetFaces, 50000),
      "--decimate-method",
      value(p.decimateMethod, "cluster"),
      "--cluster-iterations",
      intValue(p.clusterIterations, 14),
      "--final-smooth-iterations",
      intValue(p.finalSmoothIterations, 3),
      ...flagArgs(p.mergeVertices, "--merge-vertices"),
    ],
  },
  meshFeatures: {
    label: "Compute Mesh Diff3F Features",
    command: "python",
    script: "scripts/compute_mesh_features.py",
    args: (p) => [
      "--mesh",
      ...listPathValue(p.mesh),
      "--prompt",
      required(p.prompt, "prompt"),
      "--outdir",
      requiredPath(p.outdir, "outdir"),
      "--num-views",
      intValue(p.numViews, 16),
      "--view-sampling",
      value(p.viewSampling, "insect"),
      "--height",
      intValue(p.height, 512),
      "--width",
      intValue(p.width, 512),
      "--tolerance",
      numValue(p.tolerance, 0.008),
      ...optionalArg("--device", p.device),
      ...descriptorDebugArgs(p),
      ...flagArgs(p.tosca, "--tosca"),
      ...flagArgs(p.noNormalMap, "--no-normal-map"),
      ...flagArgs(p.skipExisting && p.captureImages !== true, "--skip-existing"),
    ],
  },
  pointcloudFeatures: {
    label: "Compute Point-Cloud Diff3F Features",
    command: "python",
    script: "scripts/compute_pointcloud_features.py",
    args: (p) => [
      "--pointcloud",
      ...listPathValue(p.pointcloud),
      "--prompt",
      required(p.prompt, "prompt"),
      "--outdir",
      requiredPath(p.outdir, "outdir"),
      "--num-views",
      intValue(p.numViews, 16),
      "--view-sampling",
      value(p.viewSampling, "insect"),
      "--height",
      intValue(p.height, 512),
      "--width",
      intValue(p.width, 512),
      "--point-radius",
      numValue(p.pointRadius, 0.012),
      "--points-per-pixel",
      intValue(p.pointsPerPixel, 1),
      ...optionalArg("--device", p.device),
      ...descriptorDebugArgs(p),
      ...flagArgs(p.noNormalMap, "--no-normal-map"),
      ...flagArgs(p.skipExisting && p.captureImages !== true, "--skip-existing"),
    ],
  },
  visualizeMeshFeatures: {
    label: "Visualize Mesh Features",
    command: "python",
    script: "scripts/visualize_mesh_features.py",
    args: (p) => [
      "--mesh",
      requiredPath(p.mesh, "mesh"),
      "--features",
      requiredPath(p.features, "features"),
      "--out",
      requiredPath(p.out, "out"),
      ...optionalPathArg("--preview", p.preview),
    ],
  },
  visualizePointcloudFeatures: {
    label: "Visualize Point-Cloud Features",
    command: "python",
    script: "scripts/visualize_pointcloud_features.py",
    args: (p) => [
      "--pointcloud",
      requiredPath(p.pointcloud, "pointcloud"),
      "--features",
      requiredPath(p.features, "features"),
      "--out",
      requiredPath(p.out, "out"),
      ...optionalPathArg("--preview", p.preview),
    ],
  },
  correspondences: {
    label: "Compute Feature Correspondences",
    command: "python",
    script: "scripts/compute_feature_correspondences.py",
    args: (p) => [
      "--source-name",
      required(p.sourceName, "sourceName"),
      "--source-mesh",
      requiredPath(p.sourceGeometry, "sourceGeometry"),
      "--source-features",
      requiredPath(p.sourceFeatures, "sourceFeatures"),
      "--target-name",
      required(p.targetName, "targetName"),
      "--target-mesh",
      requiredPath(p.targetGeometry, "targetGeometry"),
      "--target-features",
      requiredPath(p.targetFeatures, "targetFeatures"),
      "--outdir",
      requiredPath(p.outdir, "outdir"),
      "--num-source-points",
      intValue(p.numSourcePoints, 80),
      "--sampling",
      value(p.sampling, "farthest"),
      "--seed",
      intValue(p.seed, 42),
      ...optionalPathArg("--source-indices", p.sourceIndices),
      ...optionalArg("--device", p.device),
      ...flagArgs(p.mutualCheck, "--mutual-check"),
    ],
  },
  landmarkBenchmark: {
    label: "Evaluate Landmark Benchmark",
    command: "python",
    script: "scripts/evaluate_landmark_benchmark.py",
    args: (p) => [
      "--source-name",
      required(p.sourceName, "sourceName"),
      "--source-geometry",
      requiredPath(p.sourceGeometry, "sourceGeometry"),
      "--source-features",
      requiredPath(p.sourceFeatures, "sourceFeatures"),
      "--source-landmarks",
      requiredPath(p.sourceLandmarks, "sourceLandmarks"),
      "--target-name",
      required(p.targetName, "targetName"),
      "--target-geometry",
      requiredPath(p.targetGeometry, "targetGeometry"),
      "--target-features",
      requiredPath(p.targetFeatures, "targetFeatures"),
      "--target-landmarks",
      requiredPath(p.targetLandmarks, "targetLandmarks"),
      "--outdir",
      requiredPath(p.outdir, "outdir"),
      "--thresholds",
      ...listValue(p.thresholds || "0.01 0.02 0.05 0.10"),
      ...optionalArg("--device", p.device),
    ],
  },
  debugView: {
    label: "Debug 2D Diffusion View",
    command: "python",
    script: "scripts/debug_2d_diffusion_view.py",
    args: (p) => [
      "--kind",
      value(p.kind, "mesh"),
      "--input",
      requiredPath(p.input, "input"),
      "--prompt",
      required(p.prompt, "prompt"),
      "--outdir",
      requiredPath(p.outdir, "outdir"),
      "--num-views",
      intValue(p.numViews, 16),
      "--view-sampling",
      value(p.viewSampling, "insect"),
      "--view-index",
      intValue(p.viewIndex, 0),
      "--height",
      intValue(p.height, 512),
      "--width",
      intValue(p.width, 512),
      ...flagArgs(p.renderOnly, "--render-only"),
      ...flagArgs(p.allViews, "--all-views"),
      ...flagArgs(p.skipDiffusion, "--skip-diffusion"),
      ...optionalArg("--seed", p.seed),
    ],
  },
  blenderCorrespondenceScene: {
    label: "Create Blender Correspondence Scene",
    command: "blender",
    script: "scripts/make_blender_correspondence_scene.py",
    args: (p) => [
      "--background",
      "--python",
      path.join(DIFF3F_ROOT, "scripts/make_blender_correspondence_scene.py"),
      "--",
      "--source-label",
      required(p.sourceLabel, "sourceLabel"),
      "--source-mesh",
      requiredPath(p.sourceGeometry, "sourceGeometry"),
      "--target-label",
      required(p.targetLabel, "targetLabel"),
      "--target-mesh",
      requiredPath(p.targetGeometry, "targetGeometry"),
      "--matches",
      requiredPath(p.matches, "matches"),
      "--output",
      requiredPath(p.output, "output"),
      "--max-matches",
      intValue(p.maxMatches, 80),
      "--min-score",
      numValue(p.minScore, -1),
      ...flagArgs(p.onlyMutual, "--only-mutual"),
    ],
  },
};

app.get("/api/config", (_req, res) => {
  res.json({
    appRoot: APP_ROOT,
    diffusionRoot: DIFF3F_ROOT,
    uploadRoot: UPLOAD_ROOT,
    pythonExe: PYTHON_EXE,
    blenderExe: BLENDER_EXE,
    pythonExists: isExecutableFound(PYTHON_EXE),
    blenderExists: isExecutableFound(BLENDER_EXE),
    diffusionRootExists: fs.existsSync(DIFF3F_ROOT),
    steps: Object.entries(stepDefinitions).map(([id, step]) => ({ id, label: step.label })),
  });
});

app.get("/api/correspondence-presets", async (_req, res, next) => {
  try {
    res.json(await loadCorrespondencePresets(DIFF3F_ROOT));
  } catch (error) {
    next(error);
  }
});

app.get("/api/correspondence-asset", async (req, res, next) => {
  try {
    const requested = String(req.query.path || "");
    if (!requested) throw new Error("Missing correspondence asset path.");
    const asset = await resolveCorrespondenceAsset(DIFF3F_ROOT, requested);
    res.set("Cache-Control", "private, max-age=60");
    res.sendFile(asset.absolutePath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/files", async (req, res, next) => {
  try {
    const group = String(req.query.group || "preview");
    const base = String(req.query.base || "");
    const exts = extensionGroups[group] || extensionGroups.preview;
    const root = safeResolve(DIFF3F_ROOT, base ? normalizeProjectInputPath(base) : ".");
    const files = await listFiles(root, exts, 700);
    res.json({ files });
  } catch (error) {
    next(error);
  }
});

app.get("/api/browse", async (req, res, next) => {
  try {
    const group = String(req.query.group || "preview");
    if (!Object.prototype.hasOwnProperty.call(extensionGroups, group)) {
      throw new Error(`Unknown file group: ${group}`);
    }
    const requested = String(req.query.path || "");
    const exts = extensionGroups[group];
    const root = safeResolve(DIFF3F_ROOT, requested ? normalizeProjectInputPath(requested) : ".");
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) {
      throw new Error("Browse path is not a folder.");
    }
    const [canonicalProjectRoot, canonicalBrowseRoot] = await Promise.all([
      fsp.realpath(DIFF3F_ROOT),
      fsp.realpath(root),
    ]);
    if (!isInside(canonicalBrowseRoot, canonicalProjectRoot)) {
      throw new Error("Browse path escapes project root through a linked folder.");
    }

    const currentPath = normalizeForClient(path.relative(DIFF3F_ROOT, root));
    const entries = await listDirectory(root, exts);
    const parentPath = currentPath
      ? normalizeForClient(path.dirname(path.relative(DIFF3F_ROOT, root)))
      : null;

    res.json({
      path: currentPath,
      parent: parentPath === "." ? "" : parentPath,
      entries,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.array("files", 12), (req, res) => {
  const files = (req.files || []).map((file) => fileInfo(file.path));
  res.json({ files });
});

app.post("/api/run", async (req, res, next) => {
  try {
    const { step, params = {} } = req.body || {};
    if (!stepDefinitions[step]) {
      throw new Error(`Unknown step: ${step}`);
    }
    const job = await startJob(step, params);
    res.json(summaryJob(job));
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: Array.from(jobs.values()).map(summaryJob).reverse() });
});

app.get("/api/jobs/:id", (req, res, next) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return next(new Error("Job not found."));
  }
  res.json(job);
});

app.post("/api/jobs/:id/stop", (req, res, next) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return next(new Error("Job not found."));
  }
  if (job.process && job.status === "running") {
    job.process.kill();
    job.log += "\n[app] Stop requested.\n";
  }
  res.json(summaryJob(job));
});

app.get("/api/download", (req, res, next) => {
  try {
    const requested = String(req.query.path || "");
    if (!requested) {
      throw new Error("Missing download path.");
    }
    const fullPath = resolveProjectPath(requested);
    if (!fs.existsSync(fullPath)) {
      throw new Error("Download path does not exist.");
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (archiveError) => next(archiveError));
      res.attachment(`${path.basename(fullPath)}.zip`);
      archive.pipe(res);
      archive.directory(fullPath, false);
      archive.finalize();
      return;
    }
    res.download(fullPath);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(400).json({ error: error.message || String(error) });
});

if (isProduction) {
  app.use(express.static(path.join(APP_ROOT, "dist")));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(APP_ROOT, "dist", "index.html"));
  });
} else {
  const vite = await createViteServer({
    root: APP_ROOT,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(PORT, HOST, () => {
  console.log(`BugNIST pipeline app running at http://${HOST}:${PORT}`);
  console.log(`Diff3F root: ${DIFF3F_ROOT}${fs.existsSync(DIFF3F_ROOT) ? "" : "  (not found, set DIFF3F_ROOT)"}`);
  console.log(`Python: ${PYTHON_EXE}`);
  console.log(`Blender: ${BLENDER_EXE}`);
});

async function startJob(stepId, params) {
  const def = stepDefinitions[stepId];
  const args = def.args(params).map(String);
  const executable = def.command === "blender" ? BLENDER_EXE : PYTHON_EXE;
  const commandArgs = def.command === "blender" ? args : [def.script, ...args];
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    step: stepId,
    label: def.label,
    status: "running",
    command: [executable, ...commandArgs].join(" "),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    log: "",
    outputs: expectedOutputs(stepId, params),
  };
  jobs.set(id, job);

  const child = spawn(executable, commandArgs, {
    cwd: DIFF3F_ROOT,
    env: { ...environmentFor(executable), PYTHONUNBUFFERED: "1" },
    windowsHide: true,
  });
  job.process = child;
  appendLog(job, `[app] Started ${def.label}\n`);
  appendLog(job, `[cwd] ${DIFF3F_ROOT}\n`);
  appendLog(job, `[cmd] ${job.command}\n\n`);

  child.stdout.on("data", (data) => appendLog(job, data.toString()));
  child.stderr.on("data", (data) => appendLog(job, data.toString()));
  child.on("error", (error) => {
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    appendLog(job, `\n[app] Failed to start: ${error.message}\n`);
  });
  child.on("close", (code) => {
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    delete job.process;
    appendLog(job, `\n[app] Finished with exit code ${code}\n`);
  });

  return job;
}

function appendLog(job, text) {
  job.log += text;
  if (job.log.length > 350000) {
    job.log = job.log.slice(-350000);
  }
}

function summaryJob(job) {
  return {
    id: job.id,
    step: job.step,
    label: job.label,
    status: job.status,
    command: job.command,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    outputs: job.outputs,
    logTail: job.log.slice(-4000),
  };
}

function expectedOutputs(stepId, params) {
  const keysByStep = {
    previewTif: ["outdir"],
    tifToMesh: ["out"],
    tifToPointcloud: ["out", "npy"],
    smoothMesh: ["out"],
    meshFeatures: ["outdir"],
    pointcloudFeatures: ["outdir"],
    visualizeMeshFeatures: ["out", "preview"],
    visualizePointcloudFeatures: ["out", "preview"],
    correspondences: ["outdir"],
    landmarkBenchmark: ["outdir"],
    debugView: ["outdir"],
    blenderCorrespondenceScene: ["output"],
  };
  const items = (keysByStep[stepId] || [])
    .map((key) => params[key])
    .filter(Boolean)
    .map((item) => ({ label: path.basename(String(item)), value: String(item) }));
  if ((stepId === "meshFeatures" || stepId === "pointcloudFeatures") && params.captureImages === true && params.debugOutdir) {
    items.push({ label: "Captured descriptor images", value: String(params.debugOutdir) });
  }

  // Outputs written outside the Diff3F folder still work, they just get no download link.
  const outputs = [];
  for (const { label, value } of items) {
    try {
      outputs.push({ label, path: normalizeForClient(resolveProjectPath(value)) });
    } catch {
      // outside DIFF3F_ROOT
    }
  }
  return outputs;
}

async function listFiles(root, exts, limit) {
  const results = [];
  async function walk(dir) {
    if (results.length >= limit) return;
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredProjectDirectories.has(entry.name.toLowerCase())) await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (exts.includes(ext)) {
          results.push(fileInfo(full));
        }
      }
    }
  }
  await walk(root);
  return results;
}

async function listDirectory(root, exts) {
  const directoryEntries = await fsp.readdir(root, { withFileTypes: true });
  const results = [];

  for (const entry of directoryEntries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && ignoredProjectDirectories.has(entry.name.toLowerCase())) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;

    const kind = entry.isDirectory() ? "directory" : "file";
    if (kind === "file" && !exts.includes(path.extname(entry.name).toLowerCase())) continue;

    const fullPath = path.join(root, entry.name);
    let stat;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      continue;
    }

    results.push({
      kind,
      name: entry.name,
      relative: normalizeForClient(path.relative(DIFF3F_ROOT, fullPath)),
      ...(kind === "file" ? { size: stat.size } : {}),
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  return results.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function fileInfo(fullPath) {
  const stat = fs.statSync(fullPath);
  return {
    name: path.basename(fullPath),
    path: normalizeForClient(fullPath),
    relative: normalizeForClient(path.relative(DIFF3F_ROOT, fullPath)),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    downloadUrl: `/api/download?path=${encodeURIComponent(normalizeForClient(fullPath))}`,
  };
}

function safeResolve(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!isInside(resolved, root)) {
    throw new Error("Path escapes project root.");
  }
  return resolved;
}

// Relative paths are relative to the Diff3F folder; files can only be served from inside it.
function resolveProjectPath(inputPath) {
  if (!inputPath) return "";
  const normalized = normalizeProjectInputPath(inputPath);
  const fullPath = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(DIFF3F_ROOT, normalized);
  if (!isInside(fullPath, DIFF3F_ROOT)) {
    throw new Error(`Path is outside the Diff3F folder: ${inputPath}`);
  }
  return fullPath;
}

function isInside(candidate, root) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeForClient(value) {
  return value.replaceAll("\\", "/");
}

function safeBasename(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function required(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Missing required parameter: ${name}`);
  }
  return String(value).trim();
}

function requiredPath(input, name) {
  return normalizeProjectInputPath(required(input, name));
}

function value(input, fallback) {
  if (input === undefined || input === null || String(input).trim() === "") return fallback;
  return String(input).trim();
}

function intValue(input, fallback) {
  const parsed = Number.parseInt(value(input, fallback), 10);
  if (!Number.isFinite(parsed)) throw new Error(`Expected integer, got ${input}`);
  return parsed;
}

function numValue(input, fallback) {
  const parsed = Number.parseFloat(value(input, fallback));
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${input}`);
  return parsed;
}

function listValue(input) {
  if (Array.isArray(input)) return input.map((item) => required(item, "list item"));
  const text = required(input, "list value");
  return text.split(/\s+/).filter(Boolean);
}

function listPathValue(input) {
  return listValue(input).map((item) => normalizeProjectInputPath(item));
}

function optionalArg(flag, input) {
  if (input === undefined || input === null || String(input).trim() === "") return [];
  return [flag, String(input).trim()];
}

function optionalPathArg(flag, input) {
  if (input === undefined || input === null || String(input).trim() === "") return [];
  return [flag, normalizeProjectInputPath(input)];
}

function descriptorDebugArgs(params) {
  if (params.captureImages !== true) return [];
  return [
    "--debug-outdir",
    requiredPath(params.debugOutdir, "debugOutdir"),
    "--debug-views",
    value(params.debugViews, "all"),
  ];
}

function flagArgs(enabled, flag) {
  return enabled ? [flag] : [];
}

function zyxArgs(flag, input) {
  if (!input) return [];
  const values = listValue(input);
  if (values.length !== 3) throw new Error(`${flag} expects exactly 3 values.`);
  return [flag, ...values];
}

function roiArgs(p) {
  if (!p.roiStart && !p.roiSize) return [];
  return [...zyxArgs("--roi-start", p.roiStart), ...zyxArgs("--roi-size", p.roiSize)];
}

function thresholdArgs(p) {
  const method = value(p.thresholdMethod, p.threshold ? "manual" : "auto");
  const args = ["--threshold-method", method];
  if (
    (method === "manual" || method === "auto") &&
    p.threshold !== undefined &&
    p.threshold !== null &&
    String(p.threshold).trim() !== ""
  ) {
    args.push("--threshold", numValue(p.threshold, 0));
  }
  if (
    (method === "percentile" || method === "auto") &&
    p.thresholdPercentile !== undefined &&
    p.thresholdPercentile !== null &&
    String(p.thresholdPercentile).trim() !== ""
  ) {
    args.push("--threshold-percentile", numValue(p.thresholdPercentile, 95));
  }
  return args;
}

function normalizeProjectInputPath(input) {
  let normalized = String(input).trim().replace(/\//g, path.sep);
  if (!normalized) return normalized;

  if (path.sep === "\\") {
    const isDrivePath = /^[a-zA-Z]:\\/.test(normalized);
    const isUncPath = normalized.startsWith("\\\\");
    if (!isDrivePath && !isUncPath) {
      const withoutLeadingSlash = normalized.replace(/^\\+/, "");
      const rootName = withoutLeadingSlash.split("\\")[0]?.toLowerCase();
      if (projectPathRoots.has(rootName)) {
        normalized = withoutLeadingSlash;
      }
    }
  }

  return normalized;
}
