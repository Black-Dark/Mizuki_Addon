import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { BlockVolume, CommandPermissionLevel, CustomCommandStatus, GameMode, ItemStack, Player, PlayerPermissionLevel, system, world } from "@minecraft/server";
import { appearanceKey, appearanceOf, appearances } from "./appearances.js";
import { abortFlight, advanceFlight, followFlight, planFlight } from "./flight.js";
import { chestRank, commit, depositSlot, planInsert, restore, snapshot } from "./inventory.js";
import { canClimb, cell, center, clearSight, distance2, getBlock, key, ledgeRoute, offset, point, routeTo, routeTree, safeArrival, standable } from "./terrain.js";
import { eligible, forgetPlacement, harvest, heldTool, makeTrigger, reachableCandidates, trackPlacement, withinWorkRange } from "./resources.js";

const TYPE = "ochub:mizuki_todoroki";
const ACTIVITY_TICKS = 320;
const WORK_BATCH_SIZE = 4;
const openMenus = new Set();
const menuRequests = new Map();
const tasks = new Map();
const claims = new Map();
const recalls = new Set();
const lastWarnings = new Map();

const stateKey = "cc:pose";
const ownerKey = "cc:owner";
const packKey = "cc:entity";
const sortOffKey = "cc:sort_off";
const workOffKey = "cc:work_off";
const inv = entity => entity?.getComponent("minecraft:inventory")?.container;
const tame = entity => entity.getComponent("minecraft:tameable");
const reply = (player, message) => player.sendMessage(`§b[Chibi Companions]§r ${message}`);
const speak = (player, profile, line) => player.sendMessage(`§b[${profile.voice}]§r ${line}`);
const now = () => system.currentTick;
const linkKey = id => `cc:owner-link:${id}`;
const fullMember = player => player.playerPermissionLevel === PlayerPermissionLevel.Member
  || player.playerPermissionLevel === PlayerPermissionLevel.Operator;

function guarded(label, run) {
  try {
    return run();
  } catch (error) {
    if (now() - (lastWarnings.get(label) ?? -1000) >= 100) {
      lastWarnings.set(label, now());
      console.warn(`[Chibi Companions] ${label}: ${error.stack ?? error}`);
    }
  }
}

function locate(player) {
  const id = world.getDynamicProperty(linkKey(player.id)) ?? player.getDynamicProperty(packKey);
  if (typeof id !== "string") return undefined;
  const pet = world.getEntity(id);
  return pet?.isValid && pet.typeId === TYPE && pet.getDynamicProperty(ownerKey) === player.id ? pet : undefined;
}

function workReply(player, line, fallback) {
  const pet = locate(player);
  if (!pet) return reply(player, fallback);
  const profile = appearanceOf(pet);
  speak(player, profile, profile[line]);
}

function remember(pet, ownerId) {
  const { dimension, location } = pet;
  world.setDynamicProperty(linkKey(ownerId), pet.id);
  world.setDynamicProperty(`${linkKey(ownerId)}:spot`, JSON.stringify({ dim: dimension.id, pos: cell(location) }));
}

function setPose(pet, pose) {
  if (pet.getProperty(stateKey) !== pose) pet.setProperty(stateKey, pose);
}

function follow(pet, task, mood) {
  if (task.pausedAI) {
    pet.triggerEvent("cc:resume_follow");
    task.pausedAI = false;
  }
  const backpack = inv(pet);
  setPose(pet, mood ?? (backpack && backpack.emptySlotsCount < backpack.size ? "carry" : "idle"));
}

function park(pet, task) {
  if (!task.pausedAI) {
    pet.triggerEvent("cc:pause_follow");
    task.pausedAI = true;
  }
}

function register(player, pet) {
  pet.setDynamicProperty(ownerKey, player.id);
  player.setDynamicProperty(packKey, pet.id);
  remember(pet, player.id);
  pet.triggerEvent("cc:resume_follow");
}

function recoverLegacy(pet) {
  const ownerId = pet.getDynamicProperty(ownerKey) ?? tame(pet)?.tamedToPlayerId;
  if (!ownerId) return;
  const owner = world.getAllPlayers().find(player => player.id === ownerId);
  const current = world.getDynamicProperty(linkKey(ownerId));
  if (current && current !== pet.id) {
    pet.triggerEvent("cc:pause_follow");
    setPose(pet, "idle");
    return;
  }
  if (owner) {
    register(owner, pet);
    tasks.delete(ownerId);
  }
  else {
    pet.setDynamicProperty(ownerKey, ownerId);
    remember(pet, ownerId);
    pet.triggerEvent("cc:pause_follow");
  }
}

