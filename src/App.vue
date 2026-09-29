<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  Activity,
  Box,
  Bug,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  FileArchive,
  FileText,
  FolderOpen,
  Gauge,
  Image,
  Info,
  Loader2,
  Palette,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  UploadCloud,
} from "@lucide/vue";
import ProjectPathInput from "./components/ProjectPathInput.vue";

const PcaMeshViewer = defineAsyncComponent(() => import("./components/PcaMeshViewer.vue"));
const CorrespondenceViewer = defineAsyncComponent(() => import("./components/CorrespondenceViewer.vue"));

const sections = [
  { id: "data", label: "Data", icon: UploadCloud },
  { id: "preview", label: "CT Preview", icon: Image },
  { id: "geometry", label: "Geometry", icon: Box },
  { id: "features", label: "Descriptors", icon: Sparkles },
  { id: "visualize", label: "Visualize", icon: Eye },
  { id: "match", label: "Match", icon: Activity },
  { id: "benchmark", label: "Benchmark", icon: Gauge },
  { id: "jobs", label: "Jobs", icon: FileText },
  { id: "docs", label: "Docs", icon: Info },
];

const sectionIds = new Set(sections.map((section) => section.id));
const initialRoute = parseAppRoute(window.location.hash);

const activeSection = ref(initialRoute.section);
const visualizationMode = ref(initialRoute.visualizationMode);
const plyExportKind = ref("mesh");
const config = ref(null);
const files = ref([]);
const fileGroup = ref("preview");
const fileSearch = ref("");
const jobs = ref([]);
const activeJobId = ref(null);
const activeJob = ref(null);
const uploading = ref(false);
const uploadError = ref("");
const runError = ref("");
const copiedPath = ref("");
let jobsRefreshTimer;

