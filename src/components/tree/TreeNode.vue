<script setup lang="ts">
/**
 * One row of the object tree, recursing into itself for children.
 *
 * Three modes share one component:
 *  - `object-root`: a top-level printer object. Expanding subscribes to it,
 *    collapsing unsubscribes — this is what drives live updates.
 *  - `custom-root`: a user-defined custom endpoint (see customEndpoints.ts).
 *    No subscribe/notify — expanding fetches once, refresh button re-fetches.
 *  - `value`: any JSON value inside an already-subscribed object. Expanding is
 *    purely local, since Moonraker can't subscribe below object granularity.
 */
import { computed, onUnmounted, ref, watch } from "vue";
import {
  collapseObject,
  expandObject,
  fetchCustomEndpoint,
  objectStoreState,
  trackCustomEndpointActive,
  untrackCustomEndpointActive,
} from "../../lib/moonraker/objectStore";
import { buildMacroVariable } from "../../lib/macroVariable";
import { copyToClipboard } from "../../lib/clipboard";
import { showToast } from "../../lib/toast";

const props = withDefaults(
  defineProps<{
    label: string;
    kind?: "object-root" | "custom-root" | "value";
    value?: unknown;
    depth?: number;
    /** Ancestor keys from the root object down to (not including) this node. */
    path?: string[];
    /** `custom-root` only — id into objectStoreState.customStatus/etc. */
    endpointId?: string;
    /** `custom-root` only — raw path as typed, e.g. "/printer/afc/status". */
    endpointPath?: string;
  }>(),
  { kind: "value", depth: 0, path: () => [] },
);

const emit = defineEmits<{ remove: [] }>();

/** This node's own full key chain, for building its macro-variable reference
 *  and for handing down to children as their `path`. */
const ownPath = computed(() => [...props.path, props.label]);
const macroVariable = computed(() => buildMacroVariable(ownPath.value));

async function copyMacroVariable() {
  const ok = await copyToClipboard(macroVariable.value);
  showToast(ok ? "Copied to clipboard" : "Couldn't copy to clipboard");
}

/** Guards against pathological nesting; real Klipper data is far shallower. */
const MAX_DEPTH = 20;
/** Keeps dense data (e.g. a large bed_mesh matrix) from flooding the DOM. */
const MAX_CHILDREN = 200;

const localExpanded = ref(false);
/** Has this custom-root ever finished a fetch (success or error)? */
const customFetched = ref(false);

const isRoot = computed(() => props.kind === "object-root");
const isCustomRoot = computed(() => props.kind === "custom-root");

const expanded = computed(() =>
  isRoot.value
    ? objectStoreState.subscribedNames.has(props.label)
    : localExpanded.value,
);

const loading = computed(() => {
  if (isRoot.value) return objectStoreState.pendingSubscribe.has(props.label);
  if (isCustomRoot.value) return objectStoreState.customLoading[props.endpointId ?? ""] ?? false;
  return false;
});

const customError = computed(() =>
  isCustomRoot.value ? objectStoreState.customError[props.endpointId ?? ""] ?? null : null,
);

/** Root reads live status; custom-root reads its own fetch result; value uses its prop. */
const resolvedValue = computed(() => {
  if (isRoot.value) return objectStoreState.status[props.label];
  if (isCustomRoot.value) return objectStoreState.customStatus[props.endpointId ?? ""];
  return props.value;
});

const valueKind = computed<"object" | "array" | "scalar">(() => {
  const value = resolvedValue.value;
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null) return "object";
  return "scalar";
});

/** Known from a one-time background count query, keyed by object name —
 *  `undefined` while that query hasn't reached this object yet. */
const rootChildCount = computed(() =>
  isRoot.value ? objectStoreState.childCounts[props.label] : undefined,
);

/** Pre-formatted here rather than in the template: a literal "}}" inside a
 *  mustache expression trips up Vue's interpolation-close scanner, since it
 *  just looks for the first "}}" rather than actually parsing the JS. */
const rootChildCountLabel = computed(() =>
  rootChildCount.value ? `{${rootChildCount.value}}` : "",
);

const expandable = computed(() => {
  if (isRoot.value) {
    // Count not in yet — stay optimistically expandable rather than flash
    // "no children" for something that may well turn out to have some.
    if (rootChildCount.value === undefined) return true;
    return rootChildCount.value > 0;
  }
  if (isCustomRoot.value) {
    // Shape is unknown until the first fetch resolves.
    if (!customFetched.value) return true;
    return valueKind.value !== "scalar";
  }
  return valueKind.value !== "scalar" && props.depth < MAX_DEPTH;
});

const children = computed<{ label: string; value: unknown }[]>(() => {
  if (!expanded.value) return [];
  const value = resolvedValue.value;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CHILDREN)
      .map((entry, index) => ({ label: String(index), value: entry }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .slice(0, MAX_CHILDREN)
      .map(([key, entry]) => ({ label: key, value: entry }));
  }
  return [];
});