function spawnCompanion(player) {
  const arrival = safeArrival(player.dimension, player.location);
  if (!arrival) return reply(player, "Stand near two clear blocks over solid ground and try again.");
  const pet = player.dimension.spawnEntity(TYPE, arrival);
  try {
    if (!tame(pet)?.tame(player)) throw new Error("Bedrock rejected taming.");
    register(player, pet);
  } catch (error) {
    pet.remove();
    reply(player, "Your companion could not be summoned. Check the content log.");
    throw error;
  }
  reply(player, "Little Snowdrop is here! Interact with me using an empty hand to open my menu.");
}

function recallTo(pet, player) {
  const arrival = safeArrival(player.dimension, player.location);
  if (!arrival) return false;
  if (!pet.tryTeleport(arrival, { dimension: player.dimension, checkForBlocks: true })) return false;
  pet.clearVelocity();
  pet.extinguishFire();
  remember(pet, player.id);
  const task = tasks.get(player.id);
  if (task) {
    task.job = undefined;
    task.trigger = undefined;
    task.lastMove = now();
    task.recallAt = now() + 200;
    follow(pet, task, "idle");
  }
  return true;
}

function reportRecall(player, pet) {
  if (!recallTo(pet, player)) return reply(player, "I need a clear place to stand nearby.");
  const profile = appearanceOf(pet);
  speak(player, profile, profile.recalled);
}

async function summonOrRecall(player) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return reply(player, "You need building permissions to call a companion.");
  if (recalls.has(player.id)) return reply(player, "Your companion is already on the way.");
  const existing = locate(player);
  if (existing) return reportRecall(player, existing);
  // Adopt a tamed Mizuki from the original pack if she is currently loaded.
  for (const dimId of ["overworld", "nether", "the_end"]) {
    for (const old of world.getDimension(dimId).getEntities({ type: TYPE })) {
      if (tame(old)?.tamedToPlayerId === player.id) recoverLegacy(old);
    }
  }
  const legacy = locate(player);
  if (legacy) return reportRecall(player, legacy);
  const id = world.getDynamicProperty(linkKey(player.id)) ?? player.getDynamicProperty(packKey);
  if (typeof id !== "string") return spawnCompanion(player);
  const raw = world.getDynamicProperty(`${linkKey(player.id)}:spot`);
  if (typeof raw !== "string") return reply(player, "Your companion is away. Return to where you last saw them.");
  const { dim, pos } = JSON.parse(raw);
  const dimension = world.getDimension(dim);
  const area = `cc.recall.${player.id}`;
  const areas = world.tickingAreaManager;
  // A pet may have crossed a chunk edge between the last save and unload.
  const options = { dimension, from: offset(pos, -5, 0, -5), to: offset(pos, 5, 0, 5) };
  if (!areas.hasCapacity(options)) return reply(player, "Recall is busy. Try again in a moment or revisit her last location.");
  recalls.add(player.id);
  try {
    await areas.createTickingArea(area, options);
    if (!player.isValid) return;
    const loaded = locate(player);
    if (loaded && recallTo(loaded, player)) {
      const profile = appearanceOf(loaded);
      speak(player, profile, profile.recalled);
    } else reply(player, "I couldn’t get back. Make room nearby or revisit my last spot: " + dim + " " + key(pos));
  } catch (error) {
    if (player.isValid) reply(player, "Recall couldn’t load your companion’s last location.");
    console.warn(`[Chibi Companions] Recall: ${error}`);
  } finally {
    recalls.delete(player.id);
    if (areas.hasTickingArea(area)) areas.removeTickingArea(area);
  }
}

function pauseWork(player) {
  player.setDynamicProperty(workOffKey, true);
  const task = tasks.get(player.id);
  if (task) {
    task.trigger = undefined;
    task.workLeft = 0;
    if (task.job?.kind === "work") {
      const pet = task.job.flight && locate(player);
      if (pet) abortFlight(pet, task.job.flight);
      task.job = undefined;
    }
  }
  workReply(player, "workPaused", "Automatic work paused.");
}

function collectBack(player, pet = locate(player)) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Come within five blocks of your companion to take supplies.");
  }
  const source = inv(pet);
  const destination = inv(player);
  if (!source || !destination) return;
  let quantity = 0;
  for (let slot = 0; slot < source.size; slot++) {
    const item = source.getItem(slot);
    if (!item) continue;
    const remaining = source.transferItem(slot, destination);
    quantity += item.amount - (remaining?.amount ?? 0);
  }
  const task = tasks.get(player.id);
  if (task) task.nextSort = now() + 100;
  const profile = appearanceOf(pet);
  if (quantity) speak(player, profile, `${profile.handedOver} (${quantity} items transferred)`);
  else if (source.emptySlotsCount === source.size) speak(player, profile, profile.empty);
  else reply(player, "Make room in your inventory.");
}

