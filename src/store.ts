import type { CoreComponents, KitPrefab } from "./types";
import { validatePrefab } from "./serialize";

/**
 * Pluggable prefab persistence. The kit ships two reference backends
 * (in-memory, Web Storage); hosts add their own (D1, R2, filesystem…) by
 * implementing the four methods. Everything moves as plain JSON.
 */

type AnyPrefab = KitPrefab<CoreComponents<never>>;

export interface PrefabStore {
  list(): Promise<{ id: string; name: string; version: number }[]>;
  load(id: string): Promise<AnyPrefab | null>;
  /** Rejects structurally invalid prefabs (see validatePrefab). */
  save(prefab: AnyPrefab): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPrefabStore implements PrefabStore {
  private map = new Map<string, AnyPrefab>();
  async list() { return [...this.map.values()].map((p) => ({ id: p.id, name: p.name, version: p.version })); }
  async load(id: string) { return this.map.get(id) ?? null; }
  async save(prefab: AnyPrefab) {
    const errs = validatePrefab(prefab);
    if (errs.length) throw new Error(`invalid prefab: ${errs.join("; ")}`);
    this.map.set(prefab.id, structuredClone(prefab));
  }
  async remove(id: string) { this.map.delete(id); }
}

/** localStorage/sessionStorage-backed store (one key per prefab + an index). */
export class WebStoragePrefabStore implements PrefabStore {
  constructor(private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, private prefix = "prefab-kit:") {}
  private indexKey() { return `${this.prefix}index`; }
  private readIndex(): string[] {
    try { return JSON.parse(this.storage.getItem(this.indexKey()) ?? "[]") as string[]; } catch { return []; }
  }
  private writeIndex(ids: string[]) { this.storage.setItem(this.indexKey(), JSON.stringify(ids)); }
  async list() {
    const out: { id: string; name: string; version: number }[] = [];
    for (const id of this.readIndex()) {
      const p = await this.load(id);
      if (p) out.push({ id: p.id, name: p.name, version: p.version });
    }
    return out;
  }
  async load(id: string) {
    const raw = this.storage.getItem(this.prefix + id);
    if (!raw) return null;
    try { return JSON.parse(raw) as AnyPrefab; } catch { return null; }
  }
  async save(prefab: AnyPrefab) {
    const errs = validatePrefab(prefab);
    if (errs.length) throw new Error(`invalid prefab: ${errs.join("; ")}`);
    this.storage.setItem(this.prefix + prefab.id, JSON.stringify(prefab));
    const idx = this.readIndex();
    if (!idx.includes(prefab.id)) this.writeIndex([...idx, prefab.id]);
  }
  async remove(id: string) {
    this.storage.removeItem(this.prefix + id);
    this.writeIndex(this.readIndex().filter((x) => x !== id));
  }
}