const truncatedCount = computed(() => {
  if (!expanded.value) return 0;
  const value = resolvedValue.value;
  const total = Array.isArray(value)
    ? value.length
    : typeof value === "object" && value !== null
      ? Object.keys(value).length
      : 0;
  return Math.max(0, total - MAX_CHILDREN);
});

/** Short inline preview so collapsed branches still say something useful. */
const summary = computed(() => {
  const value = resolvedValue.value;
  if ((isRoot.value || isCustomRoot.value) && !expanded.value) return "";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).length}}`;
  }
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "number") {
    // Trim float noise like 24.299999999999997 without lying about integers.
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  return String(value);
});

const scalarClass = computed(() => {
  const value = resolvedValue.value;
  if (typeof value === "number") return "num";
  if (typeof value === "string") return "str";
  if (typeof value === "boolean") return "bool";
  if (value === null || value === undefined) return "nil";
  return "";
});

/** Re-fetches a custom endpoint without touching its expanded state. */
function refreshCustom() {
  if (!props.endpointId || !props.endpointPath) return;
  fetchCustomEndpoint(props.endpointId, props.endpointPath).then(() => {
    customFetched.value = true;
  });
}

function toggle() {
  if (!expandable.value) return;

  if (isRoot.value) {
    if (expanded.value) void collapseObject(props.label);
    else void expandObject(props.label);
    return;
  }
  localExpanded.value = !localExpanded.value;
}

// Expanding joins the shared poll (objectStore.ts) and fetches right away;
// collapsing or unmounting leaves it.
watch(expanded, (isExpanded) => {
  if (!isCustomRoot.value || !props.endpointId || !props.endpointPath) return;
  if (isExpanded) {
    refreshCustom();
    trackCustomEndpointActive(props.endpointId, props.endpointPath);
  } else {
    untrackCustomEndpointActive(props.endpointId);
  }
});

onUnmounted(() => {
  if (isCustomRoot.value && props.endpointId && expanded.value) {
    untrackCustomEndpointActive(props.endpointId);
  }
});
</script>

<template>
  <li class="node">
    <div
      class="row"
      :class="{ expandable, root: isRoot || isCustomRoot }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      role="treeitem"
      :aria-expanded="expandable ? expanded : undefined"
      :tabindex="expandable ? 0 : -1"
      :title="isCustomRoot ? endpointPath : macroVariable"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
      @contextmenu.prevent="!isCustomRoot && copyMacroVariable()"
    >
      <span class="arrow" :class="{ open: expanded, hidden: !expandable }">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 1.5 L7 5 L3.5 8.5" />
        </svg>
      </span>

      <span class="label">{{ label }}</span>

      <span v-if="isCustomRoot && customError" class="meta error">{{ customError }}</span>
      <span v-else-if="loading" class="meta">loading…</span>
      <span v-else-if="isRoot && !expanded && rootChildCountLabel" class="value">
        {{ rootChildCountLabel }}
      </span>
      <span v-else-if="summary" class="value" :class="scalarClass">
        {{ summary }}
      </span>

      <button
        v-if="isCustomRoot"
        type="button"
        class="row-btn"
        title="Refresh"
        aria-label="Refresh"
        @click.stop="refreshCustom"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M8.5 5a3.5 3.5 0 1 1-1-2.45M8.5 1.5v2.5H6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        v-if="isCustomRoot"
        type="button"
        class="row-btn"
        title="Remove"
        aria-label="Remove"
        @click.stop="emit('remove')"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>

    <ul v-if="expanded && children.length" class="children" role="group">
      <TreeNode
        v-for="child in children"
        :key="child.label"
        :label="child.label"
        kind="value"
        :value="child.value"
        :depth="depth + 1"
        :path="ownPath"
      />
      <li v-if="truncatedCount" class="more" :style="{ paddingLeft: `${(depth + 1) * 12 + 20}px` }">
        +{{ truncatedCount }} more
      </li>
    </ul>
  </li>
</template>

<style scoped>
.node {
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding-right: 8px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  border-radius: 3px;
}

.row.expandable {
  cursor: pointer;
}

.row.expandable:hover {
  background: var(--surface-2);
}

.row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.arrow {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  transition: transform 0.12s ease;
}

.arrow.open {
  transform: rotate(90deg);
}

.arrow.hidden {
  visibility: hidden;
}

.arrow svg {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.label {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
}

.row.root .label {
  font-weight: 600;
}

.value {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.value.num {
  color: var(--accent);
}

.value.bool,
.value.nil {
  font-style: italic;
}

.meta {
  color: var(--text-muted);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta.error {
  color: var(--error);
  font-style: normal;
}

.row-btn {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  display: none;
  place-items: center;
  border: 0;
  padding: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.row:hover .row-btn {
  display: grid;
}

.row-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}

.row-btn svg {
  width: 8px;
  height: 8px;
}

.children {
  margin: 0;
  padding: 0;
}

.more {
  list-style: none;
  min-height: 22px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-style: italic;
  color: var(--text-muted);
}
</style>