async function changeAppearance(player, companionId) {
  await system.waitTicks(1);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (pet?.id !== companionId) return reply(player, "Call your companion before changing its appearance.");
  const current = pet.getProperty(appearanceKey) ?? 0;
  const form = new ActionFormData().title("Change Appearance")
    .body("Choose a character for your companion.");
  for (const [index, { icon, name, trait }] of appearances.entries()) {
    const label = index === current ? `${name} (Current)` : name;
    form.button(`${label}\n${trait}`, `textures/ui/companions/${icon}`);
  }
  form.button("Cancel");
  const result = await form.show(player);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  if (result.cancelationReason === FormCancelationReason.UserBusy) {
    return reply(player, "Close your chat or inventory, then reopen the companion menu.");
  }
  if (result.canceled || result.selection === undefined) return;
  const choice = appearances[result.selection];
  if (!choice || result.selection === current) return;
  const ownedPet = locate(player);
  if (ownedPet?.id !== companionId) return reply(player, "Call your companion before changing its appearance.");
  ownedPet.setProperty(appearanceKey, result.selection);
  speak(player, choice, choice.greeting);
}

async function showMenu(player) {
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  if (openMenus.has(player.id) || (menuRequests.get(player.id) ?? -10) + 8 > now()) return;
  menuRequests.set(player.id, now());
  openMenus.add(player.id);
  try {
    const pet = locate(player);
    const bag = inv(pet);
    const sortEnabled = !player.getDynamicProperty(sortOffKey);
    const workPaused = !!player.getDynamicProperty(workOffKey);
    const appearance = appearanceOf(pet);
    const form = new ActionFormData().title(pet ? appearance.name : "Chibi Companions").body([
      ...(pet ? [appearance.greeting, ""] : []),
      bag ? `Backpack  ${bag.size - bag.emptySlotsCount} / ${bag.size} slots` : "Your companion is away or hasn’t joined you yet.",
      `Mining, chopping and harvesting  ${workPaused ? "Paused" : "Automatic"}`,
      `Chest sorting  ${sortEnabled ? "On" : "Paused"}`
    ].join("\n"));
    const actions = [];
    function button(label, action) {
      form.button(label);
      actions.push(action);
    }
    button("Call companion", summonOrRecall);
    if (pet) {
      const companionId = pet.id;
      button("Change Appearance", () => changeAppearance(player, companionId));
      button("Take supplies", collectBack);
    }
    if (workPaused) button("Resume automatic work", resumeWork);
    else button("Pause automatic work", pauseWork);
    button(sortEnabled ? "Pause chest sorting" : "Resume chest sorting", toggleSorting);
    const result = await form.show(player);
    if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
    if (result.cancelationReason === FormCancelationReason.UserBusy) {
      return reply(player, "Close your chat or inventory, then use the whistle again.");
    }
    if (!result.canceled && result.selection !== undefined) await actions[result.selection]?.(player);
  } finally {
    openMenus.delete(player.id);
  }
}

function requestMenu(player) {
  system.run(() => showMenu(player).catch(error => guarded("menu", () => { throw error; })));
}

function resumeWork(player) {
  player.setDynamicProperty(workOffKey, undefined);
  workReply(player, "workResumed", "Automatic work resumed.");
}

function toggleSorting(player) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const stopped = !player.getDynamicProperty(sortOffKey);
  player.setDynamicProperty(sortOffKey, stopped ? true : undefined);
  const task = tasks.get(player.id);
  if (task) {
    if (stopped && task.job?.kind === "sort") task.job = undefined;
    task.nextSort = now() + 20;
  }
  workReply(player, stopped ? "sortingPaused" : "sortingResumed", stopped ? "Chest sorting paused." : "Chest sorting resumed.");
}

