import type { CoreComponents, KitEntity, KitPrefab } from "./types.js";

/**
 * Serialization: prefabs are plain JSON already — this module adds the
 * VERSIONED PACKAGE envelope (so files survive format evolution), structural
 * validation (so a bad file fails loudly, not weirdly at runtime), and
 * dependency collection (a template that nests other prefabs exports as one
 * self-contained package).
 */

export const PACKAGE_FORMAT = "pajama-prefab-package";
export const PACKAGE_VERSION = 1;

// The package holds prefabs of ANY host domain — opaque component payloads.
type AnyPrefab = KitPrefab<CoreComponents<never>>;

export interface PrefabPackage {
  format: typeof PACKAGE_FORMAT;
  formatVersion: number;
  /** The prefab the package is "about" (first entry), then its dependencies. */
  prefabs: AnyPrefab[];
}

/** Structural errors that make a prefab unusable. Empty array = valid. */
export function validatePrefab(p: unknown): string[] {
  const errs: string[] = [];
  const pre = p as Partial<KitPrefab<CoreComponents<never>>> | null;
  if (!pre || typeof pre !== "object") return ["not an object"];
  if (typeof pre.id !== "string" || !pre.id) errs.push("missing id");
  if (typeof pre.name !== "string") errs.push("missing name");
  if (typeof pre.version !== "number") errs.push("missing version");
  if (!Array.isArray(pre.entities) || pre.entities.length === 0) { errs.push("no entities"); return errs; }
  const ids = new Set<string>();
  for (const e of pre.entities) {
    if (!e || typeof e.id !== "string" || !e.components || typeof e.components !== "object") { errs.push("malformed entity"); continue; }
    if (ids.has(e.id)) errs.push(`duplicate entity id "${e.id}"`);
    ids.add(e.id);
  }
  if (typeof pre.rootId !== "string" || !ids.has(pre.rootId)) errs.push("rootId does not name an entity");
  for (const e of pre.entities) {
    const parent = e?.components?.attach?.parentId;
    if (parent && !ids.has(parent)) errs.push(`"${e.id}" attaches to unknown "${parent}"`);
  }
  for (const prm of pre.params ?? []) {
    if (!ids.has(prm.target?.localId)) errs.push(`param "${prm.key}" targets unknown "${prm.target?.localId}"`);
  }
  for (const act of pre.actions ?? []) {
    for (const st of act.steps ?? []) {
      if (st.entityId && !ids.has(st.entityId)) errs.push(`action "${act.id}" step targets unknown "${st.entityId}"`);
    }
  }
  return errs;
}

/** Prefab ids a template depends on (nested instances), recursively. */
export function collectPrefabDeps<C extends CoreComponents<C>, E extends KitEntity<C>>(
  prefabId: string,
  prefabsById: Record<string, KitPrefab<C, E>>,
): string[] {
  const seen = new Set<string>();
  const queue = [prefabId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = prefabsById[id];
    for (const e of p?.entities ?? []) {
      const dep = e.components.prefabInstance?.prefabId;
      if (dep && !seen.has(dep)) queue.push(dep);
    }
  }
  seen.delete(prefabId);
  return [...seen];
}

/** Pack a prefab (+ every nested dependency) into a self-contained package. */
export function packPrefab<C extends CoreComponents<C>, E extends KitEntity<C>>(
  prefabId: string,
  prefabsById: Record<string, KitPrefab<C, E>>,
): PrefabPackage | null {
  const root = prefabsById[prefabId];
  if (!root) return null;
  const deps = collectPrefabDeps(prefabId, prefabsById)
    .map((id) => prefabsById[id])
    .filter((p): p is KitPrefab<C, E> => !!p);
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_VERSION,
    prefabs: [root, ...deps] as unknown as AnyPrefab[],
  };
}

/** Parse + validate a package (accepts a JSON string or a parsed object). */
export function parsePrefabPackage(input: unknown): { ok: true; prefabs: AnyPrefab[] } | { ok: false; error: string } {
  let data: unknown = input;
  if (typeof input === "string") {
    try { data = JSON.parse(input); } catch { return { ok: false, error: "not valid JSON" }; }
  }
  const pkg = data as Partial<PrefabPackage> | null;
  if (!pkg || pkg.format !== PACKAGE_FORMAT) return { ok: false, error: `not a ${PACKAGE_FORMAT} file` };
  if (typeof pkg.formatVersion !== "number" || pkg.formatVersion > PACKAGE_VERSION) {
    return { ok: false, error: `unsupported format version ${pkg.formatVersion} (this app reads ≤ ${PACKAGE_VERSION})` };
  }
  if (!Array.isArray(pkg.prefabs) || pkg.prefabs.length === 0) return { ok: false, error: "package has no prefabs" };
  for (const p of pkg.prefabs) {
    const errs = validatePrefab(p);
    if (errs.length) return { ok: false, error: `prefab "${(p as AnyPrefab)?.id ?? "?"}": ${errs.join("; ")}` };
  }
  return { ok: true, prefabs: pkg.prefabs as AnyPrefab[] };
}
