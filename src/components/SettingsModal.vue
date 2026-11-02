<script setup lang="ts">
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { exportAllData, importAllData, isExportedData } from "../lib/dataExport";
import { defaultFrameId } from "../lib/frames";
import {
  activeFrame,
  LOG_REFRESH_INTERVALS_MS,
  MAX_PANE_COUNT,
  MIN_PANE_COUNT,
  RECONNECT_DURATIONS_S,
  settingsState,
} from "../lib/settings";
import { getWebPanel, removeWebPanel, webPanels, type WebPanelDef } from "../lib/webPanels";
import ColorPicker from "./ColorPicker.vue";
import Dropdown from "./Dropdown.vue";
import WebPanelModal from "./WebPanelModal.vue";

const open = defineModel<boolean>({ required: true });

const ADD_NEW_ID = "__add_new__";
const panelModalOpen = ref(false);
/** Non-null while WebPanelModal is open in edit mode, for whichever panel
 *  it's editing — null means the modal (if open) is in add mode instead. */
const editingPanel = ref<WebPanelDef | null>(null);

/** Not a real setting — just which entry is showing in the "Web panels"
 *  Dropdown, for picking one to edit/remove or triggering the add-new modal.
 *  "Web Interface" is pre-seeded into webPanels.ts by default, so it's
 *  ordinarily there to start on, but it's just as removable/editable as
 *  anything else — no special-casing of that id here. */
const webPanelSelection = ref(webPanels[0]?.id ?? "");

const webPanelOptions = computed(() => [
  ...webPanels.map((panel) => ({ id: panel.id, label: panel.name })),
  { id: ADD_NEW_ID, label: "+ Add new…" },
]);

// "Add new" is an action, not a real selection — opening the modal must
// leave the Dropdown's own displayed value alone, or its trigger would
// flash "+ Add new…" as its label right up until the modal closes.
const webPanelSelectionModel = computed({
  get: () => webPanelSelection.value,
  set: (id: string) => {
    if (id === ADD_NEW_ID) {
      editingPanel.value = null;
      panelModalOpen.value = true;
    } else {
      webPanelSelection.value = id;
    }
  },
});

const selectedPanel = computed(() => getWebPanel(webPanelSelection.value));

function editSelectedPanel() {
  if (!selectedPanel.value) return;
  editingPanel.value = selectedPanel.value;
  panelModalOpen.value = true;
}

function onPanelSaved(id: string) {
  webPanelSelection.value = id;
}

function removeSelectedPanel() {
  const panel = selectedPanel.value;
  if (!panel) return;
  removeWebPanel(panel.id);
  webPanelSelection.value = webPanels[0]?.id ?? "";
  // Any pane actively showing the now-deleted panel would otherwise keep
  // pointing at a dangling id — fall back the same way a missing persisted
  // default already does.
  activeFrame.panes.forEach((id, index) => {
    if (id === panel.id) activeFrame.panes[index] = defaultFrameId(index);
  });
}

const paneCountOptions = Array.from(
  { length: MAX_PANE_COUNT - MIN_PANE_COUNT + 1 },
  (_, i) => MIN_PANE_COUNT + i,
).map((n) => ({ id: String(n), label: String(n) }));

/** Grows/shrinks the panes array in place — appending a fresh default per
 *  new slot, or just truncating — leaving every existing entry's own
 *  choice alone either way. */
function resizePanes(panes: string[], target: number): void {
  while (panes.length < target) panes.push(defaultFrameId(panes.length));
  panes.length = target;
}

// Applies immediately — SplitPane re-renders live off activeFrame.panes.length,
// and activeFrame.panes is what's persisted (see settings.ts), so this needs
// no separate "default" copy to keep in lockstep.
const paneCountId = computed({
  get: () => String(activeFrame.panes.length),
  set: (id: string) => resizePanes(activeFrame.panes, Number(id)),
});

// Dropdown deals only in string ids — intervals are stored/compared as ms
// numbers everywhere else, so this pair of computeds is the one place that
// converts between the two.
const logRefreshOptions = LOG_REFRESH_INTERVALS_MS.map((ms) => ({
  id: String(ms),
  label: ms < 1000 ? `${ms}ms` : `${ms / 1000}s`,
}));

const logRefreshIntervalId = computed({
  get: () => String(settingsState.logRefreshIntervalMs),
  set: (id: string) => {
    settingsState.logRefreshIntervalMs = Number(id);
  },
});

function formatDuration(seconds: number): string {
  if (seconds === 0) return "Off";
  if (seconds < 60) return `${seconds}s`;
  return `${seconds / 60}m`;
}

const reconnectDurationOptions = RECONNECT_DURATIONS_S.map((seconds) => ({
  id: String(seconds),
  label: formatDuration(seconds),
}));

const reconnectDurationId = computed({
  get: () => String(settingsState.reconnectDurationS),
  set: (id: string) => {
    settingsState.reconnectDurationS = Number(id);
  },
});