/** @type {Record<string, [string, (player: import("@minecraft/server").Player) => void | Promise<void>]>} */
const commands = {
  whistle: ["Add a Snowdrop Whistle to your inventory.", giveWhistle],
  sorting: ["Pause or resume your companion’s chest sorting.", toggleSorting],
  call: ["Call your companion or summon Mizuki for the first time.", summonOrRecall],
  work: ["Resume automatic mining, chopping and harvesting.", resumeWork],
  stop: ["Pause automatic mining, chopping and harvesting.", pauseWork],
  mining: ["Resume automatic work (alias for /chibi:work).", resumeWork],
  take: ["Take supplies from your companion.", collectBack],
  status: ["Check your companion’s backpack and work status.", player => {
    const pet = locate(player);
    const backpack = inv(pet);
    const task = tasks.get(player.id);
    const work = player.getDynamicProperty(workOffKey) ? "paused" : "automatic";
    reply(player, `Backpack ${backpack ? `${backpack.size - backpack.emptySlotsCount}/${backpack.size} slots` : "away or unbound"}. Work: ${work}. ${task?.note ?? "Ready."}`);
  }],
  help: ["Show companion commands.", player => reply(player, "/chibi:whistle • /chibi:call • /chibi:work • /chibi:stop • /chibi:take • /chibi:sorting • /chibi:mining • /chibi:status")]
};

function giveWhistle(player) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const bag = inv(player);
  if (!bag) return;
  const whistle = new ItemStack("cc:snowdrop_whistle");
  if (bag.contains(whistle)) return reply(player, "A Snowdrop Whistle is already in your inventory.");
  if (bag.addItem(whistle)) return reply(player, "Make one free inventory slot for your whistle.");
  reply(player, "Snowdrop Whistle ready. Hold it and use it to open the companion menu.");
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry, itemComponentRegistry }) => {
  itemComponentRegistry.registerCustomComponent("cc:whistle_menu", {
    onUse({ source }) {
      if (source instanceof Player) requestMenu(source);
    },
    onUseOn({ source }) {
      if (source instanceof Player) requestMenu(source);
    }
  });
  for (const [name, [description, action]] of Object.entries(commands)) {
    customCommandRegistry.registerCommand({
      name: `chibi:${name}`, description, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false
    }, origin => {
      const player = origin.sourceEntity;
      if (!(player instanceof Player)) return { status: CustomCommandStatus.Failure, message: "Run this as a player." };
      system.run(() => guarded(name, () => {
        if (!player.isValid) return;
        const result = action(player);
        if (result) result.catch(error => guarded(name, () => { throw error; }));
      }));
      return { status: CustomCommandStatus.Success };
    });
  }
});

world.afterEvents.worldLoad.subscribe(() => guarded("world load", () => {
  world.tickingAreaManager.removeAllTickingAreas();
  for (const id of ["overworld", "nether", "the_end"]) {
    for (const pet of world.getDimension(id).getEntities({ type: TYPE })) recoverLegacy(pet);
  }
  console.warn("[Chibi Companions] Mizuki loaded (stable API 2.10.0).");
}));
world.afterEvents.entityLoad.subscribe(({ entity }) => {
  if (entity.typeId === TYPE) guarded("pet load", () => recoverLegacy(entity));
});
world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  if (deadEntity.typeId !== TYPE) return;
  guarded("pet death", () => {
    const id = deadEntity.getDynamicProperty(ownerKey);
    if (!id || world.getDynamicProperty(linkKey(id)) !== deadEntity.id) return;
    world.setDynamicProperty(linkKey(id), undefined);
    world.setDynamicProperty(`${linkKey(id)}:spot`, undefined);
    const player = world.getAllPlayers().find(entry => entry.id === id);
    if (player) player.setDynamicProperty(packKey, undefined);
    else world.setDynamicProperty(`cc:dead:${id}`, deadEntity.id);
    tasks.delete(id);
  });
});
world.afterEvents.playerSpawn.subscribe(({ player }) => guarded("player spawn", () => {
  const dead = world.getDynamicProperty(`cc:dead:${player.id}`);
  if (dead && dead === player.getDynamicProperty(packKey)) player.setDynamicProperty(packKey, undefined);
  if (dead) world.setDynamicProperty(`cc:dead:${player.id}`, undefined);
  const pet = locate(player);
  if (pet) recoverLegacy(pet);
}));

world.beforeEvents.playerInteractWithEntity.subscribe(event => {
  const { player, target, itemStack } = event;
  if (target.typeId !== TYPE) return;
  guarded("interaction", () => {
    const owner = target.getDynamicProperty(ownerKey) ?? tame(target)?.tamedToPlayerId;
    if (owner && owner !== player.id) {
      event.cancel = true;
      return;
    }
    if (player.isSneaking && owner === player.id) {
      event.cancel = true;
      system.run(() => guarded("take", () => {
        if (player.isValid && target.isValid && locate(player)?.id === target.id) collectBack(player, target);
      }));
    } else if (owner === player.id && (!itemStack || itemStack.typeId === "cc:snowdrop_whistle")) {
      event.cancel = true;
      if (locate(player)?.id === target.id) requestMenu(player);
    } else if (itemStack?.typeId === "minecraft:dried_kelp" && !owner) {
      event.cancel = true;
      system.run(() => guarded("befriend", () => {
        if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator || !target.isValid || tame(target)?.isTamed) return;
        if (world.getDynamicProperty(linkKey(player.id)) || player.getDynamicProperty(packKey)) {
          return reply(player, "You already have a companion.");
        }
        if (tame(target)?.tame(player)) {
          register(player, target);
          reply(player, "Little Snowdrop is your companion now.");
        }
      }));
    }
  });
});

