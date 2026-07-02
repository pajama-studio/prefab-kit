/**
 * prefab-kit — a standalone, serializable linked-prefab (Blueprint) framework.
 *
 * Domain-agnostic: the kit knows THREE component fields (`transform`, `attach`,
 * `prefabInstance`) and treats everything else in `components` as opaque data
 * owned by the host project. A host (Kitchen Lab, /world, …) plugs in by
 * making its component type satisfy `CoreComponents<C>` structurally and, when
 * it has cross-entity references inside components (e.g. a knob controlling a
 * separate burner), providing a `remapComponentRefs` hook to expansion.
 *
 * Everything is plain JSON — see serialize.ts for the versioned package
 * format and store.ts for pluggable persistence.
 */

export interface Vec3 { x: number; y: number; z: number }

/** A similarity transform: translation + full Euler rotation + uniform scale.
 *  `rotationY` is the legacy Y-only field, kept in sync with `rotation.y`. */
export interface Transform {
  position: Vec3;
  rotationY: number;
  rotation?: Vec3;
  scale: number;
}

/** Actor/Component attachment: this entity rides `parentId` at `offset` in the
 *  parent's local frame (optionally snapped to a named socket). */
export interface AttachComp {
  parentId: string;
  socket?: string;
  offset: Transform;
}

/** Per-instance, per-sub-entity customisation of a prefab. */
export interface PrefabOverride<C> {
  components?: Partial<C>;
  removed?: boolean;
}

/** The marker component a placed instance carries. */
export interface PrefabInstanceComp<C> {
  prefabId: string;
  /** Prefab version this instance was last reconciled against. */
  version: number;
  overrides?: Record<string, PrefabOverride<C>>;
  /** Values for the prefab's exposed params (key → value). */
  params?: Record<string, boolean | number>;
}

/** What the kit requires of a host's component type (F-bounded: C references
 *  itself through overrides). Host component types satisfy this structurally. */
export interface CoreComponents<C> {
  transform?: Transform;
  attach?: AttachComp;
  prefabInstance?: PrefabInstanceComp<C>;
}

/** What the kit requires of a host's entity type. Extra host fields (asset
 *  refs, flags…) survive expansion via spread. */
export interface KitEntity<C> {
  id: string;
  name: string;
  components: C;
  hidden?: boolean;
  locked?: boolean;
}

/** One step of a callable prefab action — the kit only needs `kind` and the
 *  optional `entityId` (for per-instance remapping); hosts use richer unions. */
export interface ActionStep {
  kind: string;
  entityId?: string;
}

/** An exposed prefab parameter (Blueprint "public variable"): binds a value to
 *  one field of one sub-entity's component at expansion. */
export interface PrefabParam {
  key: string;
  label?: string;
  kind: "boolean" | "number";
  target: { localId: string; component: string; field: string };
  default?: boolean | number;
}

/** A named, callable behaviour (Blueprint "custom event"). */
export interface PrefabAction<S extends ActionStep = ActionStep> {
  id: string;
  label?: string;
  steps: S[];
}

/** A prefab template. `triggers` is host-domain data the kit stores opaquely. */
export interface KitPrefab<C, E extends KitEntity<C> = KitEntity<C>, S extends ActionStep = ActionStep> {
  id: string;
  name: string;
  /** Bumped on every save so instances can detect staleness. */
  version: number;
  rootId: string;
  entities: E[];
  triggers?: unknown[];
  params?: PrefabParam[];
  actions?: PrefabAction<S>[];
}
