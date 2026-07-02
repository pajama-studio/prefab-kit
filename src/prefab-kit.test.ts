import { describe, it, expect } from "vitest";
import type { AttachComp, CoreComponents, KitEntity, KitPrefab, PrefabInstanceComp, Transform } from "./types.js";
import { composeTransform, resolveWorldTransform, worldToLocal } from "./transform.js";
import { expandEntities } from "./expand.js";
import { collectPrefabDeps, packPrefab, parsePrefabPackage, validatePrefab } from "./serialize.js";
import { MemoryPrefabStore, WebStoragePrefabStore } from "./store.js";

/**
 * A TOY host domain — a lamp game, nothing kitchen — proving the kit is
 * domain-agnostic: no imports from src/studio anywhere in this suite.
 */
interface ToyComponents extends CoreComponents<ToyComponents> {
  lamp?: { on: boolean; watts: number };
  linkTo?: { targetId: string }; // host-owned cross-entity reference
}
type ToyEntity = KitEntity<ToyComponents>;
type ToyPrefab = KitPrefab<ToyComponents, ToyEntity>;

const T = (x: number, y: number, z: number, scale = 1): Transform => ({ position: { x, y, z }, rotationY: 0, scale });
const at = (parentId: string, x: number, y: number, z: number): AttachComp => ({ parentId, offset: T(x, y, z) });
const E = (id: string, components: ToyComponents): ToyEntity => ({ id, name: id, components });

const LAMP: ToyPrefab = {
  id: "lamp", name: "Lamp", version: 1, rootId: "base",
  entities: [
    E("base", { transform: T(0, 0, 0) }),
    E("bulb", { transform: T(0, 1, 0), attach: at("base", 0, 1, 0), lamp: { on: false, watts: 40 }, linkTo: { targetId: "base" } }),
  ],
  params: [{ key: "lit", kind: "boolean", target: { localId: "bulb", component: "lamp", field: "on" }, default: false }],
  actions: [{ id: "flick", steps: [{ kind: "toggle", entityId: "bulb" }] }],
};

const DESK: ToyPrefab = {
  id: "desk", name: "Desk", version: 1, rootId: "top",
  entities: [
    E("top", { transform: T(0, 0.7, 0) }),
    // a nested lamp riding the desk
    E("desklamp", { transform: T(0.4, 0.75, 0), attach: at("top", 0.4, 0.05, 0), prefabInstance: { prefabId: "lamp", version: 1 } }),
  ],
};

const LIB = { lamp: LAMP, desk: DESK };

const inst = (id: string, prefabId: string, x: number, pi: Partial<PrefabInstanceComp<ToyComponents>> = {}): ToyEntity =>
  E(id, { transform: T(x, 0, 0), prefabInstance: { prefabId, version: 1, ...pi } });

describe("prefab-kit / transform algebra", () => {
  it("compose ∘ worldToLocal round-trips", () => {
    const parent: Transform = { position: { x: 2, y: 1, z: -3 }, rotationY: 0.7, rotation: { x: 0.2, y: 0.7, z: -0.1 }, scale: 2 };
    const child: Transform = { position: { x: -1, y: 4, z: 0.5 }, rotationY: 1.2, rotation: { x: 0, y: 1.2, z: 0.4 }, scale: 0.5 };
    const local = worldToLocal(parent, child);
    const back = composeTransform(parent, local);
    expect(back.position.x).toBeCloseTo(child.position.x, 5);
    expect(back.position.y).toBeCloseTo(child.position.y, 5);
    expect(back.scale).toBeCloseTo(child.scale, 5);
  });
});

describe("prefab-kit / expansion (toy domain)", () => {
  it("expands an instance; children ride the root", () => {
    const out = expandEntities([inst("i1", "lamp", 10)], LIB);
    expect(out.map((e) => e.id).sort()).toEqual(["i1", "i1::bulb"]);
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(resolveWorldTransform("i1::bulb", byId).position.x).toBeCloseTo(10, 5);
    expect(resolveWorldTransform("i1::bulb", byId).position.y).toBeCloseTo(1, 5);
  });

  it("params bind (default + instance value); overrides merge; removal works", () => {
    const out = expandEntities([
      inst("a", "lamp", 0),
      inst("b", "lamp", 5, { params: { lit: true } }),
      inst("c", "lamp", 9, { overrides: { bulb: { components: { lamp: { on: false, watts: 100 } } } } }),
      inst("d", "lamp", 12, { overrides: { bulb: { removed: true } } }),
    ], LIB);
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId["a::bulb"].components.lamp!.on).toBe(false);       // default
    expect(byId["b::bulb"].components.lamp!.on).toBe(true);        // param value
    expect(byId["c::bulb"].components.lamp!.watts).toBe(100);      // override
    expect(byId["d::bulb"]).toBeUndefined();                        // removed
  });

  it("host hook remaps host-owned cross-entity refs", () => {
    const out = expandEntities([inst("i1", "lamp", 0)], LIB, {
      remapComponentRefs: (c, mapId) => c.linkTo ? { ...c, linkTo: { targetId: mapId(c.linkTo.targetId) } } : c,
    });
    const bulb = out.find((e) => e.id === "i1::bulb")!;
    expect(bulb.components.linkTo!.targetId).toBe("i1"); // "base" → the instance root id
  });

  it("nested prefabs unfold recursively", () => {
    const out = expandEntities([inst("d1", "desk", 0)], LIB);
    expect(out.map((e) => e.id).sort()).toEqual(["d1", "d1::desklamp", "d1::desklamp::bulb"]);
  });
});