function nearby(dim, pos, radius, vertical, types) {
  const base = cell(pos);
  const volume = new BlockVolume(offset(base, -radius, -vertical, -radius), offset(base, radius, vertical, radius));
  return Array.from(dim.getBlocks(volume, { includeTypes: types }, true).getBlockLocationIterator());
}

function itemsAt(dim, where, radius) {
  return dim.getEntities({ type: "minecraft:item", location: where, maxDistance: radius });
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => guarded("track placement", () => trackPlacement(block)));
function recordWork(player, event, tick) {
  if (player.getDynamicProperty(workOffKey)) return;
  const trigger = makeTrigger(event, tick);
  if (!trigger?.canWork) return;
  const task = getTask(player.id);
  task.trigger = trigger;
  task.workLeft = WORK_BATCH_SIZE;
  task.failedTargets = new Set();
  task.note = "Looking for nearby matching blocks.";
}

world.afterEvents.playerBreakBlock.subscribe(event => guarded("break event", () => {
  const { player, block } = event;
  forgetPlacement(block.dimension, block.location);
  if (locate(player)?.dimension.id === block.dimension.id) recordWork(player, event, now());
}));

// Reserve deliberate player drops for their owner, even when companions overlap.
world.afterEvents.entityItemDrop.subscribe(({ entity, items }) => guarded("manual drops", () => {
  if (entity.typeId !== "minecraft:player") return;
  for (const item of items) claims.set(item.id, { owner: entity.id, until: now() + 600 });
}));

function canPickUp(player, item, tick) {
  const claim = claims.get(item.id);
  if (claim?.until > tick) return claim.owner === player.id;
  const distance = distance2(player.location, item.location);
  return !item.dimension.getPlayers({ location: item.location, maxDistance: 8 })
    .some(other => other.id !== player.id && distance2(other.location, item.location) <= distance);
}

function getTask(id) {
  let task = tasks.get(id);
  if (!task) {
    task = { lastMove: now(), nextWork: 0, nextSort: now() + 60, recallAt: 0, pausedAI: false, workLeft: 0 };
    tasks.set(id, task);
  }
  return task;
}

function makeWork(player, pet, task, tick) {
  const { trigger } = task;
  if (task.workLeft <= 0 || !trigger?.canWork || tick < task.nextWork || tick - trigger.tick > ACTIVITY_TICKS) return;
  if (player.getDynamicProperty(workOffKey) || !withinWorkRange(trigger, pet.dimension, cell(player.location))) return;
  if (!heldTool(player, trigger)) {
    task.note = "Keep the same kind of pickaxe or axe equipped.";
    return;
  }
  task.nextWork = tick + 24;
  const types = trigger.type.includes("redstone_ore")
    ? [trigger.type.replace("minecraft:lit_", "minecraft:"), trigger.type.replace("minecraft:lit_", "minecraft:").replace("minecraft:", "minecraft:lit_")]
    : [trigger.type];
  const positions = nearby(pet.dimension, trigger.pos, 4, 3, types);
  const blocks = reachableCandidates(pet.dimension, trigger, pet.location, positions);
  if (!blocks.length) {
    task.note = "No matching block with a safe exposed side.";
    return;
  }
  const tree = routeTree(pet.dimension, pet.location);
  for (const block of blocks) {
    if (task.failedTargets?.has(key(block.location)) || distance2(center(block.location), player.location) > 64) continue;
    const path = routeTo(pet.dimension, tree, block.location, block.location);
    if (path?.some(step => step.x === block.x && step.z === block.z && step.y === block.y + 1)) continue;
    if (path) return { kind: "work", location: block.location, trigger, path, deadline: tick + 110 };
  }
  task.note = "I couldn’t reach the matching block.";
}

