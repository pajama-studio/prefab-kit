import type { Transform } from "./types";

/** The minimal component shape the transform algebra reads. */
export type AttachableComponents = { transform?: Transform; attach?: { parentId: string; socket?: string; offset: Transform } };

// ─── pure quaternion helpers (zero deps — no three.js) ───────────────────────
type Q = { x: number; y: number; z: number; w: number };
type V = { x: number; y: number; z: number };

/** Euler (XYZ order, radians) → unit quaternion (matches three.js setFromEuler). */
function quatFromEulerXYZ(x: number, y: number, z: number): Q {
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** Unit quaternion → Euler (XYZ order, radians) — mirrors three.js. */
function eulerXYZFromQuat(q: Q): V {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m22 = 1 - (xx + zz), m23 = yz - wx;
  const m32 = yz + wx, m33 = 1 - (xx + yy);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex: number, ez: number;
  if (Math.abs(m13) < 0.9999999) { ex = Math.atan2(-m23, m33); ez = Math.atan2(-m12, m11); }
  else { ex = Math.atan2(m32, m22); ez = 0; }
  return { x: ex, y: ey, z: ez };
}

const qMul = (a: Q, b: Q): Q => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qInv = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w }); // conjugate (unit quat)
/** Rotate vector v by unit quaternion q. */
function qRot(q: Q, v: V): V {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * Transform algebra for the Actor/Component attachment hierarchy.
 *
 * A Transform is a *similarity*: uniform scale, a full rotation, and a
 * translation. Similarities are closed under composition, so a child attached to
 * a parent (which may itself be attached, …) resolves to one world Transform.
 *
 * Rotation is stored as a full Euler `rotation {x,y,z}` (radians). Legacy data
 * only had `rotationY`; `eulerOf` falls back to it, and we keep `rotationY` in
 * sync (= the Y component) so older Y-only readers still work.
 */

export const IDENTITY: Transform = { position: { x: 0, y: 0, z: 0 }, rotationY: 0, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };

/** Full Euler rotation (radians) of a transform — `rotation` if present, else the
 *  legacy Y-only `rotationY`. */
export function eulerOf(t: Transform): { x: number; y: number; z: number } {
  return t.rotation ?? { x: 0, y: t.rotationY, z: 0 };
}

/** Full rotation as a three.js Euler tuple `[x,y,z]` (radians) for `rotation={…}`. */
export function rotTuple(t: Transform): [number, number, number] {
  const r = eulerOf(t);
  return [r.x, r.y, r.z];
}

/** A Transform with a full rotation set (keeps rotationY in sync). */
export function withRotation(t: Transform, rotation: { x: number; y: number; z: number }): Transform {
  return { ...t, rotation: { ...rotation }, rotationY: rotation.y };
}

const quatOf = (t: Transform): Q => { const r = eulerOf(t); return quatFromEulerXYZ(r.x, r.y, r.z); };

/** Build a Transform from a position, quaternion and uniform scale (stores both
 *  the full `rotation` and the legacy `rotationY`). */
function make(pos: V, q: Q, scale: number): Transform {
  const e = eulerXYZFromQuat(q);
  return { position: pos, rotation: { x: e.x, y: e.y, z: e.z }, rotationY: e.y, scale };
}

/** World transform of a child whose `local` transform is expressed in `parent`'s
 *  frame: world = parent ∘ local. */
export function composeTransform(parent: Transform, local: Transform): Transform {
  const pq = quatOf(parent);
  const wq = qMul(pq, quatOf(local));
  // world position = parentPos + parentScale * (parentQuat · localPos)
  const lp = qRot(pq, local.position);
  return make(
    { x: parent.position.x + parent.scale * lp.x, y: parent.position.y + parent.scale * lp.y, z: parent.position.z + parent.scale * lp.z },
    wq,
    parent.scale * local.scale,
  );
}

/** Inverse of compose: the `local` transform such that
 *  composeTransform(parentWorld, local) === childWorld. */
export function worldToLocal(parentWorld: Transform, childWorld: Transform): Transform {
  const invQ = qInv(quatOf(parentWorld));
  const inv = parentWorld.scale === 0 ? 0 : 1 / parentWorld.scale;
  const lq = qMul(invQ, quatOf(childWorld));
  const d = qRot(invQ, {
    x: (childWorld.position.x - parentWorld.position.x) * inv,
    y: (childWorld.position.y - parentWorld.position.y) * inv,
    z: (childWorld.position.z - parentWorld.position.z) * inv,
  });
  return make({ x: d.x, y: d.y, z: d.z }, lq, childWorld.scale * inv);
}

/** The transform stored on an entity (or identity if it has none). */
export function ownTransform(components: AttachableComponents): Transform {
  return components.transform ?? IDENTITY;
}

/**
 * Resolve an entity's WORLD transform, walking the attach chain. For an entity
 * with no `attach`, its own transform is already world (identity passthrough —
 * existing flat entities are unaffected). A missing parent or a cycle falls back
 * to the entity's own stored transform (treated as world), so a broken link
 * never throws or loops.
 */
export function resolveWorldTransform(
  id: string,
  byId: Record<string, { components: AttachableComponents }>,
  seen: ReadonlySet<string> = new Set(),
): Transform {
  const entity = byId[id];
  if (!entity) return IDENTITY;
  const attach = entity.components.attach;
  const own = ownTransform(entity.components);
  if (!attach) return own;
  const parent = byId[attach.parentId];
  if (!parent || seen.has(id) || seen.has(attach.parentId)) return own; // broken / cyclic → detached
  const parentWorld = resolveWorldTransform(attach.parentId, byId, new Set(seen).add(id));
  return composeTransform(parentWorld, attach.offset);
}

/** Would attaching `childId` under `parentId` create a cycle (or self-parent)? */
export function wouldCycle(
  childId: string,
  parentId: string,
  byId: Record<string, { components: AttachableComponents }>,
): boolean {
  let cur: string | undefined = parentId;
  const guard = new Set<string>();
  while (cur) {
    if (cur === childId) return true;
    if (guard.has(cur)) return true;
    guard.add(cur);
    cur = byId[cur]?.components.attach?.parentId;
  }
  return false;
}
