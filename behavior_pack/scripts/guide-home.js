import { cell, distance2, getBlock, horizontal, offset, point, routeTree } from "./terrain.js";

export function bedTarget(personal, requireLoaded = false) {
  if (!personal || personal.dimension.id !== "minecraft:overworld") return;
  const base = cell(personal);
  const nearby = [[0, 0], ...horizontal];
  let unloaded = false;
  for (const dy of [0, -1, 1]) {
    for (const [dx, dz] of nearby) {
      const position = offset(base, dx, dy, dz);
      const block = getBlock(personal.dimension, position);
      if (block?.typeId === "minecraft:bed") {
        return { dimensionId: personal.dimension.id, location: point(position) };
      }
      if (!block) unloaded = true;
    }
  }
  if (unloaded && !requireLoaded) return { dimensionId: personal.dimension.id, location: point(base) };
}

function remaining(from, target) {
  return distance2(from, { ...target, y: target.y ?? from.y });
}

export function nearSpawn(from, target) {
  return remaining(from, target) <= 9;
}

export function guidePath(dim, from, target) {
  const { queue, hasFooting } = routeTree(dim, from);
  let best;
  let score = remaining(from, target) - 0.5;
  for (const node of queue) {
    if (!node.prev || !hasFooting(node.pos)) continue;
    const cost = remaining(point(node.pos), target) + node.length * 0.1;
    if (cost >= score) continue;
    best = node;
    score = cost;
  }
  const path = [];
  for (let step = best; step?.prev; step = step.prev) path.push(step.pos);
  return path.reverse();
}

export function spawnDirections(from, target) {
  const dx = Math.round(target.x - from.x);
  const dz = Math.round(target.z - from.z);
  const dy = target.y === undefined ? 0 : Math.round(target.y - from.y);
  return [
    dx && Math.abs(dx) + (dx > 0 ? " east" : " west"),
    dz && Math.abs(dz) + (dz > 0 ? " south" : " north"),
    dy && Math.abs(dy) + (dy > 0 ? " up" : " down")
  ].filter(Boolean).join(", ");
}
