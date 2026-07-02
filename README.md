# prefab-kit — standalone linked-prefab (Blueprint) framework

A zero-dependency, domain-agnostic prefab system: **linked templates → placed
instances → per-instance overrides → exposed params → callable actions →
recursive nesting**, all as plain serializable JSON. Born in
[pajama.studio](https://pajama.studio)'s Kitchen Lab editor; any engine or
renderer can adopt it by satisfying three structural component fields.

```bash
npm install @pajama-studio/prefab-kit
```

```ts
import { expandEntities, resolveWorldTransform, packPrefab, parsePrefabPackage } from "@pajama-studio/prefab-kit";
```

```
types.ts      Transform / AttachComp / PrefabInstanceComp / KitPrefab / params / actions
transform.ts  pure quaternion similarity algebra (compose, worldToLocal,
              resolveWorldTransform over attach chains, cycle guard) — no three.js
expand.ts     the document→runtime boundary: expandEntities (recursive, depth-
              capped, overrides + params applied, host ref-remap hook)
serialize.ts  versioned package format + validatePrefab + dependency collection
store.ts      PrefabStore interface + Memory / WebStorage reference backends
```

## Adopting the kit in a new project

1. **Shape your components.** Your component type must structurally satisfy
   `CoreComponents<C>` — i.e. carry optional `transform`, `attach`,
   `prefabInstance` fields with the kit's shapes. Everything else in `C` is
   yours; the kit never touches it.

   ```ts
   interface MyComponents extends CoreComponents<MyComponents> {
     door?: { open: boolean };
     wire?: { poweredBy: string }; // your own cross-entity reference
   }
   type MyEntity = KitEntity<MyComponents>;   // or extend with your own fields
   type MyPrefab = KitPrefab<MyComponents, MyEntity>;
   ```

2. **Expand at load.** Wherever your engine turns the saved document into
   runtime entities:

   ```ts
   const runtime = expandEntities(doc.entities, prefabsById, {
     // only needed if your components hold cross-entity ids:
     remapComponentRefs: (c, mapId) =>
       c.wire ? { ...c, wire: { poweredBy: mapId(c.wire.poweredBy) } } : c,
   });
   ```

   Derived sub-entities get ids `instanceId::localId` (`parseInstanceId` splits
   them back). Editing a template updates every instance because expansion
   reads it live.

3. **Resolve transforms** with `resolveWorldTransform(id, byId)` — it walks the
   attach chain (broken links and cycles degrade safely to the entity's own
   transform).

4. **Persist / exchange.** `packPrefab(id, library)` bundles a template plus
   every nested dependency into a `pajama-prefab-package` (versioned envelope);
   `parsePrefabPackage(json)` validates before you register anything. Plug
   storage via `PrefabStore` (D1/R2/filesystem — implement 4 methods; Memory
   and WebStorage backends included).

5. **Params & actions** are data: apply params happen inside expansion; action
   *execution* is host logic — walk `prefab.actions[].steps`, remap each step's
   `entityId` with `instanceEntityId(instanceId, localId, prefab.rootId)`, and
   feed them to your own interpreter (see Kitchen Lab's
   `engine/systems/actions.ts` for a reference).

## What stays in the host

- Document ops (save-selection-as-prefab, apply-instance-to-template,
  revert) — they belong to your editor's reducer; Kitchen Lab's
  `state/ops/prefabOps.ts` is the reference implementation.
- Trigger/logic types (the kit stores `triggers` opaquely) and action step
  unions — `ActionStep` only requires `{ kind, entityId? }`.

## Format stability

`PACKAGE_VERSION` gates the file format. Bump it when the shape changes and
keep `parsePrefabPackage` reading older versions; readers reject files from
the future loudly instead of mis-parsing them.
