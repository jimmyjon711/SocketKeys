<script setup lang="ts">
/**
 * Built-in "Custom Endpoint" frame — lets the user type in arbitrary GET
 * endpoints (see customEndpoints.ts) and shows each as an expandable row,
 * fetched via fetchCustomEndpoint in objectStore.ts.
 */
import { computed, nextTick, ref } from "vue";
import {
  addCustomEndpoint,
  customEndpoints,
  removeCustomEndpoint,
} from "../../lib/moonraker/customEndpoints";
import { forgetCustomEndpoint } from "../../lib/moonraker/objectStore";
import TreeNode from "../tree/TreeNode.vue";
import FrameDropdown from "../FrameDropdown.vue";

defineProps<{ paneIndex: number }>();

const addingEndpoint = ref(false);
const newEndpointPath = ref("");
const newEndpointInput = ref<HTMLInputElement | null>(null);

async function startAddEndpoint() {
  addingEndpoint.value = true;
  newEndpointPath.value = "";
  await nextTick();
  newEndpointInput.value?.focus();
}

/** Enter and blur both commit — blur covers clicking away without hitting Enter. */
function submitNewEndpoint() {
  if (!addingEndpoint.value) return; // already committed via Enter, blur is a no-op
  const raw = newEndpointPath.value.trim();
  addingEndpoint.value = false;
  if (!raw) return;
  addCustomEndpoint(raw.startsWith("/") ? raw : `/${raw}`);
}

function cancelAddEndpoint() {
  addingEndpoint.value = false;
  newEndpointPath.value = "";
  newEndpointInput.value?.blur();
}

function removeEndpoint(id: string) {
  removeCustomEndpoint(id);
  forgetCustomEndpoint(id);
}

const hasEndpoints = computed(() => customEndpoints.length > 0);
</script>

<template>
  <div class="endpoints-panel">
    <div class="panel-header">
      <FrameDropdown :pane-index="paneIndex" />
    </div>

    <div class="scroll-area">
      <div class="add-endpoint-row">
        <input
          v-if="addingEndpoint"
          ref="newEndpointInput"
          v-model="newEndpointPath"
          type="text"
          class="add-endpoint-input"
          placeholder="/printer/afc/status"
          autocomplete="off"
          spellcheck="false"
          aria-label="Custom endpoint path"
          @keydown.enter.prevent="submitNewEndpoint"
          @keydown.escape.prevent="cancelAddEndpoint"
          @blur="submitNewEndpoint"
        />
        <button v-else type="button" class="add-endpoint-btn" @click="startAddEndpoint">
          + Custom endpoint…
        </button>
      </div>

      <p v-if="!hasEndpoints" class="notice">
        No custom endpoints yet — add one above.
      </p>
      <ul v-else class="tree" role="tree" aria-label="Custom endpoints">
        <TreeNode
          v-for="endpoint in customEndpoints"
          :key="endpoint.id"
          :label="endpoint.path"
          kind="custom-root"
          :endpoint-id="endpoint.id"
          :endpoint-path="endpoint.path"
          @remove="removeEndpoint(endpoint.id)"
        />
      </ul>
    </div>
  </div>
</template>

<style scoped>
.endpoints-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  flex: 0 0 auto;
  height: var(--panel-header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border);
}

.scroll-area {
  flex: 1 1 auto;
  overflow: auto;
}

.notice {
  margin: 0;
  padding: 16px;
  font-size: 13px;
  color: var(--text-muted);
}

.tree {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.add-endpoint-row {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.add-endpoint-btn {
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.add-endpoint-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.add-endpoint-input {
  width: 100%;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
}

.add-endpoint-input:focus-visible {
  border-color: var(--accent);
}
</style>
