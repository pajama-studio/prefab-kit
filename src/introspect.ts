import type { ActionStep, CoreComponents, KitEntity, KitPrefab } from "./types.js";

/**
 * Interface introspection — a prefab can DESCRIBE ITSELF to an agent or a UI:
 * which params it exposes (kind, binding, default) and which actions are
 * callable (with a human/AI-readable step summary). Hosts wrap this with their
 * invocation syntax (e.g. Kitchen Lab's `studio.callAction(instanceId, id)`).
 */
export interface PrefabInterfaceDoc {
  id: string;
  name: string;
  parts: { localId: string; name: string; components: string[] }[];
  params: { key: string; label: string; kind: "boolean" | "number"; default?: boolean | number; binds: string }[];
  actions: { id: string; label: string; steps: string[] }[];
}

function describeStep(s: ActionStep): string {
  const t = "entityId" in s && s.entityId ? ` → ${s.entityId}` : "";
  const extra = Object.entries(s)
    .filter(([k]) => k !== "kind" && k !== "entityId")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  return `${s.kind}${t}${extra ? ` (${extra})` : ""}`;
}

export function describePrefabInterface<C extends CoreComponents<C>, E extends KitEntity<C>>(
  prefab: KitPrefab<C, E>,
): PrefabInterfaceDoc {
  return {
    id: prefab.id,
    name: prefab.name,
    parts: prefab.entities.map((e) => ({
      localId: e.id,
      name: e.name,
      components: Object.keys(e.components).filter((k) => k !== "transform" && k !== "attach"),
    })),
    params: (prefab.params ?? []).map((p) => ({
      key: p.key,
      label: p.label ?? p.key,
      kind: p.kind,
      default: p.default,
      binds: `${p.target.localId}.${p.target.component}.${p.target.field}`,
    })),
    actions: (prefab.actions ?? []).map((a) => ({
      id: a.id,
      label: a.label ?? a.id,
      steps: a.steps.map(describeStep),
    })),
  };
}
