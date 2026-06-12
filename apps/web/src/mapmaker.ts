// Saved-map storage for the Map Maker. A saved map is just its seed plus a
// snapshot of its validator verdict — the map itself is reconstructed
// deterministically from the seed via generateDaily, so we never persist
// geometry. Capped at 50 (v1's limit), newest first.

const KEY = "gg2:maps";
export const MAX_SAVED = 50;

export interface SavedMap {
  id: string;
  seed: string;
  archetype: string;
  funScore: number;
  pass: boolean;
  savedAt: string;
}

export function loadSavedMaps(): SavedMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedMap[]) : [];
  } catch {
    return [];
  }
}

/** Save a map. Returns the updated list, or null if storage failed. */
export function saveMap(entry: Omit<SavedMap, "id" | "savedAt">): SavedMap[] | null {
  const list = loadSavedMaps();
  if (list.some((m) => m.seed === entry.seed)) return list; // already saved
  const next: SavedMap[] = [
    { ...entry, id: `${Date.now()}-${entry.seed}`, savedAt: new Date().toISOString() },
    ...list,
  ].slice(0, MAX_SAVED);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return null; // quota / private mode
  }
}

export function deleteMap(id: string): SavedMap[] {
  const next = loadSavedMaps().filter((m) => m.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function randomSeed(): string {
  return `map-${Math.random().toString(36).slice(2, 9)}`;
}