const forms = reactive({
  preview: {
    tif: "bugNIST\\crickets\\bcrick_10_010.tif",
    outdir: "previews\\app_preview",
    thresholdMethod: "manual",
    threshold: 45,
    thresholdPercentile: "",
    slices: 12,
    axis: "all",
    roiStart: "",
    roiSize: "",
    noOverlay: false,
  },
  mesh: {
    tif: "bugNIST\\crickets\\bcrick_10_010.tif",
    out: "meshes\\bugnist_crickets\\bcrick_10_010\\preprocessed\\bcrick_10_010_thr45_fillholes_keeplargest_ds1.obj",
    thresholdMethod: "manual",
    threshold: 45,
    thresholdPercentile: "",
    roiStart: "",
    roiSize: "",
    autoCrop: true,
    autoCropPadding: "12 12 12",
    downsample: 1,
    minSize: 512,
    openingRadius: 0,
    closingRadius: 0,
    fillHoles: true,
    keepLargest: true,
    center: false,
  },
  pointcloud: {
    tif: "bugNIST\\crickets\\bcrick_10_010.tif",
    out: "pointclouds\\bugnist_crickets\\bcrick_10_010\\preprocessed\\bcrick_10_010_thr45_20k.ply",
    npy: "pointclouds\\bugnist_crickets\\bcrick_10_010\\preprocessed\\bcrick_10_010_thr45_20k.npy",
    thresholdMethod: "manual",
    threshold: 45,
    thresholdPercentile: "",
    roiStart: "",
    roiSize: "",
    autoCrop: true,
    autoCropPadding: "12 12 12",
    downsample: 1,
    numPoints: 20000,
    method: "mesh-surface",
    minSize: 512,
    openingRadius: 0,
    closingRadius: 0,
    fillHoles: true,
    keepLargest: true,
    center: true,
    seed: 42,
  },
  smooth: {
    input: "meshes\\bugnist_crickets\\bcrick_10_010\\preprocessed\\bcrick_10_010_thr45_fillholes_keeplargest_ds1.obj",
    out: "meshes\\bugnist_crickets\\bcrick_10_010\\smoothed\\bcrick_10_010_thr45_fillholes_smooth10_cluster50k.obj",
    smoothMethod: "taubin",
    smoothIterations: 10,
    targetFaces: 50000,
    decimateMethod: "cluster",
    clusterIterations: 14,
    finalSmoothIterations: 3,
    mergeVertices: false,
  },
  meshFeatures: {
    mesh: "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj meshes\\bugnist_crickets\\sfaar_10_010\\BlackCricket_10_10_rotated.obj",
    prompt: "cricket insect, full body, long antennae, large hind legs, segmented insect body, detailed exoskeleton, macro photograph",
    outdir: "output\\bugnist_crickets_features_16v_512",
    numViews: 16,
    viewSampling: "insect",
    height: 512,
    width: 512,
    tolerance: 0.008,
    device: "",
    captureImages: false,
    debugOutdir: "debug\\descriptor_runs\\mesh",
    debugViews: "all",
    tosca: false,
    noNormalMap: false,
    skipExisting: true,
  },
  pointcloudFeatures: {
    pointcloud: "pointclouds\\bugnist_crickets\\bcrick_10_010\\preprocessed\\bcrick_10_010_thr45_20k.ply",
    prompt: "cricket insect, full body, long antennae, large hind legs, segmented insect body, detailed exoskeleton, macro photograph",
    outdir: "output\\bugnist_crickets_pointcloud_features_16v_512",
    numViews: 16,
    viewSampling: "insect",
    height: 512,
    width: 512,
    pointRadius: 0.012,
    pointsPerPixel: 1,
    device: "",
    captureImages: false,
    debugOutdir: "debug\\descriptor_runs\\pointcloud",
    debugViews: "all",
    noNormalMap: false,
    skipExisting: true,
  },
  meshViz: {
    mesh: "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj",
    features: "output\\bugnist_crickets_features_16v_512\\BrownCricket_rotated_diff3f.pt",
    out: "visualizations\\bugnist_crickets_features\\BrownCricket_rotated_features.ply",
    preview: "visualizations\\bugnist_crickets_features\\BrownCricket_rotated_features.png",
  },
  pointcloudViz: {
    pointcloud: "pointclouds\\bugnist_crickets\\bcrick_10_010\\preprocessed\\bcrick_10_010_thr45_20k.ply",
    features: "output\\bugnist_crickets_pointcloud_features_16v_512\\bcrick_10_010_thr45_20k_diff3f.pt",
    out: "visualizations\\bugnist_crickets_pointcloud_features\\bcrick_10_010_features.ply",
    preview: "visualizations\\bugnist_crickets_pointcloud_features\\bcrick_10_010_features.png",
  },
  correspondence: {
    sourceName: "brownCricket",
    sourceGeometry: "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj",
    sourceFeatures: "output\\bugnist_crickets_features_16v_512\\BrownCricket_rotated_diff3f.pt",
    targetName: "blackCricket",
    targetGeometry: "meshes\\bugnist_crickets\\sfaar_10_010\\BlackCricket_10_10_rotated.obj",
    targetFeatures: "output\\bugnist_crickets_features_16v_512\\BlackCricket_10_10_rotated_diff3f.pt",
    outdir: "visualizations\\bugnist_crickets_correspondences\\brownCricket_to_blackCricket",
    numSourcePoints: 80,
    sampling: "farthest",
    seed: 42,
    sourceIndices: "",
    mutualCheck: true,
    device: "",
  },
  benchmark: {
    sourceName: "brownCricket",
    sourceGeometry: "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj",
    sourceFeatures: "output\\bugnist_crickets_features_16v_512\\BrownCricket_rotated_diff3f.pt",
    sourceLandmarks: "landmarks\\bugnist_crickets\\brownCricket_rotated_obj_landmarks.csv",
    targetName: "blackCricket",
    targetGeometry: "meshes\\bugnist_crickets\\sfaar_10_010\\BlackCricket_10_10_rotated.obj",
    targetFeatures: "output\\bugnist_crickets_features_16v_512\\BlackCricket_10_10_rotated_diff3f.pt",
    targetLandmarks: "landmarks\\bugnist_crickets\\blackCricket_rotated_obj_landmarks.csv",
    outdir: "visualizations\\bugnist_crickets_landmark_benchmark\\brownCricket_to_blackCricket",
    thresholds: "0.01 0.02 0.05 0.10",
    device: "",
  },
  debug: {
    kind: "mesh",
    input: "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj",
    prompt: "cricket insect, full body, long antennae, large hind legs, segmented insect body, detailed exoskeleton, macro photograph",
    outdir: "debug\\app_bcrick_view0",
    numViews: 16,
    viewSampling: "insect",
    viewIndex: 0,
    height: 512,
    width: 512,
    seed: 42,
    renderOnly: true,
    allViews: false,
    skipDiffusion: false,
  },
  blenderScene: {
    sourceLabel: "brownCricket",
    sourceGeometry: "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj",
    targetLabel: "blackCricket",
    targetGeometry: "meshes\\bugnist_crickets\\sfaar_10_010\\BlackCricket_10_10_rotated.obj",
    matches: "visualizations\\bugnist_crickets_correspondences\\brownCricket_to_blackCricket\\brownCricket_to_blackCricket_matches.csv",
    output: "visualizations\\bugnist_crickets_correspondences\\brownCricket_to_blackCricket\\brownCricket_to_blackCricket_correspondence.blend",
    maxMatches: 80,
    minScore: -1,
    onlyMutual: false,
  },
});

const activeJobs = computed(() => jobs.value.filter((job) => job.status === "running"));
const filteredFiles = computed(() => {
  const query = fileSearch.value.trim().toLowerCase();
  if (!query) return files.value;
  return files.value.filter((file) => file.relative.toLowerCase().includes(query));
});
const latestJob = computed(() => jobs.value[0] || null);
const selectedJob = computed(() => activeJob.value || latestJob.value);

onMounted(async () => {
  window.addEventListener("hashchange", applyRouteFromHash);
  syncRouteToHash();
  await loadConfig();
  await refreshFiles();
  await refreshJobs();
  jobsRefreshTimer = window.setInterval(refreshJobs, 2500);
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", applyRouteFromHash);
  if (jobsRefreshTimer) window.clearInterval(jobsRefreshTimer);
});

watch([activeSection, visualizationMode], syncRouteToHash);

function parseAppRoute(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  const section = sectionIds.has(parts[0]) ? parts[0] : "data";
  const visualizationMode = section === "visualize" && ["correspondence", "correspondences"].includes(parts[1])
    ? "correspondence"
    : "mesh";
  return { section, visualizationMode };
}

function routeForState() {
  if (activeSection.value === "visualize") {
    const view = visualizationMode.value === "correspondence" ? "correspondences" : "mesh";
    return `#/visualize/${view}`;
  }
  return `#/${activeSection.value}`;
}

function syncRouteToHash() {
  const nextRoute = routeForState();
  if (window.location.hash !== nextRoute) window.location.hash = nextRoute;
}

