<script setup>
import { computed, ref, watch } from "vue";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  History,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "@lucide/vue";

const props = defineProps({
  files: { type: Array, default: () => [] },
  activePath: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  recents: { type: Array, default: () => [] },
});

const emit = defineEmits(["open", "refresh", "open-recent", "clear-recent"]);

const searchQuery = ref("");
const recentOpen = ref(true);
const expandedFolders = ref(new Set());

const matchingFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return props.files;
  return props.files.filter((file) => normalizePath(file.relative).toLowerCase().includes(query));
});

const treeRoots = computed(() => buildTree(matchingFiles.value));

const visibleRows = computed(() => {
  const rows = [];
  flattenTree(treeRoots.value, 0, rows, Boolean(searchQuery.value.trim()));
  return rows;
});

watch(
  [() => props.activePath, () => props.files.length],
  () => expandActivePath(),
  { immediate: true },
);

function buildTree(files) {
  const root = { children: new Map() };

  for (const file of files) {
    const relative = normalizePath(file.relative);
    const parts = relative.split("/").filter(Boolean);
    let parent = root;
    let folderPath = "";

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      if (isFile) {
        parent.children.set(`file:${relative}`, {
          type: "file",
          name: part,
          path: relative,
          file,
        });
        return;
      }

      folderPath = folderPath ? `${folderPath}/${part}` : part;
      const key = `folder:${folderPath}`;
      if (!parent.children.has(key)) {
        parent.children.set(key, {
          type: "folder",
          name: part,
          path: folderPath,
          children: new Map(),
        });
      }
      parent = parent.children.get(key);
    });
  }

  return sortChildren(root.children);
}

