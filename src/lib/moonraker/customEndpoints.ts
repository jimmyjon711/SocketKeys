/**
 * User-defined custom API endpoints — e.g. a plugin's `/printer/afc/status`
 * that isn't part of Klipper's own object set. Shown in the built-in
 * "Custom Endpoint" frame (see frames.ts, CustomEndpointsPanel.vue) and
 * fetched on demand (see fetchCustomEndpoint in objectStore.ts).
 *
 * Persisted the same way webPanels.ts persists its entries.
 */
import { reactive, watch } from "vue";

export interface CustomEndpointDef {
  id: string;
  /** As typed, e.g. "/printer/afc/status" — kept verbatim, not normalized. */
  path: string;
}

const STORAGE_KEY = "socketkeys.customEndpoints.v1";

function isCustomEndpointDef(value: unknown): value is CustomEndpointDef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.path === "string" && v.path.length > 0;
}

function loadPersisted(): CustomEndpointDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
    return Array.isArray(parsed) ? parsed.filter(isCustomEndpointDef) : [];
  } catch {
    return []; // malformed storage — start clean rather than crash
  }
}

export const customEndpoints = reactive<CustomEndpointDef[]>(loadPersisted());

watch(
  () => [...customEndpoints],
  (list) => localStorage.setItem(STORAGE_KEY, JSON.stringify(list)),
);

/** Adds an endpoint and returns its id, so the caller can expand it right away. */
export function addCustomEndpoint(path: string): string {
  const id = `endpoint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  customEndpoints.push({ id, path: path.trim() });
  return id;
}

export function removeCustomEndpoint(id: string): void {
  const index = customEndpoints.findIndex((endpoint) => endpoint.id === id);
  if (index !== -1) customEndpoints.splice(index, 1);
}
