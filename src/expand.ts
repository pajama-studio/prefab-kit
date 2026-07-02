import type { CoreComponents, KitEntity, KitPrefab, Transform } from "./types";
import { IDENTITY, worldToLocal } from "./transform";

/**
 * Linked prefab (Blueprint) expansion — the heart of the kit.
 *
 * A document stores a placed instance as ONE entity carrying
 * `components.prefabInstance` and a world `transform`. At load the host EXPANDS
 * it: the root becomes the instance entity itself; every other prefab entity
 * becomes a derived entity (instance-scoped id `instanceId::localId`) attached
 * so it rides the root. Per-instance `overrides` merge per sub-entity, exposed
 * `params` write their bound component fields, and expansion is RECURSIVE — a
 * template may contain instances of other prefabs (depth-capped so a
 * self-containing template can never loop). Because expansion reads the
 * template live, editing a prefab updates every instance for free.
 */

/** Separator between an instance id and a prefab-local id in derived ids. */
export const SEP = "::";

/** Game-visible id for a prefab sub-entity within an instance. The root maps to
 *  the instance id itself; other locals get `${instanceId}::${localId}`. */
export function instanceEntityId(instanceId: string, localId: string, rootId: string): string {
  return localId === rootId ? instanceId : `${instanceId}${SEP}${localId}`;
}

/** Parse a derived entity id back into { instanceId, localId }; null for a
 *  plain (non-instance) id. */
export function parseInstanceId(id: string): { instanceId: string; localId: string } | null {
  const i = id.indexOf(SEP);
  if (i < 0) return null;
  return { instanceId: id.slice(0, i), localId: id.slice(i + SEP.length) };
}

/** Nested prefab-in-prefab expansion is depth-capped so a self-containing
 *  template can never loop — it just stops unfolding at this depth. */
export const MAX_NESTING = 6;

export interface ExpandOptions<C> {
  /** Host hook: remap cross-entity references the host keeps INSIDE its own
   *  components (the kit can't know about them). Called per expanded entity
   *  with a `mapId` that scopes a prefab-local id to this instance. Return the
   *  (possibly copied) components. */
  remapComponentRefs?: (components: C, mapId: (localId: string) => string) => C;
}

/**
 * Expand one instance entity into its full set of game-visible entities
 * (including a derived root carrying the instance's world transform + marker).
 * Returns [] if the entity isn't an instance or the prefab is missing.
 */
export function expandPrefabInstance<C extends CoreComponents<C>, E extends KitEntity<C>>(
  instance: E,
  prefab: KitPrefab<C, E> | undefined,
  opts: ExpandOptions<C> = {},
): E[] {
  const inst = instance.components.prefabInstance;
  if (!inst || !prefab) return [];
  const overrides = inst.overrides ?? {};
  const out: E[] = [];

  for (const pe of prefab.entities) {
    const ov = overrides[pe.id];
    if (ov?.removed) continue;
    const gid = instanceEntityId(instance.id, pe.id, prefab.rootId);
    let components: C = { ...pe.components, ...(ov?.components ?? {}) };

    // Exposed params write into their bound component field (instance value,
    // else the param's default).
    for (const param of prefab.params ?? []) {
      if (param.target.localId !== pe.id) continue;
      const v = inst.params?.[param.key] ?? param.default;
      if (v === undefined) continue;
      const comp = (components as Record<string, unknown>)[param.target.component];
      if (comp && typeof comp === "object") {
        components = { ...components, [param.target.component]: { ...(comp as object), [param.target.field]: v } };
      }
    }

    // Host-owned cross-entity references (e.g. a knob's `controls` target).
    if (opts.remapComponentRefs) {
      components = opts.remapComponentRefs(components, (localId) => instanceEntityId(instance.id, localId, prefab.rootId));
    }

    if (pe.id === prefab.rootId) {
      // Root → the instance entity: world placement + marker + any outer
      // attachment come from the instance (the template root's own transform
      // is the prefab-local origin, discarded).
      components.transform = instance.components.transform ?? IDENTITY;
      components.prefabInstance = inst;
      if (instance.components.attach) components.attach = instance.components.attach;
      else delete components.attach;
    } else {
      // Child → attached under the instance root so it rides the instance.
      const pid = pe.components.attach?.parentId;
      const parentGid = pid ? instanceEntityId(instance.id, pid, prefab.rootId) : instance.id;
      let offset: Transform = pe.components.attach?.offset ?? pe.components.transform ?? IDENTITY;
      // A per-instance transform override is stored as a WORLD transform; for
      // a part attached directly to the root, convert it to a local offset.
      const attachesToRoot = !pid || pid === prefab.rootId;
      if (ov?.components?.transform && attachesToRoot && instance.components.transform) {
        offset = worldToLocal(instance.components.transform, ov.components.transform);
      }
      components.attach = { parentId: parentGid, offset, ...(pe.components.attach?.socket ? { socket: pe.components.attach.socket } : {}) };
      const nested = pe.components.prefabInstance;
      if (nested) {
        // NESTED instance inside the template: keep its marker so
        // expandEntities recurses. Outer overrides addressed into the nested
        // tree ("<childId>::<deepLocal>") flow down re-keyed.
        const prefix = `${pe.id}${SEP}`;
        const flowed = { ...(nested.overrides ?? {}) };
        for (const [k, v] of Object.entries(overrides)) {
          if (k.startsWith(prefix)) flowed[k.slice(prefix.length)] = v;
        }
        components.prefabInstance = { ...nested, overrides: flowed };
      } else {
        delete components.prefabInstance;
      }
    }

    out.push({ ...pe, id: gid, components });
  }
  return out;
}

/**
 * Expand every prefab instance in an entity list into its sub-tree, leaving
 * plain entities untouched. RECURSIVE up to MAX_NESTING levels (ids nest:
 * `i1::sub::part`). A missing prefab keeps the instance entity as-is (a
 * placeholder rather than vanishing). This is the document→runtime boundary.
 */
export function expandEntities<C extends CoreComponents<C>, E extends KitEntity<C>>(
  entities: E[],
  prefabsById: Record<string, KitPrefab<C, E>>,
  opts: ExpandOptions<C> = {},
): E[] {
  let out = entities;
  // Roots already produced by an expansion carry the instance marker but must
  // not be re-expanded (their id IS the instance id).
  const expandedRoots = new Set<string>();
  for (let depth = 0; depth < MAX_NESTING; depth++) {
    let changed = false;
    const next: E[] = [];
    for (const e of out) {
      const pi = e.components.prefabInstance;
      if (!pi || expandedRoots.has(e.id)) { next.push(e); continue; }
      const expanded = expandPrefabInstance(e, prefabsById[pi.prefabId], opts);
      if (!expanded.length) { next.push(e); continue; } // missing prefab → placeholder
      expandedRoots.add(e.id);
      next.push(...expanded);
      changed = true;
    }
    out = next;
    if (!changed) break;
  }
  return out;
}
