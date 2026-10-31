// Pure world-space aiming rules. Angles are radians; distances use world units.
export const AIM_LIMITS = Object.freeze({
  minPitch: -70 * Math.PI / 180,
  maxPitch: 75 * Math.PI / 180,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const validVector = value => value && Number.isFinite(value.x) &&
  Number.isFinite(value.y) && Number.isFinite(value.z);
const validRange = value => value === Infinity || (Number.isFinite(value) && value >= 0);
const validBounds = bounds => bounds && validVector(bounds.min) && validVector(bounds.max) &&
  bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y &&
  bounds.min.z <= bounds.max.z;

export function applyLook(state, dx, dy, sensitivity = 100) {
  const yaw = finiteOr(state && state.yaw, 0);
  const pitch = clamp(finiteOr(state && state.pitch, 0), AIM_LIMITS.minPitch, AIM_LIMITS.maxPitch);
  const scale = (Number.isFinite(sensitivity) && sensitivity >= 0 ? sensitivity : 100) / 100;
  const nextYaw = yaw - finiteOr(dx, 0) * .006 * scale;
  const nextPitch = pitch - finiteOr(dy, 0) * .0045 * scale;
  return {
    yaw: finiteOr(nextYaw, yaw),
    pitch: clamp(Number.isNaN(nextPitch) ? pitch : nextPitch,
      AIM_LIMITS.minPitch, AIM_LIMITS.maxPitch),
  };
}

export function aimDirection(yaw, pitch) {
  yaw = finiteOr(yaw, 0);
  pitch = finiteOr(pitch, 0);
  const horizontal = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * horizontal,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * horizontal,
  };
}

function normalized(direction) {
  if (!validVector(direction)) return null;
  // Scale first so even very large or very small finite directions normalize.
  const scale = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
  if (scale === 0) return null;
  const x = direction.x / scale;
  const y = direction.y / scale;
  const z = direction.z / scale;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

function boxDistance(origin, direction, bounds, maxDistance) {
  let near = 0;
  let far = maxDistance;
  for (const axis of ['x', 'y', 'z']) {
    if (direction[axis] === 0) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return null;
      continue;
    }
    const a = (bounds.min[axis] - origin[axis]) / direction[axis];
    const b = (bounds.max[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return Number.isFinite(near) ? near : null;
}

// Accepts normalized directions; defensively normalizes other nonzero finite
// directions too, so returned distances/maxDistance always mean world units.
// A ray starting inside/on the box returns 0, including at maxDistance = 0.
export function rayBox(origin, direction, bounds, maxDistance = Infinity) {
  if (!validVector(origin) || !validBounds(bounds) || !validRange(maxDistance)) return null;
  const unit = normalized(direction);
  return unit ? boxDistance(origin, unit, bounds, maxDistance) : null;
}

// Direct hits always precede assisted candidates. This only proposes targets:
// the caller must still check world occlusion and the actual muzzle shot ray.
export function aimCandidates(options) {
  if (!options || !validVector(options.origin) || !Array.isArray(options.targets)) return [];
  const origin = options.origin;
  const direction = normalized(options.direction);
  const range = options.range === undefined ? Infinity : options.range;
  if (!direction || !validRange(range)) return [];
  const horizontalAssist = Math.max(0, finiteOr(options.horizontalAssist, 0));
  const verticalAssist = Math.max(0, finiteOr(options.verticalAssist, 0));
  const horizontalLength = Math.hypot(direction.x, direction.z);
  const elevation = Math.atan2(direction.y, horizontalLength);
  const candidates = [];
  options.targets.forEach((target, index) => {
    if (!target || target.id === undefined || target.id === null || !validBounds(target.bounds)) return;
    const bounds = target.bounds;
    const directDistance = boxDistance(origin, direction, bounds, range);
    if (directDistance !== null) {
      candidates.push({
        id: target.id,
        point: {
          x: origin.x + direction.x * directDistance,
          y: origin.y + direction.y * directDistance,
          z: origin.z + direction.z * directDistance,
        },
        distance: directDistance, direct: true, score: directDistance, index,
      });
      return;
    }
    const x = bounds.min.x / 2 + bounds.max.x / 2;
    const z = bounds.min.z / 2 + bounds.max.z / 2;
    const dx = x - origin.x;
    const dz = z - origin.z;
    const horizontalDistance = Math.hypot(dx, dz);
    // With a perfectly vertical ray there is no horizontal heading to assist
    // towards. Direct vertical hits above/below were already handled.
    if (horizontalLength === 0 && horizontalDistance > 0) return;
    const horizontalAngle = horizontalDistance === 0 ? 0 : Math.atan2(
      Math.abs(direction.x * dz - direction.z * dx),
      direction.x * dx + direction.z * dz,
    );
    if (horizontalAngle > horizontalAssist + 1e-12) return;
    const padding = bounds.max.y - bounds.min.y >= .1 ? .05 : 0;
    const rayHeight = horizontalLength > 0
      ? origin.y + direction.y / horizontalLength * horizontalDistance
      : origin.y;
    const y = clamp(rayHeight, bounds.min.y + padding, bounds.max.y - padding);
    const verticalAngle = Math.abs(Math.atan2(y - origin.y, horizontalDistance) - elevation);
    if (verticalAngle > verticalAssist + 1e-12) return;
    const distance = Math.hypot(dx, y - origin.y, dz);
    if (!Number.isFinite(distance) || distance > range) return;
    candidates.push({
      id: target.id, point: { x, y, z }, distance, direct: false,
      score: distance * (1 + horizontalAngle * 3), index,
    });
  });
  candidates.sort((a, b) => Number(b.direct) - Number(a.direct) ||
    a.score - b.score || a.distance - b.distance || a.index - b.index);
  const seen = new Set();
  return candidates.filter(candidate => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).map(candidate => ({
    id: candidate.id, point: candidate.point, distance: candidate.distance, direct: candidate.direct,
  }));
}