function applyRouteFromHash() {
  const route = parseAppRoute(window.location.hash);
  activeSection.value = route.section;
  if (route.section === "visualize") visualizationMode.value = route.visualizationMode;
}

async function loadConfig() {
  config.value = await api("/api/config");
}

async function refreshFiles() {
  const data = await api(`/api/files?group=${encodeURIComponent(fileGroup.value)}`);
  files.value = data.files || [];
}

async function refreshJobs() {
  const data = await api("/api/jobs");
  jobs.value = data.jobs || [];
  if (activeJobId.value) {
    try {
      activeJob.value = await api(`/api/jobs/${activeJobId.value}`);
    } catch {
      activeJob.value = null;
    }
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }
  return data;
}

async function runStep(step, params) {
  runError.value = "";
  try {
    const job = await api("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, params }),
    });
    activeJobId.value = job.id;
    activeSection.value = "jobs";
    await refreshJobs();
  } catch (error) {
    runError.value = error.message;
  }
}

async function stopJob(job) {
  await api(`/api/jobs/${job.id}/stop`, { method: "POST" });
  await refreshJobs();
}

async function uploadFiles(event) {
  const filesToUpload = event.dataTransfer?.files || event.target?.files;
  if (!filesToUpload || filesToUpload.length === 0) return;
  uploading.value = true;
  uploadError.value = "";
  const formData = new FormData();
  for (const file of filesToUpload) {
    formData.append("files", file);
  }
  try {
    const result = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || "Upload failed.");
    await refreshFiles();
    if (data.files?.[0]) {
      copyPath(data.files[0].relative);
    }
  } catch (error) {
    uploadError.value = error.message;
  } finally {
    uploading.value = false;
    if (event.target) event.target.value = "";
  }
}

async function copyPath(pathValue) {
  copiedPath.value = pathValue;
  try {
    await navigator.clipboard.writeText(pathValue);
  } catch {
    // No clipboard access (e.g. plain http on another host); the path is still shown.
  }
}

function loadCamelDescriptorExample() {
  Object.assign(forms.meshFeatures, {
    mesh: "meshes\\camel.obj",
    prompt: "camel, full body, detailed animal",
    outdir: "output\\camel_features_debug_4v_256",
    numViews: 4,
    viewSampling: "grid",
    height: 256,
    width: 256,
    tolerance: 0.004,
    device: "",
    captureImages: true,
    debugOutdir: "debug\\descriptor_runs\\camel",
    debugViews: "all",
    tosca: true,
    noNormalMap: false,
    skipExisting: false,
  });
  loadCamelPlyExample();
}

function loadCamelPlyExample() {
  plyExportKind.value = "mesh";
  Object.assign(forms.meshViz, {
    mesh: "meshes\\camel.obj",
    features: "output\\camel_features_debug_4v_256\\camel_diff3f.pt",
    out: "visualizations\\camel_features_debug_4v_256\\camel_diff3f_pca.ply",
    preview: "visualizations\\camel_features_debug_4v_256\\camel_diff3f_pca.png",
  });
}

function runPlyExport() {
  if (plyExportKind.value === "pointcloud") {
    return runStep("visualizePointcloudFeatures", forms.pointcloudViz);
  }
  return runStep("visualizeMeshFeatures", forms.meshViz);
}

function statusIcon(status) {
  if (status === "completed") return CheckCircle2;
  if (status === "running") return Loader2;
  return Square;
}

function statusClass(status) {
  return `status ${status || "idle"}`;
}