function makePickup(player, pet, inventory, tick) {
  const dim = pet.dimension;
  const items = itemsAt(dim, pet.location, 6).filter(item =>
    distance2(player.location, item.location) <= 64 && canPickUp(player, item, tick)
  ).sort((a, b) => distance2(pet.location, a.location) - distance2(pet.location, b.location));
  if (!items.length) return;
  const slots = snapshot(inventory);
  let tree;
  for (const item of items) {
    const stack = item.getComponent("minecraft:item")?.itemStack;
    if (!stack || !planInsert(slots, [stack])) continue;
    const aim = offset(item.location, 0, 0.13, 0);
    const here = offset(pet.location, 0, 0.67, 0);
    const at = cell(item.location);
    const path = clearSight(dim, here, aim, 1.75) ? [] : routeTo(dim, tree ??= routeTree(dim, pet.location), at, undefined, aim);
    if (path) return { kind: "pickup", item, location: at, path, deadline: tick + 85 };
  }
}

function chestAt(dim, location) {
  const block = getBlock(dim, location);
  if (block?.typeId !== "minecraft:chest" || !getBlock(dim, offset(location, 0, 1, 0))?.isAir) return;
  return block.getComponent("minecraft:inventory")?.container;
}

function makeSort(pet, inventory, tick) {
  const dim = pet.dimension;
  const all = snapshot(inventory);
  const positions = nearby(dim, pet.location, 7, 3, ["minecraft:chest"])
    .filter(pos => distance2(center(pos), pet.location) <= 49);
  const chests = positions.map(pos => {
    const chest = chestAt(dim, pos);
    return chest && { pos, slots: snapshot(chest), distance: distance2(center(pos), pet.location) };
  }).filter(Boolean);
  if (!chests.length) return;
  const tree = routeTree(dim, pet.location);
  for (let slot = 0; slot < all.length; slot++) {
    const item = all[slot];
    if (!item) continue;
    const candidates = chests.map(chest => ({ ...chest, rank: chestRank(chest.slots, item) }))
      .filter(chest => Number.isFinite(chest.rank))
      .sort((a, b) => a.rank - b.rank || a.distance - b.distance);
    for (const chest of candidates) {
      const path = routeTo(dim, tree, chest.pos, chest.pos);
      if (path) return { kind: "sort", location: chest.pos, slot, path, deadline: tick + 110 };
    }
  }
}

// Move up the face before moving over the lip. A collision check on each
// position prevents the scramble from going through new blocks or a ceiling.
function climbStep(pet, job, tick, avoid) {
  const { from, step, start, facing, at } = job.climb;
  if (!canClimb(pet.dimension, from, step, avoid)) return "blocked";
  const goal = point(step);
  const time = tick - at;
  let destination;
  if (time < 5) {
    const reach = Math.min(0.12, time * 0.03);
    destination = offset(start, facing.x * reach, 0.1 + reach, facing.z * reach);
  } else if (time < 16) {
    // A small dip gives his first pull a visible slip before he gets a grip.
    const progress = Math.max(0, (time - 6) / 10);
    const rise = time === 5 ? 0.19 : time === 6 ? 0.14 : 0.14 + 0.93 * progress;
    destination = offset(start, facing.x * 0.12, rise, facing.z * 0.12);
  } else {
    const pull = Math.min(1, (time - 16) / 8);
    const grip = offset(start, facing.x * 0.12, 0, facing.z * 0.12);
    destination = {
      x: grip.x + (goal.x - grip.x) * pull,
      y: goal.y + 0.04 + 0.035 * (1 - pull),
      z: grip.z + (goal.z - grip.z) * pull
    };
  }
  pet.clearVelocity();
  if (!pet.tryTeleport(destination, {
    checkForBlocks: true,
    facingLocation: offset(destination, facing.x, 0, facing.z)
  })) return "blocked";
  if (time < 24) return "climbing";
  job.path.shift();
  job.climb = undefined;
  return job.path.length ? "walking" : "arrived";
}

function walkTask(pet, job, tick) {
  const avoid = job.kind === "work" ? job.location : undefined;
  if (job.flight) {
    if (!appearanceOf(pet).canFly) return "blocked";
    const outcome = advanceFlight(pet, job.flight, avoid);
    if (outcome !== "arrived") return outcome;
    job.flight = undefined;
    job.path.shift();
    return job.path.length ? "walking" : "arrived";
  }
  const step = job.path[0];
  if (!step) return "arrived";
  if (job.climb) return climbStep(pet, job, tick, avoid);
  const here = pet.location;
  const goal = point(step);
  const delta = { x: goal.x - here.x, y: goal.y - here.y, z: goal.z - here.z };
  const horizontal = Math.hypot(delta.x, delta.z);
  if (horizontal < 0.28 && Math.abs(delta.y) < 0.3) {
    job.path.shift();
    return job.path.length ? "walking" : "arrived";
  }
  if (!standable(pet.dimension, step, avoid) || horizontal > 1.8 || Math.abs(delta.y) > 1.4) return "blocked";
  if (delta.y > 0.6 && pet.isOnGround) {
    const from = cell(here);
    if (!canClimb(pet.dimension, from, step, avoid)) return "blocked";
    if (appearanceOf(pet).canFly) {
      job.flight = planFlight(pet.dimension, here, step, avoid);
      if (job.flight) return "flying";
      const takeoff = point(from);
      return distance2(here, takeoff) <= 0.075 ? "blocked" : steer(pet, here, takeoff);
    }
    const start = point(from);
    // Center in the lower tile before climbing so his shoulders stay outside the block.
    if (distance2(here, start) <= 0.075) {
      job.climb = { from, step, at: tick, start, facing: { x: step.x - from.x, z: step.z - from.z } };
      return climbStep(pet, job, tick, avoid);
    }
    return steer(pet, here, start);
  }
  return steer(pet, here, goal);
}

