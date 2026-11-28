import test from "node:test";
import assert from "node:assert/strict";
import { bedTarget, guidePath, nearSpawn, spawnDirections } from "../behavior_pack/scripts/guide-home.js";

test("finds the owner's bed and rejects world spawn, Nether anchors, and missing beds", () => {
  const dimension = {
    id: "minecraft:overworld",
    getBlock: ({ x, y, z }) => ({ typeId: x === 13 && y === 63 && z === -9 ? "minecraft:bed" : "minecraft:air" })
  };
  const spawn = { x: 12, y: 64, z: -9, dimension };
  assert.deepEqual(bedTarget(spawn), { dimensionId: dimension.id, location: { x: 13.5, y: 63, z: -8.5 } });
  assert.equal(bedTarget(undefined), undefined);
  assert.equal(bedTarget({ ...spawn, dimension: { id: "minecraft:nether" } }), undefined);
  assert.equal(bedTarget({ ...spawn, x: 22 }), undefined);
  const unloaded = bedTarget({ ...spawn, dimension: { ...dimension, getBlock: () => undefined } });
  assert.ok(nearSpawn({ x: 12, y: 65, z: -9 }, unloaded.location));
  assert.equal(spawnDirections({ x: 8.5, y: 64, z: -4.5 }, unloaded.location), "4 east, 4 north");
  assert.ok(!nearSpawn({ x: 12, y: 75, z: -9 }, unloaded.location));
});

test("takes a walkable route toward spawn and avoids water", () => {
  const stone = { typeId: "minecraft:stone", isAir: false };
  const air = { typeId: "minecraft:air", isAir: true };
  const water = { typeId: "minecraft:water", isLiquid: true, isAir: false };
  const dimension = {
    getBlock: ({ x, y, z }) => y <= 3 ? stone : x === 1 && z === 0 ? water : air
  };
  const path = guidePath(dimension, { x: 0.5, y: 4, z: 0.5 }, { x: 8, y: 4, z: 0 });
  assert.ok(path.at(-1).x > 1);
  assert.ok(path.every(({ x, z }) => x !== 1 || z !== 0));
  assert.deepEqual(guidePath({ getBlock: () => undefined }, { x: 0, y: 4, z: 0 }, { x: 8, y: 4, z: 0 }), []);
});
