import test from "node:test";
import assert from "node:assert/strict";
import { appearances } from "../behavior_pack/scripts/appearances.js";
import { abortFlight, advanceFlight, followFlight, planFlight } from "../behavior_pack/scripts/flight.js";
import { key } from "../behavior_pack/scripts/terrain.js";

const air = { typeId: "minecraft:air", isAir: true };
const stone = { typeId: "minecraft:stone", isAir: false };
const takeoff = { x: 0.5, y: 4, z: 0.5 };
function fixture(entries = []) {
  const blocks = new Map(entries);
  const dimension = {
    getBlock: pos => blocks.has(key(pos)) ? blocks.get(key(pos)) : pos.y <= 3 ? stone : air
  };
  const pet = {
    dimension, location: takeoff, moves: [],
    clearVelocity() {},
    tryTeleport(pos, options) {
      assert.equal(options.checkForBlocks, true);
      this.location = pos;
      this.moves.push(pos);
      return true;
    }
  };
  return { dimension, pet, blocks };
}

function finish(pet, flight) {
  assert.ok(flight);
  for (let i = 0; i < 90; i++) {
    const outcome = advanceFlight(pet, flight);
    if (outcome === "arrived") return;
    assert.equal(outcome, "flying");
  }
  assert.fail("Flight did not land within its job deadline.");
}

test("Sora is the only appearance with flight", () => {
  assert.deepEqual(appearances.filter(profile => profile?.canFly).map(profile => profile.icon), ["sora"]);
});

test("a work hop clears the ledge before crossing and ends at the original waypoint", () => {
  const { dimension, pet } = fixture([["1,4,0", stone]]);
  const landing = { x: 1, y: 5, z: 0 };
  finish(pet, planFlight(dimension, takeoff, landing));
  assert.deepEqual(pet.location, { x: 1.5, y: 5, z: 0.5 });
  assert.ok(pet.moves.some(pos => pos.y > 5 && pos.x === takeoff.x));
  assert.ok(pet.moves.every(pos => pos.x < 0.69 || pos.y >= 5));
});

test("touching a one-block face does not count as intersecting it", () => {
  const { dimension, pet } = fixture([["1,4,0", stone]]);
  pet.location = { ...takeoff, x: 0.69 };
  const landing = { x: 1, y: 5, z: 0 };
  const flight = planFlight(dimension, pet.location, landing);
  finish(pet, flight);
  assert.deepEqual(pet.location, { x: 1.5, y: 5, z: 0.5 });
});

test("follow flight reaches the owner across a gap and skips level ground", () => {
  const owner = { x: 3.5, y: 4, z: 0.5 };
  const { dimension, pet } = fixture();
  assert.equal(followFlight(dimension, takeoff, owner), undefined);
  const trench = [-2, -1, 0, 1, 2].flatMap(z => [[`1,3,${z}`, air], [`2,3,${z}`, air]]);
  const gap = fixture(trench);
  finish(gap.pet, followFlight(gap.dimension, takeoff, owner));
  assert.ok(gap.pet.location.x >= 3.5);
  assert.ok(gap.pet.moves.some(pos => pos.x > 1 && pos.x < 3 && pos.y > 4));
  assert.equal(pet.moves.length, 0);
});

test("follow flight clears a low obstacle and can reach a three-block ledge", () => {
  const low = fixture([["1,4,0", stone]]);
  finish(low.pet, followFlight(low.dimension, takeoff, { x: 2.5, y: 4, z: 0.5 }));
  assert.ok(low.pet.moves.some(pos => pos.y >= 5));
  const wall = fixture([["1,4,0", stone], ["1,5,0", stone], ["1,6,0", stone]]);
  finish(wall.pet, followFlight(wall.dimension, takeoff, { x: 1.5, y: 7, z: 0.5 }));
  assert.equal(wall.pet.location.y, 7);
});

test("flight rejects ceilings, unloaded corridors, hazardous landings, and excessive range", () => {
  const landing = { x: 2, y: 4, z: 0 };
  for (const entries of [
    [["0,6,0", stone]],
    [["1,5,0", undefined]],
    [["2,3,0", { typeId: "minecraft:lava", isLiquid: true }]],
    [["2,4,0", stone]]
  ]) {
    const { dimension } = fixture(entries);
    assert.equal(planFlight(dimension, takeoff, landing), undefined);
  }
  const { dimension } = fixture();
  assert.equal(planFlight(dimension, takeoff, { x: 6, y: 4, z: 0 }), undefined);
  assert.equal(planFlight(dimension, takeoff, { x: 0, y: 8, z: 0 }), undefined);
});

test("a new obstruction aborts the hop and Sora can retreat to the takeoff tile", () => {
  const { dimension, pet, blocks } = fixture([["1,3,0", air]]);
  const flight = planFlight(dimension, takeoff, { x: 2, y: 4, z: 0 });
  assert.equal(advanceFlight(pet, flight), "flying");
  blocks.set("1,5,0", stone);
  let outcome;
  for (let i = 0; i < 15; i++) {
    outcome = advanceFlight(pet, flight);
    if (outcome !== "flying") break;
  }
  assert.equal(outcome, "blocked");
  assert.ok(pet.location.x < 0.7);
  assert.equal(abortFlight(pet, flight), true);
  assert.deepEqual(pet.location, takeoff);
});

test("flight stops if the landing loses support or the game refuses movement", () => {
  const { dimension, pet, blocks } = fixture();
  const landing = { x: 2, y: 4, z: 0 };
  const flight = planFlight(dimension, takeoff, landing);
  blocks.set("2,3,0", air);
  assert.equal(advanceFlight(pet, flight), "blocked");
  blocks.delete("2,3,0");
  pet.tryTeleport = () => false;
  assert.equal(advanceFlight(pet, flight), "blocked");
  assert.equal(flight.progress, 0);
});
