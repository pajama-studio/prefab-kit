import type { CoreComponents, KitEntity, KitPrefab, Transform } from "./types.js";
import { IDENTITY, resolveWorldTransform } from "./transform.js";
import { expandPrefabInstance, instanceEntityId, SEP, type ExpandOptions } from "./expand.js";

/**
 * Authoring operations — the pure calculations behind an editor's prefab
 * workflow (save-selection-as-template, drop-an-instance, bake-instance-back,
 * revert). Hosts keep their own document plumbing (reducers, undo, autosave)
 * and delegate the math here; Kitchen Lab's `state/ops/prefabOps.ts` is the
 * reference wrapper.
 */

/** Pack a set of entities into a new prefab + the linked instance entity that
 *  replaces them in the document. Root = a member not attached to another
 *  member, preferring one that isn't itself a prefab instance (instances kept
 *  as non-roots stay nested + linked). */
export function buildPrefabFromSelection<C extends CoreComponents<C>, E extends KitEntity<C>>(
  members: E[],
  byId: Record<string, { components: C }>,
  opts: { prefabId: string; instanceId: string; name: string },
): { prefab: KitPrefab<C, E>; instance: E } | null {
  if (!members.length) return null;
  const sel = new Set(members.map((m) => m.id));
  const unattached = members.filter((m) => !m.components.attach || !sel.has(m.components.attach.parentId));
  const root = unattached.find((m) => !m.components.prefabInstance) ?? unattached[0] ?? members[0];
  const rootWorld = resolveWorldTransform(root.id, byId);
  const entities = members.map((m) => {
    const components: C = { ...m.components };
    if (m.id === root.id) {
      // Root is the prefab-local origin; it must be a plain entity.
      delete components.prefabInstance;
      delete components.attach;
    }
    return { ...m, components };
  });
  const prefab: KitPrefab<C, E> = { id: opts.prefabId, name: opts.name, version: 1, rootId: root.id, entities, triggers: [] };
  const instance: E = {
    ...root,
    id: opts.instanceId,
    name: opts.name,
    components: { transform: rootWorld, prefabInstance: { prefabId: opts.prefabId, version: 1, overrides: {} } } as C,
  };
  return { prefab, instance };
}

/** The single entity that places a prefab in a document. */
export function createInstanceEntity<C extends CoreComponents<C>, E extends KitEntity<C>>(
  prefab: KitPrefab<C, E>,
  instanceId: string,
  position: { x: number; y: number; z: number },
): E {
  const root = prefab.entities.find((e) => e.id === prefab.rootId) ?? prefab.entities[0];
  return {
    ...root,
    id: instanceId,
    name: prefab.name,
    components: {
      transform: { position, rotationY: 0, scale: 1 } as Transform,
      prefabInstance: { prefabId: prefab.id, version: prefab.version, overrides: {} },
    } as C,
  };
}

/** Bake an instance's current state (template + overrides + `extraParts` the
 *  editor attached under it) back into the template as the new baseline —
 *  every other instance picks it up on re-expansion. Returns the bumped
 *  prefab; the host clears this instance's overrides + removes the absorbed
 *  extra parts from the document. */
export function bakeInstanceIntoTemplate<C extends CoreComponents<C>, E extends KitEntity<C>>(
  instance: E,
  prefab: KitPrefab<C, E>,
  extraParts: E[],
  expandOpts: ExpandOptions<C> = {},
): KitPrefab<C, E> {
  const toLocal = (gid: string) =>
    gid === instance.id ? prefab.rootId : gid.startsWith(instance.id + SEP) ? gid.slice(instance.id.length + SEP.length) : gid;
  const bake = (e: E): E => {
    const localId = toLocal(e.id);
    const components: C = { ...e.components };
    if (localId === prefab.rootId) {
      // Only the root sheds its marker (it carries the OUTER instance's);
      // nested prefab instances among the children keep theirs.
      delete components.prefabInstance;
      delete components.attach;
      components.transform = IDENTITY;
    } else if (components.attach) {
      components.attach = { ...components.attach, parentId: toLocal(components.attach.parentId) };
    }
    return { ...e, id: localId, components };
  };
  const entities = [...expandPrefabInstance(instance, prefab, expandOpts).map(bake), ...extraParts.map(bake)];
  return { ...prefab, version: prefab.version + 1, entities };
}

/** Instance with ALL per-instance overrides dropped (back to the template). */
export function clearOverrides<C extends CoreComponents<C>, E extends KitEntity<C>>(instance: E): E {
  const pi = instance.components.prefabInstance;
  if (!pi) return instance;
  return { ...instance, components: { ...instance.components, prefabInstance: { ...pi, overrides: {} } } };
}

/** Instance with one sub-part's override dropped. */
export function clearOverride<C extends CoreComponents<C>, E extends KitEntity<C>>(instance: E, localId: string): E {
  const pi = instance.components.prefabInstance;
  if (!pi?.overrides) return instance;
  const { [localId]: _drop, ...rest } = pi.overrides;
  return { ...instance, components: { ...instance.components, prefabInstance: { ...pi, overrides: rest } } };
}

/** Upsert templates into a library array: same-id templates are REPLACED (the
 *  incoming version is raised above the existing one so stale instances
 *  reconcile); new ids append. Order preserved. */
export function upsertPrefabs<C extends CoreComponents<C>, E extends KitEntity<C>>(
  library: KitPrefab<C, E>[],
  incoming: KitPrefab<C, E>[],
): KitPrefab<C, E>[] {
  const out = [...library];
  for (const p of incoming) {
    const i = out.findIndex((x) => x.id === p.id);
    if (i < 0) out.push(p);
    else out[i] = { ...p, version: Math.max(p.version, out[i].version + 1) };
  }
  return out;
}

export { instanceEntityId };
