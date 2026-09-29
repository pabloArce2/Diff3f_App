<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  X,
} from "@lucide/vue";

const props = defineProps({
  modelValue: {
    type: [String, Array],
    default: "",
  },
  label: {
    type: String,
    required: true,
  },
  group: {
    type: String,
    default: "preview",
  },
  mode: {
    type: String,
    default: "file",
    validator: (value) => ["file", "directory", "save"].includes(value),
  },
  multiple: {
    type: Boolean,
    default: false,
  },
  placeholder: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:modelValue"]);

const inputId = `project-path-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
const dialogTitleId = `${inputId}-dialog-title`;
const isOpen = ref(false);
const loading = ref(false);
const error = ref("");
const currentPath = ref("");
const parentPath = ref(null);
const entries = ref([]);
const locationDraft = ref("");
const searchQuery = ref("");
const selectedPath = ref("");
const selectedPaths = ref(new Set());
const saveName = ref("");
const searchInput = ref(null);
let browseRequest = 0;
let previousBodyOverflow = "";

const displayedValue = computed(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue.join(" ");
  return props.modelValue ?? "";
});

const visibleEntries = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return entries.value.filter((entry) => {
    if (props.mode === "directory" && entry.kind !== "directory") return false;
    return !query || entry.name.toLocaleLowerCase().includes(query);
  });
});

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split("/").filter(Boolean);
  return [
    { name: "Project", relative: "" },
    ...parts.map((name, index) => ({
      name,
      relative: parts.slice(0, index + 1).join("/"),
    })),
  ];
});

const selectionCount = computed(() => selectedPaths.value.size);
const canConfirmFile = computed(() => (
  props.multiple ? selectedPaths.value.size > 0 : Boolean(selectedPath.value)
));
const canConfirmSave = computed(() => {
  const name = saveName.value.trim();
  return Boolean(name) && !/[\\/]/.test(name) && name !== "." && name !== "..";
});
const pickerDescription = computed(() => {
  if (props.mode === "directory") return "Choose an existing folder. You can still type a new folder path in the field.";
  if (props.mode === "save") return "Choose a folder, then keep or edit the output filename.";
  if (props.multiple) return "Choose one or more existing project files.";
  return "Choose an existing project file.";
});

watch(isOpen, (open) => {
  if (open) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = previousBodyOverflow;
  }
});

watch(() => props.group, () => {
  if (isOpen.value) openAtInitialLocation();
});

function updateManualValue(event) {
  emit("update:modelValue", event.target.value);
}

async function openPicker() {
  initialiseSelection();
  isOpen.value = true;
  await nextTick();
  await openAtInitialLocation();
  await nextTick();
  searchInput.value?.focus();
}

function closePicker() {
  isOpen.value = false;
  error.value = "";
  searchQuery.value = "";
}

function initialiseSelection() {
  const values = modelValues().map(normaliseRelative).filter(Boolean);
  selectedPath.value = props.multiple ? "" : (values[0] || "");
  selectedPaths.value = new Set(props.multiple ? values : []);
  saveName.value = props.mode === "save" ? basename(values[0] || "") : "";
}

async function openAtInitialLocation() {
  const firstValue = modelValues()[0] || "";
  let candidate = normaliseRelative(firstValue);
  if (props.mode !== "directory") candidate = dirname(candidate);
  await openDeepestExistingDirectory(candidate);
}

async function openDeepestExistingDirectory(candidate) {
  await loadDirectory("");
  if (!candidate || !isOpen.value) return;

  const parts = candidate.split("/").filter(Boolean);
  for (const part of parts) {
    const nextFolder = entries.value.find((entry) => (
      entry.kind === "directory" && entry.name.toLocaleLowerCase() === part.toLocaleLowerCase()
    ));
    if (!nextFolder) break;
    await loadDirectory(nextFolder.relative);
    if (!isOpen.value || error.value) break;
  }
}

async function loadDirectory(relativePath) {
  const request = ++browseRequest;
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({
      path: normaliseRelative(relativePath),
      group: props.group,
    });
    const response = await fetch(`/api/browse?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not open folder (${response.status}).`);
    if (request !== browseRequest) return;

    currentPath.value = normaliseRelative(payload.path || "");
    parentPath.value = payload.parent === null ? null : normaliseRelative(payload.parent || "");
    entries.value = Array.isArray(payload.entries) ? payload.entries : [];
    locationDraft.value = currentPath.value;
    searchQuery.value = "";
  } catch (browseError) {
    if (request === browseRequest) {
      error.value = browseError.message || String(browseError);
    }
  } finally {
    if (request === browseRequest) loading.value = false;
  }
}

function goToLocation() {
  loadDirectory(locationDraft.value);
}

function activateEntry(entry) {
  if (entry.kind === "directory") {
    loadDirectory(entry.relative);
    return;
  }

  if (props.mode === "save") {
    saveName.value = entry.name;
    selectedPath.value = entry.relative;
    return;
  }

  if (props.multiple) {
    const next = new Set(selectedPaths.value);
    if (next.has(entry.relative)) next.delete(entry.relative);
    else next.add(entry.relative);
    selectedPaths.value = next;
    return;
  }

  selectedPath.value = entry.relative;
}

function openEntry(entry) {
  if (entry.kind === "directory") {
    loadDirectory(entry.relative);
  } else if (props.mode === "file" && !props.multiple) {
    selectedPath.value = entry.relative;
    confirmFile();
  } else {
    activateEntry(entry);
  }
}

function confirmFile() {
  if (!canConfirmFile.value) return;
  const result = props.multiple
    ? [...selectedPaths.value].map(toWindowsPath).join(" ")
    : toWindowsPath(selectedPath.value);
  emit("update:modelValue", result);
  closePicker();
}

function confirmDirectory() {
  emit("update:modelValue", toWindowsPath(currentPath.value || "."));
  closePicker();
}

function confirmSave() {
  if (!canConfirmSave.value) return;
  const relative = [currentPath.value, saveName.value.trim()].filter(Boolean).join("/");
  emit("update:modelValue", toWindowsPath(relative));
  closePicker();
}

function modelValues() {
  if (Array.isArray(props.modelValue)) {
    return props.modelValue.map(String).map((value) => value.trim()).filter(Boolean);
  }
  const value = String(props.modelValue || "").trim();
  if (!value) return [];
  return props.multiple ? value.split(/\s+/).filter(Boolean) : [value];
}

function normaliseRelative(value) {
  let result = String(value || "").trim().replaceAll("\\", "/");
  result = result.replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  if (/^[a-zA-Z]:\//.test(result) || result.startsWith("//")) return "";
  return result.replace(/^\/+|\/+$/g, "");
}

function dirname(value) {
  const normalised = normaliseRelative(value);
  const separator = normalised.lastIndexOf("/");
  return separator < 0 ? "" : normalised.slice(0, separator);
}

function basename(value) {
  const normalised = normaliseRelative(value);
  return normalised.split("/").at(-1) || "";
}

function toWindowsPath(value) {
  return String(value || "").replaceAll("/", "\\");
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function handleKeydown(event) {
  if (isOpen.value && event.key === "Escape") closePicker();
}

window.addEventListener("keydown", handleKeydown);
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  if (isOpen.value) document.body.style.overflow = previousBodyOverflow;
});
</script>

<template>
  <div class="project-path-field">
    <label :for="inputId">{{ label }}</label>
    <div class="path-input-row">
      <input
        :id="inputId"
        :value="displayedValue"
        :placeholder="placeholder"
        autocomplete="off"
        spellcheck="false"
        @input="updateManualValue"
      />
      <button
        class="browse-button"
        type="button"
        :aria-label="`Browse ${label}`"
        :title="`Browse ${label}`"
        @click="openPicker"
      >
        <FolderOpen :size="18" />
      </button>
    </div>

    <Teleport to="body">
      <div v-if="isOpen" class="path-dialog-backdrop" @mousedown.self="closePicker">
        <section class="path-dialog" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId">
          <header class="dialog-header">
            <div>
              <span class="dialog-kicker">Project files</span>
              <h2 :id="dialogTitleId">{{ label }}</h2>
              <p>{{ pickerDescription }}</p>
            </div>
            <button class="close-button" type="button" aria-label="Close file browser" title="Close" @click="closePicker">
              <X :size="19" />
            </button>
          </header>

          <nav class="breadcrumbs" aria-label="Current folder">
            <template v-for="(crumb, index) in breadcrumbs" :key="crumb.relative">
              <ChevronRight v-if="index" :size="14" aria-hidden="true" />
              <button type="button" :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined" @click="loadDirectory(crumb.relative)">
                {{ crumb.name }}
              </button>
            </template>
          </nav>

          <div class="browser-toolbar">
            <button
              class="toolbar-button"
              type="button"
              aria-label="Go to parent folder"
              title="Up one folder"
              :disabled="parentPath === null || loading"
              @click="loadDirectory(parentPath)"
            >
              <ChevronLeft :size="18" />
            </button>
            <form class="location-field" @submit.prevent="goToLocation">
              <span>Project /</span>
              <input v-model="locationDraft" aria-label="Project-relative folder path" spellcheck="false" />
            </form>
            <button class="go-button" type="button" :disabled="loading" @click="goToLocation">Go</button>
          </div>

          <label class="browser-search">
            <Search :size="17" aria-hidden="true" />
            <input ref="searchInput" v-model="searchQuery" placeholder="Search this folder" />
            <button v-if="searchQuery" type="button" aria-label="Clear search" @click="searchQuery = ''">
              <X :size="15" />
            </button>
          </label>

          <div class="entry-list" :aria-busy="loading">
            <div v-if="loading" class="browser-state"><Loader2 class="spin" :size="21" />Opening folder…</div>
            <div v-else-if="error" class="browser-state error-state">
              <strong>Could not open that folder</strong>
              <span>{{ error }}</span>
            </div>
            <div v-else-if="!visibleEntries.length" class="browser-state">
              <FolderOpen :size="24" />
              <span>{{ searchQuery ? "No matching items in this folder." : "This folder has no matching items." }}</span>
            </div>
            <template v-else>
              <button
                v-for="entry in visibleEntries"
                :key="entry.relative"
                class="entry-row"
                :class="{
                  selected: selectedPath === entry.relative || selectedPaths.has(entry.relative),
                  directory: entry.kind === 'directory',
                }"
                type="button"
                :aria-pressed="entry.kind === 'file' ? selectedPath === entry.relative || selectedPaths.has(entry.relative) : undefined"
                @click="activateEntry(entry)"
                @dblclick="openEntry(entry)"
              >
                <Folder v-if="entry.kind === 'directory'" :size="19" />
                <File v-else :size="19" />
                <span class="entry-name">{{ entry.name }}</span>
                <span v-if="entry.kind === 'file'" class="entry-size">{{ formatSize(entry.size) }}</span>
                <Check v-if="entry.kind === 'file' && (selectedPath === entry.relative || selectedPaths.has(entry.relative))" class="entry-check" :size="18" />
                <ChevronRight v-else-if="entry.kind === 'directory'" class="entry-chevron" :size="17" />
              </button>
            </template>
          </div>

          <div v-if="mode === 'save'" class="save-row">
            <label :for="`${inputId}-filename`">Filename</label>
            <input
              :id="`${inputId}-filename`"
              v-model="saveName"
              placeholder="output.ext"
              spellcheck="false"
              @keydown.enter.prevent="confirmSave"
            />
            <small v-if="saveName && !canConfirmSave">Enter a filename without folder separators.</small>
          </div>

          <footer class="dialog-footer">
            <div class="selection-summary">
              <template v-if="mode === 'file' && multiple">
                {{ selectionCount }} file{{ selectionCount === 1 ? "" : "s" }} selected
              </template>
              <template v-else-if="mode === 'file' && selectedPath">
                {{ selectedPath }}
              </template>
              <template v-else>
                Project / {{ currentPath || "" }}
              </template>
            </div>
            <div class="dialog-actions">
              <button class="cancel-button" type="button" @click="closePicker">Cancel</button>
              <button v-if="mode === 'directory'" class="confirm-button" type="button" :disabled="loading || !!error" @click="confirmDirectory">
                Use this folder
              </button>
              <button v-else-if="mode === 'save'" class="confirm-button" type="button" :disabled="loading || !!error || !canConfirmSave" @click="confirmSave">
                Use this path
              </button>
              <button v-else class="confirm-button" type="button" :disabled="loading || !!error || !canConfirmFile" @click="confirmFile">
                {{ multiple ? `Use selected (${selectionCount})` : "Use file" }}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.project-path-field {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.project-path-field > label {
  color: var(--muted);
  font-size: 12px;
}

.path-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
}

.path-input-row input {
  border-right: 0;
  min-width: 0;
}

.browse-button {
  align-items: center;
  background: #eef4f2;
  border: 1px solid #c4d2d0;
  color: var(--teal-dark);
  display: inline-flex;
  justify-content: center;
  min-height: 38px;
}

.browse-button:hover,
.browse-button:focus-visible {
  background: #dfecea;
  border-color: var(--teal);
  outline: none;
}

.path-dialog-backdrop {
  align-items: center;
  background: rgba(18, 27, 30, 0.62);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 20px;
  position: fixed;
  z-index: 2000;
}

.path-dialog {
  background: #fff;
  border: 1px solid #cbd6d4;
  box-shadow: 0 28px 80px rgba(9, 24, 27, 0.3);
  display: grid;
  grid-template-rows: auto auto auto auto minmax(190px, 1fr) auto auto;
  max-height: min(780px, calc(100vh - 40px));
  max-width: 780px;
  min-height: min(650px, calc(100vh - 40px));
  overflow: hidden;
  width: min(780px, calc(100vw - 40px));
}

.dialog-header {
  align-items: flex-start;
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 20px 22px 16px;
}

.dialog-header h2 {
  color: var(--ink);
  font-size: 20px;
  margin: 2px 0 4px;
}

.dialog-header p {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}

.dialog-kicker {
  color: var(--teal);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.close-button,
.toolbar-button,
.browser-search button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--muted);
  display: inline-flex;
  justify-content: center;
}

.close-button {
  height: 34px;
  width: 34px;
}

.close-button:hover,
.toolbar-button:hover:not(:disabled),
.browser-search button:hover {
  background: #eef3f2;
  color: var(--ink);
}

.breadcrumbs {
  align-items: center;
  border-bottom: 1px solid #e7eceb;
  display: flex;
  gap: 2px;
  min-height: 42px;
  overflow-x: auto;
  padding: 6px 18px;
}

.breadcrumbs button {
  background: transparent;
  border: 0;
  color: var(--teal-dark);
  flex: 0 0 auto;
  font-size: 12px;
  padding: 4px 5px;
}

.breadcrumbs button[aria-current="location"] {
  color: var(--ink);
  font-weight: 700;
}

.browser-toolbar {
  display: grid;
  gap: 8px;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  padding: 12px 18px 7px;
}

.toolbar-button,
.go-button {
  border: 1px solid var(--line);
  min-height: 38px;
}

.toolbar-button:disabled,
.go-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.location-field {
  align-items: center;
  border: 1px solid #cfd8d7;
  display: flex;
  min-width: 0;
}

.location-field:focus-within {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(31, 118, 118, 0.13);
}

.location-field span {
  color: var(--muted);
  flex: 0 0 auto;
  font-size: 12px;
  padding-left: 10px;
}

.location-field input {
  border: 0;
  box-shadow: none;
  min-height: 36px;
  padding-left: 5px;
}

.go-button {
  background: #f7f9f8;
  color: var(--ink);
  padding: 0 13px;
}

.browser-search {
  align-items: center;
  border: 1px solid #cfd8d7;
  color: var(--muted);
  display: grid;
  gap: 7px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin: 5px 18px 10px;
  padding: 0 9px;
}

.browser-search:focus-within {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(31, 118, 118, 0.13);
}

.browser-search input {
  border: 0;
  box-shadow: none;
  min-height: 36px;
  padding: 6px 0;
}

.browser-search button {
  height: 26px;
  width: 26px;
}

.entry-list {
  border-bottom: 1px solid var(--line);
  border-top: 1px solid var(--line);
  min-height: 190px;
  overflow-y: auto;
}

.entry-row {
  align-items: center;
  background: #fff;
  border: 0;
  border-bottom: 1px solid #edf0ef;
  color: var(--ink);
  display: grid;
  gap: 10px;
  grid-template-columns: 22px minmax(0, 1fr) auto 22px;
  min-height: 43px;
  padding: 7px 20px;
  text-align: left;
  width: 100%;
}

.entry-row:hover {
  background: #f5f9f8;
}

.entry-row.selected {
  background: #e7f2f0;
  color: var(--teal-dark);
}

.entry-row.directory > svg:first-child {
  color: #b47930;
}

.entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-size {
  color: var(--muted);
  font-size: 11px;
}

.entry-check {
  color: var(--teal);
}

.entry-chevron {
  color: #9ba5a8;
}

.browser-state {
  align-items: center;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  min-height: 190px;
  padding: 28px;
  text-align: center;
}

.error-state strong {
  color: var(--red);
}

.error-state span {
  font-size: 12px;
}

.save-row {
  display: grid;
  gap: 5px 10px;
  grid-template-columns: 92px minmax(0, 1fr);
  padding: 12px 20px 0;
}

.save-row label {
  align-self: center;
  color: var(--muted);
  font-size: 12px;
}

.save-row small {
  color: var(--red);
  grid-column: 2;
}

.dialog-footer {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  min-height: 68px;
  padding: 12px 20px;
}

.selection-summary {
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.cancel-button,
.confirm-button {
  border: 1px solid var(--line);
  min-height: 38px;
  padding: 7px 14px;
}

.cancel-button {
  background: #fff;
  color: var(--ink);
}

.confirm-button {
  background: var(--teal);
  border-color: var(--teal);
  color: #fff;
}

.confirm-button:hover:not(:disabled) {
  background: var(--teal-dark);
}

.confirm-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.spin {
  animation: picker-spin 0.85s linear infinite;
}

@keyframes picker-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .path-dialog-backdrop {
    padding: 0;
  }

  .path-dialog {
    height: 100dvh;
    max-height: none;
    min-height: 0;
    width: 100vw;
  }

  .dialog-header {
    padding: 16px;
  }

  .breadcrumbs,
  .browser-toolbar {
    padding-left: 12px;
    padding-right: 12px;
  }

  .browser-search {
    margin-left: 12px;
    margin-right: 12px;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .selection-summary {
    min-height: 14px;
  }

  .dialog-actions {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