function sortChildren(children) {
  return Array.from(children.values())
    .map((node) => ({
      ...node,
      children: node.type === "folder" ? sortChildren(node.children) : undefined,
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    });
}

function flattenTree(nodes, depth, rows, forceOpen) {
  for (const node of nodes) {
    const expanded = forceOpen || expandedFolders.value.has(node.path);
    rows.push({ ...node, depth, expanded });
    if (node.type === "folder" && expanded) {
      flattenTree(node.children, depth + 1, rows, forceOpen);
    }
  }
}

function toggleFolder(pathValue) {
  const next = new Set(expandedFolders.value);
  if (next.has(pathValue)) next.delete(pathValue);
  else next.add(pathValue);
  expandedFolders.value = next;
}

function expandActivePath() {
  const active = normalizePath(props.activePath);
  if (!active || active.startsWith("local:")) return;
  const parts = active.split("/").filter(Boolean);
  const next = new Set(expandedFolders.value);
  let folderPath = "";
  for (const part of parts.slice(0, -1)) {
    folderPath = folderPath ? `${folderPath}/${part}` : part;
    next.add(folderPath);
  }
  expandedFolders.value = next;
}

function isActive(pathValue) {
  return normalizePath(pathValue).toLowerCase() === normalizePath(props.activePath).toLowerCase();
}

function extension(name) {
  return name.split(".").pop()?.toUpperCase() || "3D";
}

function parentLabel(pathValue) {
  const parts = normalizePath(pathValue).split("/");
  parts.pop();
  return parts.slice(-2).join("/") || "Project";
}

function normalizePath(pathValue) {
  return String(pathValue || "").replaceAll("\\", "/");
}
</script>

<template>
  <aside class="mesh-explorer" aria-label="Project mesh explorer">
    <div class="explorer-heading">
      <div>
        <strong>Explorer</strong>
        <span>{{ files.length }} meshes</span>
      </div>
      <button type="button" title="Refresh project meshes" @click="emit('refresh')">
        <RefreshCw :class="{ spin: loading }" :size="16" />
      </button>
    </div>

    <label class="explorer-search">
      <Search :size="15" />
      <input v-model="searchQuery" type="search" placeholder="Filter meshes" @keydown.esc="searchQuery = ''" />
    </label>

    <div class="tree-scroll">
      <div v-if="loading && !files.length" class="explorer-message"><Loader2 class="spin" :size="17" />Indexing meshes</div>
      <div v-else-if="error" class="explorer-message error">{{ error }}</div>
      <div v-else-if="!visibleRows.length" class="explorer-message">No matching meshes</div>

      <template v-for="row in visibleRows" :key="`${row.type}:${row.path}`">
        <button
          v-if="row.type === 'folder'"
          class="tree-row folder-row"
          type="button"
          :style="{ '--tree-depth': row.depth }"
          :title="row.path"
          @click="toggleFolder(row.path)"
        >
          <ChevronDown v-if="row.expanded" :size="14" />
          <ChevronRight v-else :size="14" />
          <FolderOpen v-if="row.expanded" :size="15" />
          <Folder v-else :size="15" />
          <span>{{ row.name }}</span>
        </button>

        <button
          v-else
          class="tree-row file-row"
          :class="{ active: isActive(row.path) }"
          type="button"
          :style="{ '--tree-depth': row.depth }"
          :title="row.path"
          @click="emit('open', row.file)"
        >
          <Box :size="14" />
          <span>{{ row.name }}</span>
          <small>{{ extension(row.name) }}</small>
        </button>
      </template>
    </div>

    <section class="recent-panel">
      <div class="recent-heading">
        <button type="button" title="Toggle recent meshes" @click="recentOpen = !recentOpen">
          <ChevronDown v-if="recentOpen" :size="14" />
          <ChevronRight v-else :size="14" />
          <History :size="15" />
          <strong>Recent</strong>
        </button>
        <button v-if="recents.length" type="button" title="Clear recent meshes" @click="emit('clear-recent')">
          <Trash2 :size="14" />
        </button>
      </div>

      <div v-show="recentOpen" class="recent-list">
        <button
          v-for="item in recents"
          :key="item.id"
          class="recent-item"
          :class="{ active: isActive(item.activePath) }"
          type="button"
          :title="item.path || item.name"
          @click="emit('open-recent', item)"
        >
          <Box :size="14" />
          <span>
            <strong>{{ item.name }}</strong>
            <small>{{ item.source === "local" ? "Local file" : parentLabel(item.path) }}</small>
          </span>
        </button>
        <p v-if="!recents.length">No recent meshes</p>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.mesh-explorer {
  background: #1d272a;
  border-right: 1px solid #354246;
  color: #dce6e5;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.explorer-heading {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  min-height: 48px;
  padding: 8px 9px 7px 12px;
}

.explorer-heading > div {
  display: grid;
  gap: 2px;
}

.explorer-heading strong {
  font-size: 11px;
  letter-spacing: 0;
  text-transform: uppercase;
}

.explorer-heading span {
  color: #8fa09f;
  font-size: 10px;
}

.explorer-heading button,
.recent-heading button {
  align-items: center;
  background: transparent;
  border: 0;
  color: #bfcaca;
  display: inline-flex;
  justify-content: center;
  min-height: 28px;
  padding: 4px;
}

.explorer-heading button:hover,
.recent-heading button:hover {
  background: #2b373a;
  color: #ffffff;
}

.explorer-search {
  align-items: center;
  background: #151e20;
  border: 1px solid #3b484b;
  display: grid;
  flex: 0 0 auto;
  gap: 7px;
  grid-template-columns: 16px minmax(0, 1fr);
  margin: 0 9px 7px;
  padding: 0 8px;
}

.explorer-search:focus-within {
  border-color: #66aaa4;
}

.explorer-search input {
  background: transparent;
  border: 0;
  box-shadow: none;
  color: #edf3f2;
  font-size: 12px;
  min-height: 31px;
  padding: 4px 0;
}

.explorer-search input::placeholder {
  color: #758785;
}

.tree-scroll {
  flex: 1 1 auto;
  min-height: 80px;
  overflow: auto;
  padding: 2px 0 8px;
  scrollbar-color: #536164 #1d272a;
  scrollbar-width: thin;
}

.tree-row {
  align-items: center;
  background: transparent;
  border: 0;
  color: #c9d4d3;
  display: grid;
  font-size: 12px;
  min-height: 28px;
  padding-bottom: 3px;
  padding-right: 7px;
  padding-top: 3px;
  text-align: left;
  width: 100%;
}

.tree-row:hover {
  background: #283437;
  color: #ffffff;
}

.folder-row {
  gap: 3px;
  grid-template-columns: 14px 17px minmax(0, 1fr);
  padding-left: calc(7px + var(--tree-depth) * 13px);
}

.file-row {
  gap: 6px;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  padding-left: calc(24px + var(--tree-depth) * 13px);
}

.file-row.active {
  background: #315f60;
  box-shadow: inset 2px 0 0 #75c2b8;
  color: #ffffff;
}

.tree-row span,
.recent-item strong,
.recent-item small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-row small {
  color: #738785;
  font-size: 9px;
}

.file-row.active small {
  color: #c9e5e1;
}

.explorer-message {
  align-items: center;
  color: #91a3a1;
  display: flex;
  font-size: 12px;
  gap: 7px;
  justify-content: center;
  padding: 22px 12px;
  text-align: center;
}

.explorer-message.error {
  color: #efaaa3;
}

.recent-panel {
  background: #182124;
  border-top: 1px solid #3a474a;
  flex: 0 0 auto;
}

.recent-heading {
  align-items: center;
  display: flex;
  justify-content: space-between;
  min-height: 35px;
  padding-right: 6px;
}

.recent-heading > button:first-child {
  gap: 5px;
  justify-content: flex-start;
  padding-left: 8px;
}

.recent-heading strong {
  font-size: 10px;
  letter-spacing: 0;
  text-transform: uppercase;
}

.recent-list {
  max-height: 190px;
  overflow: auto;
  padding-bottom: 5px;
  scrollbar-color: #536164 #182124;
  scrollbar-width: thin;
}

.recent-item {
  align-items: center;
  background: transparent;
  border: 0;
  color: #cbd6d5;
  display: grid;
  gap: 7px;
  grid-template-columns: 16px minmax(0, 1fr);
  min-height: 39px;
  padding: 4px 8px 4px 18px;
  text-align: left;
  width: 100%;
}

.recent-item:hover,
.recent-item.active {
  background: #283638;
  color: #ffffff;
}

.recent-item > span {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.recent-item strong {
  font-size: 11px;
  font-weight: 500;
}

.recent-item small {
  color: #788b89;
  font-size: 9px;
}

.recent-list p {
  color: #718280;
  font-size: 11px;
  margin: 0;
  padding: 8px 12px 12px 31px;
}
</style>
