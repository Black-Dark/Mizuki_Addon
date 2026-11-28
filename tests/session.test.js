import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { cell, distance2, safeArrival } from "../behavior_pack/scripts/terrain.js";

const main = readFileSync(new URL("../behavior_pack/scripts/main.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "");

function signals() {
  const handlers = new Map();
  return new Proxy({}, {
    get(_target, name) {
      if (!handlers.has(name)) handlers.set(name, []);
      return {
        subscribe: listener => handlers.get(name).push(listener),
        fire: event => handlers.get(name).forEach(listener => listener(event))
      };
    }
  });
}

function start() {
  const players = new Map();
  const pets = new Map();
  const records = new Map();
  const prompts = [];
  const warnings = [];
  const dimension = {
    id: "minecraft:overworld",
    getEntities: () => [...pets.values()],
    getBlock: ({ y }) => y < 4 ? { typeId: "minecraft:stone" } : { typeId: "minecraft:air", isAir: true }
  };
  const world = {
    beforeEvents: signals(), afterEvents: signals(),
    getAllPlayers: () => [...players.values()],
    getEntity: id => pets.get(id),
    getDimension: id => id === "overworld" ? dimension : { getEntities: () => [] },
    getDynamicProperty: name => records.get(name),
    setDynamicProperty: (name, value) => records.set(name, value),
    tickingAreaManager: { removeAllTickingAreas() {} }
  };
  class Form {
    title() { return this; }
    body() { return this; }
    button() { return this; }
    show() { return new Promise(resolve => prompts.push(resolve)); }
  }
  const exports = runInNewContext(main + "\n;({ getTask, openMenus, recallTo, showMenu });", {
    world, system: { beforeEvents: signals(), currentTick: 100, runInterval() {} },
    cell, distance2, safeArrival,
    GameMode: { Spectator: "spectator" }, PlayerPermissionLevel: { Member: 1, Operator: 2 },
    ActionFormData: Form, FormCancelationReason: { UserBusy: "busy" },
    appearanceOf: () => ({ name: "Mizuki", greeting: "Ready", voice: "Mizuki" }),
    console: { warn: value => warnings.push(value) }
  });
  function addPlayer(id) {
    const properties = new Map();
    const player = {
      id, isValid: true, playerPermissionLevel: 1, dimension, location: { x: 0.5, y: 4, z: 0.5 },
      getGameMode: () => "survival",
      getDynamicProperty: name => properties.get(name),
      setDynamicProperty: (name, value) => properties.set(name, value),
      sendMessage() {}
    };
    players.set(id, player);
    return player;
  }
  function addPet(owner, { stays = false, failingInventory = false } = {}) {
    const properties = new Map([["cc:owner", owner], ["cc:stay", stays]]);
    const state = new Map([["cc:pose", "fly"]]);
    const events = [];
    const bag = { size: 63, getItem: slot => slot === 0 ? {} : undefined };
    const pet = {
      id: owner + "-pet", typeId: "ochub:mizuki_todoroki", dimension, isValid: true,
      location: { x: 1.5, y: 4, z: 0.5 }, events,
      getDynamicProperty: name => properties.get(name),
      setDynamicProperty: (name, value) => properties.set(name, value),
      getProperty: name => state.get(name),
      setProperty: (name, value) => state.set(name, value),
      getComponent(name) {
        if (name !== "minecraft:inventory") return;
        if (failingInventory) throw new Error("Test inventory unavailable");
        return { container: bag };
      },
      triggerEvent: event => events.push(event),
      tryTeleport(location) { this.location = location; return true; },
      clearVelocity() {},
      extinguishFire() {}
    };
    records.set("cc:owner-link:" + owner, pet.id);
    pets.set(pet.id, pet);
    return pet;
  }
  return { ...exports, world, addPlayer, addPet, prompts, warnings };
}

test("join restores Stay and clears an airborne pose; duplicate load events preserve a live job", () => {
  const { world, addPlayer, addPet, getTask } = start();
  const player = addPlayer("penney");
  const pet = addPet(player.id, { stays: true });
  world.afterEvents.playerSpawn.fire({ player, initialSpawn: true });
  assert.deepEqual(pet.events, ["cc:pause_follow"]);
  assert.equal(pet.getProperty("cc:pose"), "idle");
  const job = { kind: "test" };
  getTask(player.id).job = job;
  world.afterEvents.entityLoad.fire({ entity: pet });
  assert.equal(getTask(player.id).job, job);
  assert.deepEqual(pet.events, ["cc:pause_follow"]);
});

test("a failed saved-pet recovery does not prevent loading the next player's companion", () => {
  const { world, addPlayer, addPet, warnings } = start();
  addPlayer("first");
  addPlayer("second");
  addPet("first", { failingInventory: true });
  const pet = addPet("second");
  world.afterEvents.worldLoad.fire({});
  assert.deepEqual(pet.events, ["cc:resume_follow"]);
  assert.equal(pet.getProperty("cc:pose"), "carry");
  assert.match(warnings[0], /Test inventory unavailable/);
});

test("recall restarts native follow even before the first companion tick", () => {
  const { addPlayer, addPet, recallTo } = start();
  const player = addPlayer("penney");
  const pet = addPet(player.id, { stays: true });
  assert.equal(recallTo(pet, player), true);
  assert.deepEqual(pet.events, ["cc:resume_follow"]);
  assert.equal(pet.getDynamicProperty("cc:stay"), undefined);
});

test("a form completing after disconnect leaves the replacement session locked", async () => {
  const { addPlayer, openMenus, prompts, showMenu, world } = start();
  const departed = addPlayer("penney");
  const pending = showMenu(departed);
  departed.isValid = false;
  world.afterEvents.playerLeave.fire({ playerId: departed.id });
  const current = addPlayer(departed.id);
  const replacement = showMenu(current);
  assert.equal(prompts.length, 2);
  const session = openMenus.get(current.id);
  prompts[0]({ canceled: true });
  await pending;
  assert.equal(openMenus.get(current.id), session);
  prompts[1]({ canceled: true });
  await replacement;
  assert.equal(openMenus.has(current.id), false);
});
