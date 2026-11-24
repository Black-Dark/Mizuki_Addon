const vanilla = ids => new Set(ids.split(" ").map(id => "minecraft:" + id));
const floorTypes = vanilla(
  "bedrock stone cobblestone mossy_cobblestone deepslate cobbled_deepslate tuff calcite granite diorite andesite " +
  "dirt grass_block coarse_dirt rooted_dirt podzol mycelium mud packed_mud sand red_sand gravel sandstone red_sandstone " +
  "clay terracotta bricks stone_bricks stonebrick glass obsidian crying_obsidian netherrack basalt blackstone " +
  "soul_soil end_stone purpur_block moss_block farmland snow snow_block planks oak_planks spruce_planks birch_planks " +
  "jungle_planks acacia_planks dark_oak_planks mangrove_planks cherry_planks pale_oak_planks bamboo_planks " +
  "crimson_planks warped_planks cobbled_deepslate bricks mud_bricks packed_ice blue_ice"
);
const unsafe = vanilla("lava flowing_lava fire soul_fire magma cactus sweet_berry_bush powder_snow lit_campfire campfire soul_campfire pointed_dripstone wither_rose");
export const horizontal = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const key = p => `${p.x},${p.y},${p.z}`;
export const cell = p => ({ x: Math.floor(p.x), y: Math.floor(p.y + 0.08), z: Math.floor(p.z) });
export const point = p => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
export const center = p => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
export const offset = (p, x, y, z) => ({ x: p.x + x, y: p.y + y, z: p.z + z });
export const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

export function getBlock(dim, pos) {
  try {
    return dim.getBlock(pos);
  } catch (error) {
    if (error.name !== "LocationInUnloadedChunkError" && error.name !== "LocationOutOfWorldBoundariesError") throw error;
    return undefined;
  }
}

const walkThrough = vanilla("short_grass tall_grass tallgrass fern large_fern deadbush snow_layer");
const clearFooting = block => block && (block.isAir || walkThrough.has(block.typeId));

export function standable(dim, pos, avoid) {
  if (avoid && key(pos) === key(avoid)) return false;
  const feet = getBlock(dim, pos);
  const head = getBlock(dim, offset(pos, 0, 1, 0));
  const below = offset(pos, 0, -1, 0);
  const floor = getBlock(dim, below);
  if (!clearFooting(feet) || !clearFooting(head) || !floor || (avoid && key(below) === key(avoid))) return false;
  if (!floorTypes.has(floor.typeId) || floor.isWaterlogged) return false;
  return horizontal.every(([x, z]) => {
    const side = getBlock(dim, offset(pos, x, 0, z));
    return side && !side.isLiquid && !unsafe.has(side.typeId);
  });
}

export function clearSight(dim, source, target, maxDistance = 2.3) {
  const vector = { x: target.x - source.x, y: target.y - source.y, z: target.z - source.z };
  const length = Math.sqrt(distance2(source, target));
  if (length > maxDistance) return false;
  if (length < 0.01) return true;
  const direction = { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  const ray = dim.getBlockFromRay(source, direction, {
    maxDistance: length, includeLiquidBlocks: true, includePassableBlocks: false
  });
  return !ray || key(ray.block.location) === key({ x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) });
}

export function safeArrival(dim, near) {
  const at = cell(near);
  for (const radius of [2, 3, 1]) {
    for (const dy of [0, 1, -1, 2, -2]) {
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
          const pos = offset(at, x, dy, z);
          if (standable(dim, pos)) return point(pos);
        }
      }
    }
  }
}

// Build one short, level route tree for all possible targets. Native AI handles
// broader exploration. Tasks take one-block stair steps only when headroom permits.
export function canClimb(dim, from, to, avoid) {
  return to.y === from.y + 1 && Math.abs(to.x - from.x) + Math.abs(to.z - from.z) === 1
    && standable(dim, from, avoid) && standable(dim, to, avoid)
    && getBlock(dim, offset(from, 0, 2, 0))?.isAir === true;
}

export function routeTree(dim, from, avoid, limit = 180) {
  const start = cell(from);
  const first = { pos: start, prev: undefined, length: 0 };
  const queue = [first];
  const known = new Map([[key(start), first]]);
  const footing = new Map();
  function hasFooting(pos) {
    const id = key(pos);
    if (!footing.has(id)) footing.set(id, standable(dim, pos, avoid));
    return footing.get(id);
  }
  for (let i = 0; i < queue.length && queue.length < limit; i++) {
    const node = queue[i];
    if (node.length >= 10) continue;
    for (const [x, z] of horizontal) {
      for (const y of [0, 1, -1]) {
        const next = offset(node.pos, x, y, z);
        if (known.has(key(next))) break;
        if (!hasFooting(next)) continue;
        if (y === 1 && !canClimb(dim, node.pos, next, avoid)) continue;
        if (y === -1 && !getBlock(dim, offset(next, 0, 2, 0))?.isAir) continue;
        const step = { pos: next, prev: node, length: node.length + 1 };
        queue.push(step);
        known.set(key(next), step);
        break;
      }
    }
  }
  return { queue, hasFooting };
}

function pathTo(node) {
  const path = [];
  for (let step = node; step.prev; step = step.prev) path.push(step.pos);
  return path.reverse();
}

export function ledgeRoute(dim, from, owner) {
  const start = cell(from);
  const target = cell(owner);
  const tree = routeTree(dim, from);
  for (const node of tree.queue) {
    if (node.pos.y !== target.y || distance2(point(node.pos), owner) > 2.5 || !tree.hasFooting(node.pos)) continue;
    const path = pathTo(node);
    if (path.some(step => step.y > start.y)) return path;
  }
}

export function routeTo(dim, tree, target, avoid, destination = center(target)) {
  for (const node of tree.queue) {
    if (distance2(node.pos, target) > 5 || (avoid && key(node.pos) === key(avoid))) continue;
    if (!tree.hasFooting(node.pos)) continue;
    if (!clearSight(dim, offset(point(node.pos), 0, 0.67, 0), destination)) continue;
    return pathTo(node);
  }
}