describe("prefab-kit / validate + package", () => {
  it("validatePrefab flags structural breakage", () => {
    expect(validatePrefab(LAMP)).toEqual([]);
    expect(validatePrefab({ ...LAMP, rootId: "nope" })).toContain("rootId does not name an entity");
    expect(validatePrefab({ ...LAMP, entities: [...LAMP.entities, E("base", {})] }).join()).toMatch(/duplicate/);
  });

  it("packPrefab collects nested dependencies; parse round-trips", () => {
    expect(collectPrefabDeps("desk", LIB)).toEqual(["lamp"]);
    const pkg = packPrefab("desk", LIB)!;
    expect(pkg.prefabs.map((p) => p.id)).toEqual(["desk", "lamp"]); // self-contained
    const parsed = parsePrefabPackage(JSON.stringify(pkg));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.prefabs.length).toBe(2);
  });

  it("parse rejects garbage, wrong format, and future versions", () => {
    expect(parsePrefabPackage("{nope").ok).toBe(false);
    expect(parsePrefabPackage({ format: "other" }).ok).toBe(false);
    expect(parsePrefabPackage({ format: "pajama-prefab-package", formatVersion: 99, prefabs: [LAMP] }).ok).toBe(false);
    expect(parsePrefabPackage({ format: "pajama-prefab-package", formatVersion: 1, prefabs: [{ id: "x" }] }).ok).toBe(false);
  });
});

describe("prefab-kit / stores", () => {
  it("MemoryPrefabStore round-trips and rejects invalid prefabs", async () => {
    const store = new MemoryPrefabStore();
    await store.save(LAMP as never);
    expect((await store.list()).map((p) => p.id)).toEqual(["lamp"]);
    expect((await store.load("lamp"))?.name).toBe("Lamp");
    await expect(store.save({ ...LAMP, rootId: "nope" } as never)).rejects.toThrow(/invalid/);
    await store.remove("lamp");
    expect(await store.list()).toEqual([]);
  });

  it("WebStoragePrefabStore works over a plain-object Storage", async () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const store = new WebStoragePrefabStore(storage);
    await store.save(LAMP as never);
    await store.save(DESK as never);
    expect((await store.list()).map((p) => p.id).sort()).toEqual(["desk", "lamp"]);
    await store.remove("lamp");
    expect((await store.list()).map((p) => p.id)).toEqual(["desk"]);
  });
});

describe("prefab-kit / authoring ops (toy domain)", () => {
  it("buildPrefabFromSelection: plain entity wins root; instance member stays linked", async () => {
    const { buildPrefabFromSelection } = await import("./ops");
    const table = E("table", { transform: T(0, 0, 0) });
    const lampInst = inst("li", "lamp", 1);
    const byId = { table, li: lampInst };
    const r = buildPrefabFromSelection([lampInst, table], byId, { prefabId: "combo", instanceId: "c1", name: "Combo" })!;
    expect(r.prefab.rootId).toBe("table");                                    // plain entity preferred
    expect(r.prefab.entities.find((e) => e.id === "li")!.components.prefabInstance?.prefabId).toBe("lamp"); // nested link kept
    expect(r.instance.components.prefabInstance!.prefabId).toBe("combo");
    expect(r.instance.components.transform!.position.x).toBe(0);
  });

  it("bakeInstanceIntoTemplate absorbs overrides + extra parts, bumps version", async () => {
    const { bakeInstanceIntoTemplate } = await import("./ops");
    const i = inst("i1", "lamp", 4, { overrides: { bulb: { components: { lamp: { on: true, watts: 60 } } } } });
    const extra = E("i1::shade", { transform: T(4.2, 1.4, 0), attach: at("i1", 0.2, 1.4, 0) });
    const next = bakeInstanceIntoTemplate(i, LAMP, [extra]);
    expect(next.version).toBe(2);
    expect(next.entities.find((e) => e.id === "bulb")!.components.lamp!.on).toBe(true);      // override baked
    const shade = next.entities.find((e) => e.id === "shade")!;
    expect(shade.components.attach!.parentId).toBe("base");                                   // remapped to local root
    const root = next.entities.find((e) => e.id === "base")!;
    expect(root.components.transform!.position.x).toBe(0);                                    // root reset to origin
    expect(root.components.prefabInstance).toBeUndefined();
  });

  it("clearOverrides / clearOverride", async () => {
    const { clearOverrides, clearOverride } = await import("./ops");
    const i = inst("i1", "lamp", 0, { overrides: { bulb: { removed: true }, base: { components: {} } } });
    expect(Object.keys(clearOverride(i, "bulb").components.prefabInstance!.overrides!)).toEqual(["base"]);
    expect(clearOverrides(i).components.prefabInstance!.overrides).toEqual({});
  });

  it("upsertPrefabs replaces same-id templates with a raised version", async () => {
    const { upsertPrefabs } = await import("./ops");
    const local = [{ ...LAMP, version: 5 }];
    const next = upsertPrefabs(local, [{ ...LAMP, name: "Lamp v2", version: 1 }, DESK]);
    expect(next.find((p) => p.id === "lamp")!.name).toBe("Lamp v2");
    expect(next.find((p) => p.id === "lamp")!.version).toBe(6); // raised past local
    expect(next.map((p) => p.id)).toEqual(["lamp", "desk"]);
  });

  it("createInstanceEntity places a linked instance at a position", async () => {
    const { createInstanceEntity } = await import("./ops");
    const e = createInstanceEntity(LAMP, "i9", { x: 7, y: 0, z: 1 });
    expect(e.id).toBe("i9");
    expect(e.components.prefabInstance!.prefabId).toBe("lamp");
    expect(e.components.transform!.position.x).toBe(7);
  });
});