function close() {
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

const backupStatus = ref<string | null>(null);
const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

const BACKUP_STATUS_DURATION_MS = 3000;
let backupStatusTimer: ReturnType<typeof setTimeout> | null = null;

function setBackupStatus(message: string) {
  backupStatus.value = message;
  if (backupStatusTimer !== null) clearTimeout(backupStatusTimer);
  backupStatusTimer = setTimeout(() => {
    backupStatus.value = null;
    backupStatusTimer = null;
  }, BACKUP_STATUS_DURATION_MS);
}

onUnmounted(() => {
  if (backupStatusTimer !== null) clearTimeout(backupStatusTimer);
});

async function exportData() {
  const path = await saveFileDialog({
    title: "Export SocketKeys settings",
    defaultPath: `socketkeys-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: JSON_FILTER,
  });
  if (!path) return; // user cancelled

  await writeTextFile(path, JSON.stringify(exportAllData(), null, 2));
  setBackupStatus("Exported.");
}

async function startImport() {
  const path = await openFileDialog({
    title: "Import SocketKeys settings",
    multiple: false,
    filters: JSON_FILTER,
  });
  if (!path) return; // user cancelled

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(path));
  } catch {
    setBackupStatus("That file isn't valid JSON.");
    return;
  }
  if (!isExportedData(parsed)) {
    setBackupStatus("That file doesn't look like a SocketKeys backup.");
    return;
  }

  // Every persisted module only reads localStorage once, at load — nothing
  // reactive would pick up the new values without a full reload.
  const confirmed = window.confirm(
    "Importing replaces your current settings, connections, and macro groups with the ones in this file, then reloads SocketKeys. Continue?",
  );
  if (!confirmed) return;

  importAllData(parsed);
  window.location.reload();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="backdrop" @mousedown.self="close">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="modal-header">
            <h2 id="settings-title">Settings</h2>
            <button class="icon-btn" type="button" aria-label="Close settings" @click="close">
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
              </svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="field">
              <label id="pane-count-label">Number of frames</label>
              <Dropdown
                v-model="paneCountId"
                :options="paneCountOptions"
                ariaLabel="Number of frames"
              />
            </div>

            <div class="field">
              <label id="web-panels-label">Web panels</label>
              <div class="web-panels-control">
                <!-- Remove/Edit go before the Dropdown, same reasoning as
                     ColorPicker's Reset button: the parent `.field` row is
                     `justify-content: space-between`, which right-anchors
                     this whole control, so variable-width elements placed
                     *after* the Dropdown would shift it sideways whenever
                     they appear/disappear. Leading with them means only
                     they absorb that movement. -->
                <button
                  v-if="selectedPanel"
                  type="button"
                  class="panel-action-btn"
                  @click="removeSelectedPanel"
                >
                  Remove
                </button>
                <button
                  v-if="selectedPanel"
                  type="button"
                  class="panel-action-btn"
                  @click="editSelectedPanel"
                >
                  Edit
                </button>
                <Dropdown
                  v-model="webPanelSelectionModel"
                  :options="webPanelOptions"
                  ariaLabel="Web panels"
                />
              </div>
            </div>

            <div class="field">
              <label id="log-refresh-interval-label">Log refresh interval</label>
              <Dropdown
                v-model="logRefreshIntervalId"
                :options="logRefreshOptions"
                ariaLabel="Log refresh interval"
              />
            </div>

            <div class="field">
              <label id="reconnect-duration-label">Auto-reconnect for</label>
              <Dropdown
                v-model="reconnectDurationId"
                :options="reconnectDurationOptions"
                ariaLabel="Auto-reconnect duration"
              />
            </div>

            <div class="field">
              <label id="primary-color-label">Primary color</label>
              <ColorPicker
                v-model="settingsState.primaryColor"
                cssVar="--primary"
                ariaLabel="Primary color"
              />
            </div>

            <div class="field">
              <label id="accent-color-label">Accent color</label>
              <ColorPicker
                v-model="settingsState.accentColor"
                cssVar="--accent"
                ariaLabel="Accent color"
              />
            </div>

            <div class="field">
              <label id="backup-label">Backup</label>
              <div class="backup-control">
                <button type="button" class="panel-action-btn" @click="exportData">
                  Export
                </button>
                <button type="button" class="panel-action-btn" @click="startImport">
                  Import
                </button>
              </div>
            </div>
            <p v-if="backupStatus" class="hint">{{ backupStatus }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <WebPanelModal v-model="panelModalOpen" :editing="editingPanel" @saved="onPanelSaved" />
</template>

<style scoped>
.web-panels-control,
.backup-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-action-btn {
  height: 20px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.panel-action-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}

.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 40%);
  z-index: 100;
}

.modal {
  width: min(420px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 30%);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.modal-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.modal-body {
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.field label {
  font-size: 13px;
  color: var(--text);
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.icon-btn svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
}

.icon-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