function downloadUrl(path) {
  return `/api/download?path=${encodeURIComponent(path)}`;
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <Bug :size="26" />
        <div>
          <strong>BugNIST Pipeline</strong>
          <span>Diff3F local control</span>
        </div>
      </div>

      <nav>
        <button
          v-for="section in sections"
          :key="section.id"
          :class="{ active: activeSection === section.id }"
          type="button"
          @click="activeSection = section.id"
        >
          <component :is="section.icon" :size="18" />
          <span>{{ section.label }}</span>
        </button>
      </nav>

      <div class="runtime">
        <div class="runtime-row">
          <span>Python</span>
          <strong :class="{ muted: !config?.pythonExists }">{{ config?.pythonExists ? "ready" : "check" }}</strong>
        </div>
        <div class="runtime-row">
          <span>Diff3F</span>
          <strong :class="{ muted: !config?.diffusionRootExists }">{{ config?.diffusionRootExists ? "found" : "missing" }}</strong>
        </div>
        <div class="runtime-row">
          <span>Active jobs</span>
          <strong>{{ activeJobs.length }}</strong>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <h1>Pipeline Workspace</h1>
          <p>{{ config?.diffusionRoot || "Loading project configuration..." }}</p>
        </div>
        <button class="icon-button" title="Refresh files and jobs" type="button" @click="refreshFiles(); refreshJobs();">
          <RefreshCw :size="18" />
        </button>
      </header>

      <p v-if="runError" class="alert">{{ runError }}</p>

      <section v-show="activeSection === 'data'" class="grid two">
        <article class="panel">
          <div class="panel-title">
            <UploadCloud :size="20" />
            <h2>Upload Inputs</h2>
          </div>
          <label
            class="dropzone"
            @dragover.prevent
            @drop.prevent="uploadFiles"
          >
            <UploadCloud :size="30" />
            <strong>{{ uploading ? "Uploading..." : "Drop files here" }}</strong>
            <span>TIFF volumes, OBJ/PLY geometry, <code>.pt</code> descriptors or landmark CSV files. They are saved in <code>pipeline_app_uploads/</code>.</span>
            <input multiple type="file" @change="uploadFiles" />
          </label>
          <p v-if="uploadError" class="alert">{{ uploadError }}</p>
          <p v-if="copiedPath" class="hint">Latest path copied: <code>{{ copiedPath }}</code></p>
        </article>

        <article class="panel">
          <div class="panel-title">
            <FolderOpen :size="20" />
            <h2>Project Files</h2>
          </div>
          <div class="toolbar">
            <select v-model="fileGroup" @change="refreshFiles">
              <option value="preview">Outputs</option>
              <option value="tif">TIFF volumes</option>
              <option value="mesh">Meshes</option>
              <option value="pointcloud">Point clouds</option>
              <option value="features">Descriptors</option>
              <option value="landmarks">Landmarks</option>
            </select>
            <label class="search">
              <Search :size="16" />
              <input v-model="fileSearch" placeholder="Filter paths" />
            </label>
          </div>
          <div class="file-list">
            <div v-for="file in filteredFiles" :key="file.path" class="file-row">
              <FileArchive :size="16" />
              <button type="button" title="Copy relative path" @click="copyPath(file.relative)">
                {{ file.relative }}
              </button>
              <a :href="file.downloadUrl" title="Download">
                <Download :size="16" />
              </a>
            </div>
          </div>
        </article>
      </section>

      <section v-show="activeSection === 'preview'" class="panel">
        <div class="panel-title">
          <Image :size="20" />
          <h2>Preview CT Volume</h2>
        </div>
        <div class="form-grid">
          <ProjectPathInput v-model="forms.preview.tif" label="TIFF path" group="tif" multiple />
          <ProjectPathInput v-model="forms.preview.outdir" label="Output folder" mode="directory" />
          <label>Threshold method<select v-model="forms.preview.thresholdMethod"><option>auto</option><option>manual</option><option>percentile</option><option>otsu</option></select></label>
          <label>Threshold<input v-model="forms.preview.threshold" type="number" step="0.1" /></label>
          <label>Percentile<input v-model="forms.preview.thresholdPercentile" type="number" step="0.1" /></label>
          <label>Slices<input v-model="forms.preview.slices" type="number" min="1" /></label>
          <label>Axis<select v-model="forms.preview.axis"><option>all</option><option>z</option><option>y</option><option>x</option></select></label>
          <label>ROI start Z Y X<input v-model="forms.preview.roiStart" placeholder="optional" /></label>
          <label>ROI size Z Y X<input v-model="forms.preview.roiSize" placeholder="optional" /></label>
          <label class="check"><input v-model="forms.preview.noOverlay" type="checkbox" />No overlay</label>
        </div>
        <button class="primary" type="button" @click="runStep('previewTif', forms.preview)"><Play :size="17" />Run preview</button>
      </section>

      <section v-show="activeSection === 'geometry'" class="stack">
        <article class="panel">
          <div class="panel-title">
            <Box :size="20" />
            <h2>TIFF To Mesh</h2>
          </div>
          <div class="form-grid">
            <ProjectPathInput v-model="forms.mesh.tif" label="TIFF path" group="tif" />
            <ProjectPathInput v-model="forms.mesh.out" label="Output OBJ/PLY" group="mesh" mode="save" />
            <label>Threshold method<select v-model="forms.mesh.thresholdMethod"><option>auto</option><option>manual</option><option>percentile</option><option>otsu</option></select></label>
            <label>Threshold<input v-model="forms.mesh.threshold" type="number" step="0.1" /></label>
            <label>ROI start Z Y X<input v-model="forms.mesh.roiStart" placeholder="optional" /></label>
            <label>ROI size Z Y X<input v-model="forms.mesh.roiSize" placeholder="optional" /></label>
            <label>Auto-crop padding<input v-model="forms.mesh.autoCropPadding" /></label>
            <label>Downsample<input v-model="forms.mesh.downsample" type="number" min="1" /></label>
            <label>Minimum component size<input v-model="forms.mesh.minSize" type="number" /></label>
            <label>Opening radius<input v-model="forms.mesh.openingRadius" type="number" /></label>
            <label>Closing radius<input v-model="forms.mesh.closingRadius" type="number" /></label>
            <label class="check"><input v-model="forms.mesh.autoCrop" type="checkbox" />Auto-crop</label>
            <label class="check"><input v-model="forms.mesh.fillHoles" type="checkbox" />Fill holes</label>
            <label class="check"><input v-model="forms.mesh.keepLargest" type="checkbox" />Keep largest</label>
            <label class="check"><input v-model="forms.mesh.center" type="checkbox" />Center geometry</label>
          </div>
          <button class="primary" type="button" @click="runStep('tifToMesh', forms.mesh)"><Play :size="17" />Create mesh</button>
        </article>

        <article class="panel">
          <div class="panel-title">
            <Settings2 :size="20" />
            <h2>Smooth And Simplify Mesh</h2>
          </div>
          <div class="form-grid">
            <ProjectPathInput v-model="forms.smooth.input" label="Input mesh" group="mesh" />
            <ProjectPathInput v-model="forms.smooth.out" label="Output mesh" group="mesh" mode="save" />
            <label>Smooth method<select v-model="forms.smooth.smoothMethod"><option>taubin</option><option>laplacian</option><option>none</option></select></label>
            <label>Smooth iterations<input v-model="forms.smooth.smoothIterations" type="number" /></label>
            <label>Target faces<input v-model="forms.smooth.targetFaces" type="number" /></label>
            <label>Decimation<select v-model="forms.smooth.decimateMethod"><option>cluster</option><option>quadric</option><option>auto</option><option>none</option></select></label>
            <label>Cluster iterations<input v-model="forms.smooth.clusterIterations" type="number" /></label>
            <label>Final smooth<input v-model="forms.smooth.finalSmoothIterations" type="number" /></label>
            <label class="check"><input v-model="forms.smooth.mergeVertices" type="checkbox" />Merge vertices first</label>
          </div>
          <button class="primary" type="button" @click="runStep('smoothMesh', forms.smooth)"><Play :size="17" />Smooth mesh</button>
        </article>

        <article class="panel">
          <div class="panel-title">
            <Box :size="20" />
            <h2>TIFF To Point Cloud</h2>
          </div>
          <div class="form-grid">
            <ProjectPathInput v-model="forms.pointcloud.tif" label="TIFF path" group="tif" />
            <ProjectPathInput v-model="forms.pointcloud.out" label="Output PLY/XYZ" group="pointcloud" mode="save" />
            <ProjectPathInput v-model="forms.pointcloud.npy" label="Output NPY" group="pointcloud" mode="save" />
            <label>Threshold<input v-model="forms.pointcloud.threshold" type="number" step="0.1" /></label>
            <label>Number of points<input v-model="forms.pointcloud.numPoints" type="number" /></label>
            <label>Method<select v-model="forms.pointcloud.method"><option>mesh-surface</option><option>surface-voxels</option><option>volume-voxels</option></select></label>
            <label>Downsample<input v-model="forms.pointcloud.downsample" type="number" min="1" /></label>
            <label>ROI start Z Y X<input v-model="forms.pointcloud.roiStart" /></label>
            <label>ROI size Z Y X<input v-model="forms.pointcloud.roiSize" /></label>
            <label>Auto-crop padding<input v-model="forms.pointcloud.autoCropPadding" /></label>
            <label>Minimum component size<input v-model="forms.pointcloud.minSize" type="number" /></label>
            <label>Opening radius<input v-model="forms.pointcloud.openingRadius" type="number" /></label>
            <label>Closing radius<input v-model="forms.pointcloud.closingRadius" type="number" /></label>
            <label>Seed<input v-model="forms.pointcloud.seed" type="number" /></label>
            <label class="check"><input v-model="forms.pointcloud.autoCrop" type="checkbox" />Auto-crop</label>
            <label class="check"><input v-model="forms.pointcloud.fillHoles" type="checkbox" />Fill holes</label>
            <label class="check"><input v-model="forms.pointcloud.keepLargest" type="checkbox" />Keep largest</label>
            <label class="check"><input v-model="forms.pointcloud.center" type="checkbox" />Center</label>
          </div>
          <button class="primary" type="button" @click="runStep('tifToPointcloud', forms.pointcloud)"><Play :size="17" />Create point cloud</button>
        </article>
      </section>

      <section v-show="activeSection === 'features'" class="grid two">
        <article class="panel">
          <div class="panel-title">
            <Sparkles :size="20" />
            <h2>Mesh Diff3F Descriptors</h2>
            <button class="title-action" type="button" title="Fill this query with a small camel example" @click="loadCamelDescriptorExample">
              Camel example
            </button>
          </div>
          <div class="form-grid single">
            <ProjectPathInput v-model="forms.meshFeatures.mesh" label="Mesh" group="mesh" multiple />
            <label>Prompt<textarea v-model="forms.meshFeatures.prompt" rows="3" /></label>
            <ProjectPathInput v-model="forms.meshFeatures.outdir" label="Output folder" mode="directory" />
          </div>
          <div class="compact-grid">
            <label>Views<input v-model="forms.meshFeatures.numViews" type="number" /></label>
            <label>Sampling<select v-model="forms.meshFeatures.viewSampling"><option>insect</option><option>fibonacci</option><option>grid</option></select></label>
            <label>Height<input v-model="forms.meshFeatures.height" type="number" /></label>
            <label>Width<input v-model="forms.meshFeatures.width" type="number" /></label>
            <label>Tolerance<input v-model="forms.meshFeatures.tolerance" type="number" step="0.001" /></label>
            <label>Device<input v-model="forms.meshFeatures.device" placeholder="optional" /></label>
          </div>
          <div class="capture-options" :class="{ active: forms.meshFeatures.captureImages }">
            <label class="check">
              <input v-model="forms.meshFeatures.captureImages" type="checkbox" />
              Capture images from this descriptor run
            </label>
            <template v-if="forms.meshFeatures.captureImages">
              <p>The saved images are the exact views used to build the <code>.pt</code> descriptor. No second diffusion pass is run.</p>
              <div class="capture-fields">
                <ProjectPathInput v-model="forms.meshFeatures.debugOutdir" label="Image/debug folder" mode="directory" />
                <label>Views to capture<input v-model="forms.meshFeatures.debugViews" placeholder="all, 0, 0-3, or 0 4 8" /></label>
              </div>
            </template>
          </div>
          <label class="check" :title="forms.meshFeatures.captureImages ? 'Capture requires a fresh descriptor run.' : ''">
            <input v-model="forms.meshFeatures.skipExisting" type="checkbox" :disabled="forms.meshFeatures.captureImages" />Skip existing
          </label>
          <label class="check"><input v-model="forms.meshFeatures.tosca" type="checkbox" />TOSCA scaling (camel/cow meshes)</label>
          <label class="check"><input v-model="forms.meshFeatures.noNormalMap" type="checkbox" />No normal map</label>
          <button class="primary" type="button" @click="runStep('meshFeatures', forms.meshFeatures)">
            <Play :size="17" />{{ forms.meshFeatures.captureImages ? "Compute descriptors + capture images" : "Compute mesh descriptors" }}
          </button>
        </article>

        <article class="panel">
          <div class="panel-title">
            <Sparkles :size="20" />
            <h2>Point-Cloud Diff3F Descriptors</h2>
          </div>
          <div class="form-grid single">
            <ProjectPathInput v-model="forms.pointcloudFeatures.pointcloud" label="Point cloud" group="pointcloud" multiple />
            <label>Prompt<textarea v-model="forms.pointcloudFeatures.prompt" rows="3" /></label>
            <ProjectPathInput v-model="forms.pointcloudFeatures.outdir" label="Output folder" mode="directory" />
          </div>
          <div class="compact-grid">
            <label>Views<input v-model="forms.pointcloudFeatures.numViews" type="number" /></label>
            <label>Sampling<select v-model="forms.pointcloudFeatures.viewSampling"><option>insect</option><option>fibonacci</option><option>grid</option></select></label>
            <label>Height<input v-model="forms.pointcloudFeatures.height" type="number" /></label>
            <label>Width<input v-model="forms.pointcloudFeatures.width" type="number" /></label>
            <label>Point radius<input v-model="forms.pointcloudFeatures.pointRadius" type="number" step="0.001" /></label>
            <label>Points/pixel<input v-model="forms.pointcloudFeatures.pointsPerPixel" type="number" /></label>
            <label>Device<input v-model="forms.pointcloudFeatures.device" placeholder="optional" /></label>
          </div>
          <div class="capture-options" :class="{ active: forms.pointcloudFeatures.captureImages }">
            <label class="check">
              <input v-model="forms.pointcloudFeatures.captureImages" type="checkbox" />
              Capture images from this descriptor run
            </label>
            <template v-if="forms.pointcloudFeatures.captureImages">
              <p>The saved images are the exact views used to build the <code>.pt</code> descriptor. No second diffusion pass is run.</p>
              <div class="capture-fields">
                <ProjectPathInput v-model="forms.pointcloudFeatures.debugOutdir" label="Image/debug folder" mode="directory" />
                <label>Views to capture<input v-model="forms.pointcloudFeatures.debugViews" placeholder="all, 0, 0-3, or 0 4 8" /></label>
              </div>
            </template>
          </div>
          <label class="check" :title="forms.pointcloudFeatures.captureImages ? 'Capture requires a fresh descriptor run.' : ''">
            <input v-model="forms.pointcloudFeatures.skipExisting" type="checkbox" :disabled="forms.pointcloudFeatures.captureImages" />Skip existing
          </label>
          <label class="check"><input v-model="forms.pointcloudFeatures.noNormalMap" type="checkbox" />No normal map</label>
          <button class="primary" type="button" @click="runStep('pointcloudFeatures', forms.pointcloudFeatures)">
            <Play :size="17" />{{ forms.pointcloudFeatures.captureImages ? "Compute descriptors + capture images" : "Compute point descriptors" }}
          </button>
        </article>

        <article class="panel descriptor-ply-panel">
          <div class="panel-title">
            <Palette :size="20" />
            <div class="panel-heading-copy">
              <h2>Export Descriptor Colors To PLY</h2>
              <span>Runs on the CPU in seconds; Diff3F is not run again</span>
            </div>
            <button class="title-action" type="button" title="Fill the exporter with the camel result" @click="loadCamelPlyExample">
              Camel example
            </button>
          </div>

          <div class="ply-export-intro">
            <div class="ply-kind-switch" role="group" aria-label="Geometry type">
              <button
                type="button"
                :class="{ active: plyExportKind === 'mesh' }"
                :aria-pressed="plyExportKind === 'mesh'"
                @click="plyExportKind = 'mesh'"
              >
                Mesh
              </button>
              <button
                type="button"
                :class="{ active: plyExportKind === 'pointcloud' }"
                :aria-pressed="plyExportKind === 'pointcloud'"
                @click="plyExportKind = 'pointcloud'"
              >
                Point cloud
              </button>
            </div>
            <p>
              Combines the original geometry with PCA-derived RGB colors from its <code>.pt</code> descriptor.
              The complete 2,048-D features remain in the <code>.pt</code> file.
            </p>
          </div>

          <div v-if="plyExportKind === 'mesh'" class="form-grid">
            <ProjectPathInput v-model="forms.meshViz.mesh" label="Original mesh" group="mesh" />
            <ProjectPathInput v-model="forms.meshViz.features" label="Descriptor .pt" group="features" />
            <ProjectPathInput v-model="forms.meshViz.out" label="Output colored PLY" group="mesh" mode="save" />
            <ProjectPathInput v-model="forms.meshViz.preview" label="Preview PNG (optional)" group="preview" mode="save" />
          </div>
          <div v-else class="form-grid">
            <ProjectPathInput v-model="forms.pointcloudViz.pointcloud" label="Original point cloud" group="pointcloud" />
            <ProjectPathInput v-model="forms.pointcloudViz.features" label="Descriptor .pt" group="features" />
            <ProjectPathInput v-model="forms.pointcloudViz.out" label="Output colored PLY" group="pointcloud" mode="save" />
            <ProjectPathInput v-model="forms.pointcloudViz.preview" label="Preview PNG (optional)" group="preview" mode="save" />
          </div>

          <p class="ply-export-warning">
            Use the exact geometry that produced the descriptor: vertex/point row order must match. For colors that are comparable across several insects, use the shared-PCA comparison workflow.
          </p>
          <button class="primary" type="button" @click="runPlyExport">
            <Palette :size="17" />Generate colored PLY
          </button>
        </article>
      </section>

      <section v-show="activeSection === 'visualize'" class="stack visualization-workspace">
        <div class="visualization-switcher" role="tablist" aria-label="Visualization mode">
          <button
            :class="{ active: visualizationMode === 'mesh' }"
            :aria-selected="visualizationMode === 'mesh'"
            role="tab"
            type="button"
            @click="visualizationMode = 'mesh'"
          >
            <Eye :size="17" />
            <span><strong>Mesh viewer</strong><small>Inspect PCA colors and project geometry</small></span>
          </button>
          <button
            :class="{ active: visualizationMode === 'correspondence' }"
            :aria-selected="visualizationMode === 'correspondence'"
            role="tab"
            type="button"
            @click="visualizationMode = 'correspondence'"
          >
            <Activity :size="17" />
            <span><strong>Correspondences</strong><small>Compare matches, errors, and exact vertex indices</small></span>
          </button>
        </div>

        <KeepAlive>
          <component
            :is="visualizationMode === 'mesh' ? PcaMeshViewer : CorrespondenceViewer"
            v-if="activeSection === 'visualize'"
            :key="visualizationMode"
          />
        </KeepAlive>

      </section>

      <section v-show="activeSection === 'match'" class="stack">
        <article class="panel">
          <div class="panel-title"><Activity :size="20" /><h2>Feature Correspondences</h2></div>
          <div class="form-grid">
            <label>Source name<input v-model="forms.correspondence.sourceName" /></label>
            <label>Target name<input v-model="forms.correspondence.targetName" /></label>
            <ProjectPathInput v-model="forms.correspondence.sourceGeometry" label="Source geometry" group="geometry" />
            <ProjectPathInput v-model="forms.correspondence.targetGeometry" label="Target geometry" group="geometry" />
            <ProjectPathInput v-model="forms.correspondence.sourceFeatures" label="Source features" group="features" />
            <ProjectPathInput v-model="forms.correspondence.targetFeatures" label="Target features" group="features" />
            <ProjectPathInput v-model="forms.correspondence.outdir" label="Output folder" mode="directory" />
            <label>Samples<input v-model="forms.correspondence.numSourcePoints" type="number" /></label>
            <label>Sampling<select v-model="forms.correspondence.sampling"><option>farthest</option><option>random</option></select></label>
            <label>Seed<input v-model="forms.correspondence.seed" type="number" /></label>
            <ProjectPathInput v-model="forms.correspondence.sourceIndices" label="Source indices" group="indices" placeholder="optional .txt" />
            <label>Device<input v-model="forms.correspondence.device" placeholder="optional" /></label>
            <label class="check"><input v-model="forms.correspondence.mutualCheck" type="checkbox" />Mutual check</label>
          </div>
          <button class="primary" type="button" @click="runStep('correspondences', forms.correspondence)"><Play :size="17" />Compute matches</button>
        </article>

        <article class="panel">
          <div class="panel-title"><Eye :size="20" /><h2>Blender Correspondence Scene</h2></div>
          <div class="form-grid">
            <label>Source label<input v-model="forms.blenderScene.sourceLabel" /></label>
            <label>Target label<input v-model="forms.blenderScene.targetLabel" /></label>
            <ProjectPathInput v-model="forms.blenderScene.sourceGeometry" label="Source geometry" group="mesh" />
            <ProjectPathInput v-model="forms.blenderScene.targetGeometry" label="Target geometry" group="mesh" />
            <ProjectPathInput v-model="forms.blenderScene.matches" label="Matches CSV" group="landmarks" />
            <ProjectPathInput v-model="forms.blenderScene.output" label="Output .blend" group="blend" mode="save" />
            <label>Max matches<input v-model="forms.blenderScene.maxMatches" type="number" /></label>
            <label>Min score<input v-model="forms.blenderScene.minScore" type="number" step="0.01" /></label>
            <label class="check"><input v-model="forms.blenderScene.onlyMutual" type="checkbox" />Only mutual</label>
          </div>
          <button class="primary" type="button" @click="runStep('blenderCorrespondenceScene', forms.blenderScene)"><Play :size="17" />Create scene</button>
        </article>
      </section>

      <section v-show="activeSection === 'benchmark'" class="stack">
        <article class="panel">
          <div class="panel-title"><Gauge :size="20" /><h2>Landmark Benchmark</h2></div>
          <div class="form-grid">
            <label>Source name<input v-model="forms.benchmark.sourceName" /></label>
            <label>Target name<input v-model="forms.benchmark.targetName" /></label>
            <ProjectPathInput v-model="forms.benchmark.sourceGeometry" label="Source geometry" group="geometry" />
            <ProjectPathInput v-model="forms.benchmark.targetGeometry" label="Target geometry" group="geometry" />
            <ProjectPathInput v-model="forms.benchmark.sourceFeatures" label="Source features" group="features" />
            <ProjectPathInput v-model="forms.benchmark.targetFeatures" label="Target features" group="features" />
            <ProjectPathInput v-model="forms.benchmark.sourceLandmarks" label="Source landmarks CSV" group="landmarks" />
            <ProjectPathInput v-model="forms.benchmark.targetLandmarks" label="Target landmarks CSV" group="landmarks" />
            <ProjectPathInput v-model="forms.benchmark.outdir" label="Output folder" mode="directory" />
            <label>PCK thresholds<input v-model="forms.benchmark.thresholds" /></label>
            <label>Device<input v-model="forms.benchmark.device" placeholder="optional" /></label>
          </div>
          <button class="primary" type="button" @click="runStep('landmarkBenchmark', forms.benchmark)"><Play :size="17" />Run benchmark</button>
        </article>

        <article class="panel">
          <div class="panel-title"><Image :size="20" /><h2>Debug One Diff3F View</h2></div>
          <div class="form-grid">
            <label>Kind<select v-model="forms.debug.kind"><option>mesh</option><option>pointcloud</option></select></label>
            <ProjectPathInput
              v-model="forms.debug.input"
              label="Input geometry"
              :group="forms.debug.kind === 'mesh' ? 'mesh' : 'pointcloud'"
            />
            <label>Prompt<input v-model="forms.debug.prompt" /></label>
            <ProjectPathInput v-model="forms.debug.outdir" label="Output folder" mode="directory" />
            <label>Views<input v-model="forms.debug.numViews" type="number" /></label>
            <label>View index<input v-model="forms.debug.viewIndex" type="number" /></label>
            <label>Sampling<select v-model="forms.debug.viewSampling"><option>insect</option><option>fibonacci</option><option>grid</option></select></label>
            <label>Height<input v-model="forms.debug.height" type="number" /></label>
            <label>Width<input v-model="forms.debug.width" type="number" /></label>
            <label>Seed<input v-model="forms.debug.seed" type="number" /></label>
            <label class="check"><input v-model="forms.debug.renderOnly" type="checkbox" />Render only</label>
            <label class="check"><input v-model="forms.debug.allViews" type="checkbox" />All views</label>
            <label class="check"><input v-model="forms.debug.skipDiffusion" type="checkbox" />Skip diffusion</label>
          </div>
          <button class="primary" type="button" @click="runStep('debugView', forms.debug)"><Play :size="17" />Debug view</button>
        </article>
      </section>

      <section v-show="activeSection === 'jobs'" class="grid jobs-grid">
        <article class="panel">
          <div class="panel-title"><FileText :size="20" /><h2>Jobs</h2></div>
          <div class="job-list">
            <button
              v-for="job in jobs"
              :key="job.id"
              :class="{ selected: selectedJob?.id === job.id }"
              type="button"
              @click="activeJobId = job.id; refreshJobs();"
            >
              <component :is="statusIcon(job.status)" :class="{ spin: job.status === 'running' }" :size="17" />
              <span>{{ job.label }}</span>
              <em :class="statusClass(job.status)">{{ job.status }}</em>
            </button>
          </div>
        </article>

        <article class="panel log-panel">
          <div class="panel-title">
            <FileText :size="20" />
            <h2>{{ selectedJob?.label || "No job selected" }}</h2>
          </div>
          <div v-if="selectedJob" class="job-meta">
            <span :class="statusClass(selectedJob.status)">{{ selectedJob.status }}</span>
            <button v-if="selectedJob.status === 'running'" type="button" class="secondary" @click="stopJob(selectedJob)">Stop</button>
          </div>
          <pre>{{ activeJob?.log || selectedJob?.logTail || "Run a pipeline step to see logs here." }}</pre>
          <div v-if="selectedJob?.outputs?.length" class="downloads">
            <a v-for="output in selectedJob.outputs" :key="output.path" :href="downloadUrl(output.path)">
              <Download :size="16" />
              {{ output.label }}
            </a>
          </div>
        </article>
      </section>

      <section v-show="activeSection === 'docs'" class="grid two">
        <article class="panel doc">
          <div class="panel-title"><Info :size="20" /><h2>Workflow notes</h2></div>
          <p><strong>CT to mesh:</strong> preview the volume first, pick the threshold from the histogram and overlays, keep the largest component, and use <em>Fill holes</em> when internal cavities leave loose inner surfaces. Keep <code>downsample</code> at 1 for final meshes.</p>
          <p><strong>Smoothing:</strong> smoothing and decimation change the vertex count and order, so every smoothed mesh needs its own <code>.pt</code> descriptor.</p>
          <p><strong>Orientation:</strong> rotate specimens to a common pose (Blender, <em>Apply rotation</em>, export OBJ) before computing descriptors; the camera layouts are fixed in world space.</p>
          <p><strong>Landmarks:</strong> marker names must match across specimens, e.g. <code>LM_HEAD_TIP</code>. Export them with <code>scripts/export_blender_landmarks.py</code> before running the benchmark.</p>
        </article>
        <article class="panel doc">
          <div class="panel-title"><Clipboard :size="20" /><h2>Settings used in the project</h2></div>
          <ul>
            <li>Cricket threshold: <code>45</code> for <code>bcrick_10_010</code> and <code>sfaar_10_010</code>.</li>
            <li>Smoothing: Taubin <code>10</code> iterations, cluster decimation to <code>50000</code> faces, final Taubin <code>3</code>.</li>
            <li>Descriptors: <code>16</code> views, <code>512 x 512</code>, <code>insect</code> view sampling.</li>
            <li>Cricket prompt: <em>cricket insect, full body, long antennae, large hind legs, segmented insect body, detailed exoskeleton, macro photograph</em>.</li>
          </ul>
        </article>
      </section>
    </main>
  </div>
</template>
