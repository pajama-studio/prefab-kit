---
name: prefab-kit
description: Author and edit @pajama-studio/prefab-kit documents — linked prefab templates, placed instances, per-instance overrides, exposed params, callable actions, and portable packages. Use when reading/writing prefab JSON, generating scene patches, or integrating the kit into an engine.
---

# prefab-kit — authoring guide for agents

prefab-kit documents are plain JSON. Master these five shapes and you can
author or patch any scene that uses the kit.

## 1. Prefab (the template)

```jsonc
{
  "id": "lamp", "name": "Lamp", "version": 1,
  "rootId": "base",                       // must name an entity below
  "entities": [
    { "id": "base", "name": "Base", "components": { "transform": T } },
    { "id": "bulb", "name": "Bulb", "components": {
      "transform": T,                     // authoring-time world pose
      "attach": { "parentId": "base", "offset": T },  // rides the parent
      "lamp": { "on": false }             // host-domain component (opaque to the kit)
    } }
  ],
  "params":  [ { "key": "lit", "kind": "boolean",
                 "target": { "localId": "bulb", "component": "lamp", "field": "on" },
                 "default": false } ],
  "actions": [ { "id": "flick", "label": "Flick",
                 "steps": [ { "kind": "toggle", "entityId": "bulb" } ] } ]
}
```

`T` is a Transform: `{ "position": {"x":0,"y":0,"z":0}, "rotationY": 0,
"rotation": {"x":0,"y":0,"z":0}, "scale": 1 }` — full Euler radians;
`rotationY` mirrors `rotation.y` (legacy readers).

Rules the validator enforces (`validatePrefab`): unique entity ids; `rootId`
exists; every `attach.parentId` exists; param targets and action-step
`entityId`s name real entities. Non-root entities should carry `attach`
(default parent = the root).

## 2. Placed instance (in a host document)

ONE entity with a marker — never inline the template's children:

```jsonc
{ "id": "i1", "name": "Lamp", "components": {
  "transform": T_world,
  "prefabInstance": {
    "prefabId": "lamp", "version": 1,
    "params": { "lit": true },                        // exposed-param values
    "overrides": { "bulb": { "components": { "lamp": { "on": false, "watts": 100 } } },
                    "shade": { "removed": true } }     // per-part customisation
  } } }
```

Expansion (`expandEntities`) derives sub-entities with ids
`instanceId::localId` (`i1::bulb`); the root keeps the instance id. Nesting is
allowed (a template's entity may itself carry `prefabInstance`) and expands
recursively — ids stack: `i1::sub::part`. Depth caps at 6.

## 3. Editing rules (patches)

- To customise ONE copy → write into that instance's `overrides[localId]`.
- To change EVERY copy → edit the template's entities and bump `version`.
- To move/re-parent within a template → set `attach.parentId` + `offset`
  (offset is LOCAL to the parent; use `worldToLocal(parentWorld, childWorld)`).
- Never invent `instanceId::localId` entities in a document — they exist only
  after expansion.

## 4. Portable packages

`packPrefab(id, library)` → `{ "format": "pajama-prefab-package",
"formatVersion": 1, "prefabs": [root, ...nestedDeps] }`. Always move prefabs
between projects as packages (deps travel along); parse with
`parsePrefabPackage` before registering anything.

## 5. Runtime API cheat-sheet

```ts
import { expandEntities, resolveWorldTransform, composeTransform, worldToLocal,
         instanceEntityId, parseInstanceId, packPrefab, parsePrefabPackage,
         validatePrefab, MemoryPrefabStore } from "@pajama-studio/prefab-kit";
```

- `expandEntities(entities, prefabsById, { remapComponentRefs })` — the
  document→runtime boundary; the hook remaps host-owned cross-entity ids.
- `resolveWorldTransform(id, byId)` — walks attach chains; cycles/missing
  parents degrade safely to the entity's own transform.
- Params/actions are DATA; executing an action = remap each step's `entityId`
  with `instanceEntityId(instanceId, localId, rootId)` and run it through the
  host's own interpreter.
