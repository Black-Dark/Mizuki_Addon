import test from "node:test";
import assert from "node:assert/strict";
import { key, routeTo, routeTree, safeArrival, standable } from "../behavior_pack/scripts/terrain.js";

const start = { x: 0, y: 4, z: 0 };
const floor = { typeId: "minecraft:stone", isAir: false, isLiquid: false };
const air = { typeId: "minecraft:air", isAir: true, isLiquid: false };
function fixture(overrides = new Map(), ray) {
  return {
    getBlock: pos => overrides.has(key(pos)) ? overrides.get(key(pos)) : pos.y <= 3 ? floor : air,
    getBlockFromRay: ray ?? (() => undefined)
  };
}
test("rejects lava water and unloaded positions", () => {
  for (const hazard of [{ typeId: "minecraft:lava", isLiquid: true }, { typeId: "minecraft:water", isLiquid: true }, undefined]) {
    const dimension = fixture(new Map([["1,4,0", hazard]]));
    assert.equal(standable(dimension, start), false);
  }
});

test("safe arrival uses unobstructed footing and avoids the player cell", () => {
  const dimension = fixture(new Map([["-2,4,-2", floor]]));
  const arrival = safeArrival(dimension, { x: 0.5, y: 4, z: 0.5 });
  assert.notDeepEqual(arrival, { x: 0.5, y: 4, z: 0.5 });
  assert.equal(standable(dimension, { x: Math.floor(arrival.x), y: arrival.y, z: Math.floor(arrival.z) }), true);
});

test("route stops short of its chest and caps search distance", () => {
  const target = { x: 4, y: 4, z: 0 };
  const dimension = fixture(new Map([[key(target), floor]]));
  const route = routeTo(dimension, routeTree(dimension, start), target, target);
  assert.ok(route.length > 0 && route.length < 5);
  assert.ok(route.every(cell => key(cell) !== key(target)));
  assert.equal(routeTo(dimension, routeTree(dimension, start), { x: 18, y: 4, z: 0 }), undefined);
});

test("walls blocking sight make the target ineligible", () => {
  const dimension = fixture(new Map(), () => ({ block: { location: { x: 99, y: 4, z: 99 } } }));
  assert.equal(routeTo(dimension, routeTree(dimension, start), { x: 4, y: 4, z: 0 }), undefined);
});
