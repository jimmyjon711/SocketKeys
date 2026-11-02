/**
 * Frame metadata only — deliberately no component imports here. This module
 * is a dependency of settings.ts / FrameDropdown.vue, which are in turn used
 * *inside* the frame components themselves (each panel's header dropdown) —
 * importing the actual components here would create a circular import.
 * The id -> component mapping lives in App.vue instead, the one place that's
 * not itself inside the cycle.
 *
 * webPanels.ts is safe to import here despite that: it's a data-only leaf
 * module (like this one), not a component, so it can't be part of that cycle.
 */
import { computed } from "vue";
import { webPanels } from "./webPanels";

export interface FrameMeta {
  id: string;
  name: string;
}

const BUILTIN_FRAMES: FrameMeta[] = [
  { id: "printer-objects", name: "Printer Objects" },
  { id: "custom-endpoints", name: "Custom Endpoint" },
  { id: "console", name: "Console" },
  { id: "logs", name: "Logs" },
  { id: "macros", name: "Macros" },
];

/** Every frame a header's dropdown (or Settings' default-frame picker) can
 *  switch to — the built-ins above plus one entry per web panel (see
 *  webPanels.ts, which includes the default "Web Interface" one — it's not
 *  a separate built-in here, just a pre-seeded, removable entry there).
 *  Add a new *built-in* frame to BUILTIN_FRAMES and wire its component into
 *  App.vue's FRAME_COMPONENTS map; a web panel needs none of that — every
 *  one is rendered by the single WebPanel component (see App.vue). */
export const FRAMES = computed<FrameMeta[]>(() => [
  ...BUILTIN_FRAMES,
  ...webPanels.map((panel) => ({ id: panel.id, name: panel.name })),
]);

export function getFrame(id: string): FrameMeta | undefined {
  return FRAMES.value.find((frame) => frame.id === id);
}

/** Falls back to the first/second built-in frame if a persisted id no
 *  longer exists (e.g. a frame was removed in an update, or its custom web
 *  panel was since deleted). */
export function defaultFrameId(index: number): string {
  return BUILTIN_FRAMES[index]?.id ?? BUILTIN_FRAMES[0].id;
}