function steer(pet, here, goal) {
  const dx = goal.x - here.x;
  const dz = goal.z - here.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.06) return "walking";
  pet.lookAt({ x: goal.x, y: here.y, z: goal.z });
  const velocity = pet.getVelocity();
  const speed = Math.min(0.19, distance * 0.65);
  pet.applyImpulse({ x: dx / distance * speed - velocity.x * 0.72, y: 0, z: dz / distance * speed - velocity.z * 0.72 });
  return "walking";
}

function act(player, pet, task, inventory, tick) {
  const job = task.job;
  const dim = pet.dimension;
  if (tick >= job.deadline || !fullMember(player) || player.getGameMode() === GameMode.Spectator || distance2(player.location, pet.location) > 144) return false;
  if (job.kind === "work" && (player.getDynamicProperty(workOffKey) || !heldTool(player, job.trigger)
    || tick - job.trigger.tick > ACTIVITY_TICKS || !withinWorkRange(job.trigger, dim, cell(player.location)) || distance2(center(job.location), player.location) > 64
    || player.getGameMode() !== GameMode.Survival || !world.gameRules.doTileDrops)) return false;
  if (job.kind === "pickup" && (!job.item.isValid || !canPickUp(player, job.item, tick)
    || distance2(job.item.location, center(job.location)) > 3.2)) return false;

  const walking = walkTask(pet, job, tick);
  if (walking === "blocked") return false;
  if (walking === "flying") {
    setPose(pet, "fly");
    return true;
  }
  if (walking === "climbing") {
    setPose(pet, "climb");
    return true;
  }
  if (walking === "walking") {
    setPose(pet, inventory.emptySlotsCount < inventory.size ? "carry" : "idle");
    return true;
  }
  if (job.kind === "follow") return false;
  const aim = job.kind === "pickup" ? offset(job.item.location, 0, 0.13, 0) : center(job.location);
  if (!clearSight(dim, offset(pet.location, 0, 0.67, 0), aim)) return false;
  pet.clearVelocity();
  pet.lookAt(aim);
  if (!job.finish) {
    setPose(pet, job.kind === "work" ? job.trigger.kind : job.kind === "sort" ? "deposit" : "pickup");
    job.finish = tick + (job.kind === "work" ? ({ mine: 24, chop: 20, gather: 12 })[job.trigger.kind] : 10);
    return true;
  }
  if (tick < job.finish) return true;
  let success = false;
  if (job.kind === "work") {
    const block = getBlock(dim, job.location);
    if (eligible(dim, block, job.trigger)) {
      // Ensure no player (including another owner) is standing on the target.
      const occupied = dim.getPlayers({ location: center(job.location), maxDistance: 2.5 })
        .some(other => key(cell(offset(other.location, 0, -0.2, 0))) === key(job.location));
      const petFeet = key(cell(offset(pet.location, 0, -0.2, 0)));
      if (!occupied && petFeet !== key(job.location)) success = harvest(block, inventory, job.trigger, player);
      task.nextWork = tick + 14;
      if (success) {
        job.completed = true;
        if (task.trigger === job.trigger) task.workLeft--;
      }
      task.note = success ? "Gathered from a matching block." : "The target was unsafe or the backpack had no room.";
      if (success) dim.playSound(job.trigger.kind === "mine" ? "dig.stone" : job.trigger.kind === "chop" ? "dig.wood" : "dig.grass", aim, { volume: 0.55 });
    }
  } else if (job.kind === "pickup") {
    const stack = job.item.getComponent("minecraft:item")?.itemStack;
    const plan = stack && planInsert(snapshot(inventory), [stack]);
    if (plan) {
      commit(inventory, plan);
      try {
        job.item.remove();
      } catch (error) {
        restore(inventory, plan);
        throw error;
      }
      claims.delete(job.item.id);
      success = true;
      task.note = "Picked up a loose item.";
      dim.playSound("random.pop", pet.location, { volume: 0.35, pitch: 1.25 });
    }
  } else {
    const destination = chestAt(dim, job.location);
    success = !!destination && depositSlot(inventory, job.slot, destination) > 0;
    task.nextSort = tick + (success ? 36 : 100);
    if (success) dim.playSound("random.chestclosed", aim, { volume: 0.28, pitch: 1.15 });
  }
  if (success && (job.kind !== "work" || task.workLeft <= 0)) task.happyUntil = tick + 15;
  return false;
}

