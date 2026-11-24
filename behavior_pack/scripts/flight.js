import { cell, distance2, getBlock, offset, point, standable } from "./terrain.js";

const HALF_WIDTH = 0.31;
const HEIGHT = 1.67;
const MAX_RANGE = 4.5;
const MAX_RISE = 3;
const MAX_DROP = 2;

function clearBody(dim, pos, avoid) {
  for (let x = Math.floor(pos.x - HALF_WIDTH); x <= Math.floor(pos.x + HALF_WIDTH); x++) {
    for (let z = Math.floor(pos.z - HALF_WIDTH); z <= Math.floor(pos.z + HALF_WIDTH); z++) {
      for (let y = Math.floor(pos.y); y < Math.ceil(pos.y + HEIGHT); y++) {
        if (avoid && x === avoid.x && y === avoid.y && z === avoid.z) return false;
        if (getBlock(dim, { x, y, z })?.isAir !== true) return false;
      }
    }
  }
  return true;
}

function flightCorridorClear(dim, start, end, avoid) {
  const count = Math.max(1, Math.ceil(Math.sqrt(distance2(start, end)) / 0.12));
  for (let i = 0; i <= count; i++) {
    const fraction = i / count;
    const position = offset(start, (end.x - start.x) * fraction, (end.y - start.y) * fraction, (end.z - start.z) * fraction);
    if (!clearBody(dim, position, avoid)) return false;
  }
  return true;
}

export function planFlight(dim, start, landing, avoid) {
  const end = point(landing);
  const dx = end.x - start.x, dz = end.z - start.z;
  const across = Math.hypot(dx, dz);
  const rise = end.y - start.y;
  if (across > MAX_RANGE || rise > MAX_RISE || rise < -MAX_DROP || !standable(dim, landing, avoid)) return;
  // Clear the landing lip on an uphill hop. For level flight try a higher
  // crossing if a low skim is blocked by a full block in the middle.
  for (const clearance of rise >= 0.8 ? [0.12, 1.12] : [0.52, 1.12]) {
    const cruise = Math.max(end.y, start.y) + clearance;
    const takeoff = { ...start, y: cruise };
    const approach = { ...end, y: cruise };
    const points = [start, takeoff, approach, end];
    if (!points.slice(1).every((to, i) => flightCorridorClear(dim, points[i], to, avoid))) continue;
    return {
      landing, points, segment: 1, progress: 0,
      direction: across > 0.05 ? { x: dx / across, z: dz / across } : undefined
    };
  }
}

function hasLevelFooting(dim, from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sample = cell(offset(from, (to.x - from.x) * t, 0, (to.z - from.z) * t));
    if (!standable(dim, sample)) return false;
  }
  return true;
}

export function followFlight(dim, start, owner) {
  const gap = distance2(start, owner);
  if (gap < 1 || gap > 7 ** 2) return;
  const level = Math.abs(owner.y - start.y) < 0.8;
  if (level && (gap < 1.6 ** 2 || hasLevelFooting(dim, start, owner))) return;
  const target = cell(owner);
  const nearby = [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]]
    .map(([x,z]) => offset(target, x, 0, z))
    .sort((left, right) => distance2(start, point(left)) - distance2(start, point(right)));
  for (const landing of [...nearby, target]) {
    const end = point(landing);
    if (distance2(start, end) < 0.65 ** 2 || distance2(end, owner) + 0.25 >= gap) continue;
    // Landing on the near side of a gap would leave the same obstruction ahead.
    if (level && hasLevelFooting(dim, start, end)) continue;
    const plan = planFlight(dim, start, landing);
    if (plan) return plan;
  }
}

export function advanceFlight(pet, flight, avoid) {
  if (!standable(pet.dimension, flight.landing, avoid)) return "blocked";
  const end = flight.points[flight.segment];
  const start = flight.points[flight.segment - 1];
  const length = Math.sqrt(distance2(start, end));
  const speed = flight.segment === 2 ? 0.23 : 0.19;
  const progress = length > 0 ? Math.min(1, flight.progress + speed / length) : 1;
  const position = progress === 1 ? end
    : offset(start, (end.x - start.x) * progress, (end.y - start.y) * progress, (end.z - start.z) * progress);
  if (!flightCorridorClear(pet.dimension, pet.location, position, avoid)) return "blocked";
  const options = { checkForBlocks: true };
  if (flight.direction) options.facingLocation = offset(position, flight.direction.x, 0, flight.direction.z);
  pet.clearVelocity();
  if (!pet.tryTeleport(position, options)) return "blocked";
  if (progress < 1) {
    flight.progress = progress;
    return "flying";
  }
  flight.progress = 0;
  flight.segment++;
  return flight.segment < flight.points.length ? "flying" : "arrived";
}

export function abortFlight(pet, flight) {
  const takeoff = flight.points[0];
  if (!standable(pet.dimension, cell(takeoff)) || distance2(pet.location, takeoff) < 0.01) return false;
  // If a block is placed during flight, retreat along the cleared leg of
  // the route to solid ground, provided the path back is still open.
  const retreat = flight.points.slice(0, flight.segment).reverse();
  const starts = [pet.location, ...retreat];
  if (!retreat.every((to, i) => flightCorridorClear(pet.dimension, starts[i], to))) return false;
  pet.clearVelocity();
  return pet.tryTeleport(takeoff, { checkForBlocks: true });
}
