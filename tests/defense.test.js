import test from "node:test";
import assert from "node:assert/strict";
import { canStrike, mobThreat } from "../behavior_pack/scripts/defense.js";

test("recognizes a living custom mob without relying on its family tags", () => {
  const custom = { typeId: "example:mob", isValid: true, getComponent: () => ({ currentValue: 10 }) };
  assert.ok(mobThreat(custom, "ochub:mizuki_todoroki"));
  for (const typeId of ["minecraft:player", "ochub:mizuki_todoroki"]) {
    assert.equal(mobThreat({ ...custom, typeId }, "ochub:mizuki_todoroki"), false);
  }
  assert.equal(mobThreat({ ...custom, getComponent: () => ({ currentValue: 0 }) }, "ochub:mizuki_todoroki"), false);
});

test("strikes only within reach and with a clear line of sight", () => {
  const pet = { location: { x: 0, y: 4, z: 0 }, dimension: { getBlockFromRay: () => undefined } };
  const near = { location: { x: 2, y: 4, z: 0 } };
  assert.equal(canStrike(pet, near), true);
  assert.equal(canStrike(pet, { location: { x: 3, y: 4, z: 0 } }), false);
  pet.dimension.getBlockFromRay = () => ({ block: { location: { x: 1, y: 4, z: 0 } } });
  assert.equal(canStrike(pet, near), false);
});