function update(player, pet, tick) {
  const task = getTask(player.id);
  const inventory = inv(pet);
  if (!inventory) return;
  if (tick % 20 === 0 || !task.position) {
    const previous = task.position;
    if (!previous || distance2(previous, pet.location) >= 1) {
      task.lastMove = tick;
      task.position = pet.location;
      remember(pet, player.id);
    }
  }
  const crossDim = pet.dimension.id !== player.dimension.id;
  const gap = crossDim ? Infinity : distance2(pet.location, player.location);
  if (tick >= task.recallAt && (crossDim || gap >= 24 ** 2 || (gap >= 9 ** 2 && tick - task.lastMove >= 110))) {
    task.recallAt = tick + 160;
    recallTo(pet, player);
    return;
  }
  if (crossDim || gap > 144 || player.getGameMode() === GameMode.Spectator) {
    if (task.job?.flight) abortFlight(pet, task.job.flight);
    task.job = undefined;
  }
  if (task.job) {
    if (act(player, pet, task, inventory, tick)) return;
    if (task.job.flight) abortFlight(pet, task.job.flight);
    if (task.job.kind === "work" && !task.job.completed && task.job.trigger === task.trigger) {
      task.failedTargets.add(key(task.job.location));
    }
    task.job = undefined;
  }
  if ((task.happyUntil ?? 0) > tick) return follow(pet, task, "happy");
  follow(pet, task);
  if (gap > 64 || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  if (tick % 8 !== 0) return;
  /** @type {ReturnType<typeof makeWork> | ReturnType<typeof makePickup> | ReturnType<typeof makeSort> | {kind: "follow", path: ReturnType<typeof ledgeRoute>, deadline: number, flight?: ReturnType<typeof planFlight>}} */
  let job = player.getGameMode() === GameMode.Survival ? makeWork(player, pet, task, tick) : undefined;
  if (!job) job = makePickup(player, pet, inventory, tick);
  if (!job && tick >= task.nextSort && inventory.emptySlotsCount < inventory.size && !player.getDynamicProperty(sortOffKey)) {
    task.nextSort = tick + 120;
    job = makeSort(pet, inventory, tick);
  }
  if (!job && gap > 1 && pet.isOnGround && tick >= (task.nextLedge ?? 0)) {
    if (appearanceOf(pet).canFly) {
      task.nextLedge = tick + 24;
      const flight = followFlight(pet.dimension, pet.location, player.location);
      if (flight) job = { kind: "follow", path: [flight.landing], flight, deadline: tick + 90 };
    } else if (player.location.y - pet.location.y >= 0.8) {
      task.nextLedge = tick + 24;
      const path = ledgeRoute(pet.dimension, pet.location, player.location);
      if (path) job = { kind: "follow", path, deadline: tick + 130 };
    }
  }
  if (job) {
    task.job = job;
    park(pet, task);
  }
}

system.runInterval(() => {
  const tick = now();
  for (const player of world.getAllPlayers()) {
    guarded("companion tick", () => {
      const pet = locate(player);
      if (pet) update(player, pet, tick);
    });
  }
  if (tick % 100 === 0) {
    for (const [id, claim] of claims) if (claim.until <= tick) claims.delete(id);
  }
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const flight = tasks.get(playerId)?.job?.flight;
  tasks.delete(playerId);
  menuRequests.delete(playerId);
  openMenus.delete(playerId);
  const id = world.getDynamicProperty(linkKey(playerId));
  if (typeof id !== "string") return;
  const pet = world.getEntity(id);
  if (!pet?.isValid) return;
  guarded("player left", () => {
    if (flight) abortFlight(pet, flight);
    remember(pet, playerId);
    pet.triggerEvent("cc:pause_follow");
    setPose(pet, "idle");
  });
});

world.afterEvents.playerDimensionChange.subscribe(({ player }) => {
  const pet = locate(player);
  if (pet) guarded("dimension follow", () => recallTo(pet, player));
});
