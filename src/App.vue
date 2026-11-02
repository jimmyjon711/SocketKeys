<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import TitleBar from "./components/TitleBar.vue";
import WindowResizeHandles from "./components/WindowResizeHandles.vue";
import SplitPane from "./components/SplitPane.vue";
import SettingsModal from "./components/SettingsModal.vue";
import ObjectTree from "./components/tree/ObjectTree.vue";
import ConsolePanel from "./components/console/ConsolePanel.vue";
import LogsPanel from "./components/logs/LogsPanel.vue";
import MacrosPanel from "./components/macros/MacrosPanel.vue";
import WebPanel from "./components/web/WebPanel.vue";
import CustomEndpointsPanel from "./components/custom/CustomEndpointsPanel.vue";
import Toast from "./components/Toast.vue";
import { activeFrame } from "./lib/settings";
import { checkForUpdate } from "./lib/updateCheck";
import { isMobile } from "./lib/platform";

/** The one place that maps a frame id to its component — everything else
 *  (settings, the header dropdowns) only deals in ids/metadata, to avoid a
 *  circular import (those live *inside* these same components' headers). */
const FRAME_COMPONENTS: Record<string, unknown> = {
  "printer-objects": ObjectTree,
  "custom-endpoints": CustomEndpointsPanel,
  console: ConsolePanel,
  logs: LogsPanel,
  macros: MacrosPanel,
};

/** Anything not in FRAME_COMPONENTS — the built-in "web" frame, and every
 *  user-defined web panel (frames.ts admits both as valid ids) — is
 *  rendered by the one WebPanel component, told which by `frameId`. */
function resolveFrame(id: string, paneIndex: number) {
  const component = FRAME_COMPONENTS[id];
  return component
    ? { component, props: { paneIndex } }
    : { component: WebPanel, props: { paneIndex, frameId: id } };
}

const panes = computed(() =>
  activeFrame.panes.map((id, index) => resolveFrame(id, index)),
);

const settingsOpen = ref(false);

onMounted(() => void checkForUpdate());
</script>

<template>
  <div class="app">
    <WindowResizeHandles v-if="!isMobile" />
    <TitleBar v-model:settings-open="settingsOpen" />
    <SettingsModal v-model="settingsOpen" />
    <Toast />

    <SplitPane :count="activeFrame.panes.length">
      <template #default="{ index }">
        <component :is="panes[index].component" v-bind="panes[index].props" />
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
