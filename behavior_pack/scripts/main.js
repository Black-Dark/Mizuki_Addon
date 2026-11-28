import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { BlockVolume, CommandPermissionLevel, CustomCommandStatus, EntityDamageCause, GameMode, ItemStack, Player, PlayerPermissionLevel, system, world } from "@minecraft/server";
import { appearanceKey, appearanceOf, appearances, hudThemes } from "./appearances.js";
import { abortFlight, advanceFlight, followFlight, planFlight } from "./flight.js";
import { recoverStack } from "./death-recovery.js";
import { canStrike, mobThreat } from "./defense.js";
import { bedTarget, guidePath, nearSpawn, spawnDirections } from "./guide-home.js";
import { chestRank, commit, depositSlot, planInsert, planRemove, restore, snapshot } from "./inventory.js";
import { canClimb, cell, center, clearSight, distance2, getBlock, key, ledgeRoute, offset, point, routeTo, routeTree, safeArrival, standable } from "./terrain.js";
import { eligible, forgetPlacement, harvest, heldTool, makeTrigger, reachableCandidates, trackPlacement, withinWorkRange } from "./resources.js";

const TYPE = "ochub:mizuki_todoroki";
const PACK_VERSION = "3.7.7";
const BACKPACK_CAPACITY = 36;
const ACTIVITY_TICKS = 320;
const WORK_BATCH_SIZE = 4;
const openMenus = new Map();
const menuRequests = new Map();
const tasks = new Map();
const claims = new Map();
const deathDrops = new Map();
const recentDrops = new Map();
const recalls = new Set();
const lastWarnings = new Map();

const HOUSE_ITEM_START = BACKPACK_CAPACITY;
const HOUSE_ITEM_END = HOUSE_ITEM_START + 27;
const HOUSE_MAX_VOLUME = 4096;
const HOUSE_BLOCKS = new Set((
  "minecraft:crafting_table minecraft:enchanting_table minecraft:loom minecraft:stonecutter " +
  "minecraft:smithing_table minecraft:cartography_table minecraft:fletching_table minecraft:grindstone " +
  "minecraft:anvil minecraft:chipped_anvil minecraft:damaged_anvil " +
  "minecraft:bell minecraft:furnace minecraft:blast_furnace " +
  "minecraft:smoker minecraft:brewing_stand minecraft:chest minecraft:barrel"
).split(" "));
const CRAFTING_RECIPES = [
  { name: "Oak Planks", output: "minecraft:oak_planks", count: 4, ingredients: [["minecraft:oak_log", 1]] },
  { name: "Sticks", output: "minecraft:stick", count: 4, ingredients: [["minecraft:oak_planks", 2]] },
  { name: "Moving Box", output: "cc:moving_box", count: 1, ingredients: [["minecraft:paper", 6], ["minecraft:oak_planks", 2]] },
  { name: "Packing Tape", output: "cc:packing_tape", count: 2, ingredients: [["minecraft:slime_ball", 1], ["minecraft:paper", 1]] },
  { name: "Companion Treats", output: "cc:companion_treat", count: 3, ingredients: [["minecraft:dried_kelp", 1], ["minecraft:wheat", 1], ["minecraft:sweet_berries", 1]] },
  { name: "Companion Toy", output: "cc:companion_toy", count: 1, ingredients: [["minecraft:string", 4], ["minecraft:white_wool", 1]] }
];

const stateKey = "cc:pose";
const ownerKey = "cc:owner";
const packKey = "cc:entity";
const sortOffKey = "cc:sort_off";
const workOffKey = "cc:work_off";
const recoveredKey = "cc:recovered_gear";
const stayKey = "cc:stay";
const hudKey = "cc:hud_mode";
const hudModes = ["Off", "Companion", "Navigation", "Both"];
const defaultHudMode = 1;
const compassPoints = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
const storageLayoutKey = "cc:storage_layout";
const legacyCargoKey = "cc:legacy_cargo";
const inv = entity => entity?.getComponent("minecraft:inventory")?.container;
const houseKey = player => `cc:move-house:${player.id}`;
function inventorySection(container, start, end) {
  if (!container) return;
  const size = Math.max(0, Math.min(end, container.size) - start);
  return {
    size,
    getItem: slot => container.getItem(start + slot),
    setItem: (slot, item) => container.setItem(start + slot, item),
    get emptySlotsCount() {
      let count = 0;
      for (let slot = start; slot < start + size; slot++) if (!container.getItem(slot)) count++;
      return count;
    }
  };
}

const workInventory = container => inventorySection(container, 0, BACKPACK_CAPACITY);
const movingInventory = container => inventorySection(container, HOUSE_ITEM_START, HOUSE_ITEM_END);

function prepareStorage(pet) {
  if (pet.getDynamicProperty(storageLayoutKey)) return;
  const storage = inv(pet);
  if (!storage) return;
  // 3.4 stored moving cargo in slots 9–35. 3.6.2 used the same slots for
  // the backpack. Keep those items in place and protect them until retrieved.
  const previous = inventorySection(storage, 9, BACKPACK_CAPACITY);
  if (previous.emptySlotsCount < previous.size) pet.setDynamicProperty(legacyCargoKey, true);
  pet.setDynamicProperty(storageLayoutKey, true);
}

function hasContents(block) {
  const container = block.getComponent("minecraft:inventory")?.container;
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) if (container.getItem(slot)) return true;
  return false;
}
const tame = entity => entity.getComponent("minecraft:tameable");
const reply = (player, message) => player.sendMessage(`§b[Chibi Companions]§r ${message}`);
const speak = (player, profile, line) => player.sendMessage(`${hudTheme(profile).color}[${profile.voice}]§r ${line}`);
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
  const backpack = workInventory(inv(pet));
  setPose(pet, mood ?? (backpack && backpack.emptySlotsCount < backpack.size ? "carry" : "idle"));
}

function park(pet, task) {
  if (!task.pausedAI) {
    pet.triggerEvent("cc:pause_follow");
    task.pausedAI = true;
  }
}

function register(player, pet) {
  prepareStorage(pet);
  const task = getTask(player.id);
  if (task.attachedPetId === pet.id) return;
  pet.setDynamicProperty(ownerKey, player.id);
  player.setDynamicProperty(packKey, pet.id);
  remember(pet, player.id);
  if (pet.getDynamicProperty(stayKey)) {
    task.pausedAI = false;
    park(pet, task);
    setPose(pet, "idle");
  } else {
    task.pausedAI = true;
    follow(pet, task);
  }
  task.attachedPetId = pet.id;
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
  }
  else {
    pet.setDynamicProperty(ownerKey, ownerId);
    remember(pet, ownerId);
    pet.triggerEvent("cc:pause_follow");
    setPose(pet, "idle");
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
  pet.setDynamicProperty(stayKey, undefined);
  pet.clearVelocity();
  pet.extinguishFire();
  remember(pet, player.id);
  const task = getTask(player.id);
  task.defense = undefined;
  task.job = undefined;
  if (task.guide) {
    task.guide.route = undefined;
    task.guide.nextPlan = now();
  }
  task.trigger = undefined;
  task.lastMove = now();
  task.recallAt = now() + 200;
  task.pausedAI = true;
  follow(pet, task, "idle");
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

function collectBack(player, pet = locate(player), moving = false) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Come within five blocks of your companion to take supplies.");
  }
  const source = inv(pet);
  const destination = inv(player);
  if (!source || !destination) return;
  const section = moving ? movingInventory(source) : workInventory(source);
  const start = moving ? HOUSE_ITEM_START : 0;
  let quantity = 0;
  for (let slot = 0; slot < section.size; slot++) {
    const item = section.getItem(slot);
    if (!item) continue;
    const remaining = source.transferItem(start + slot, destination);
    quantity += item.amount - (remaining?.amount ?? 0);
  }
  const task = tasks.get(player.id);
  if (task) task.nextSort = now() + 100;
  const empty = section.emptySlotsCount === section.size;
  if (empty && !moving) {
    pet.setDynamicProperty(recoveredKey, undefined);
    pet.setDynamicProperty(legacyCargoKey, undefined);
  }
  const profile = appearanceOf(pet);
  if (quantity) speak(player, profile, `${profile.handedOver} (${quantity} items transferred)`);
  else if (empty && !moving) speak(player, profile, profile.empty);
  else if (empty) reply(player, "The moving inventory is empty.");
  else reply(player, "Make room in your inventory.");
}

function markHouseCorner(player) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const position = cell(player.location);
  const raw = player.getDynamicProperty(houseKey(player));
  if (typeof raw !== "string") {
    player.setDynamicProperty(houseKey(player), JSON.stringify({ dimension: player.dimension.id, first: position }));
    return reply(player, "First house corner marked. Stand at the opposite upper corner and run /chibi:movehouse again.");
  }
  let selection;
  try { selection = JSON.parse(raw); } catch { selection = undefined; }
  if (!selection?.first || selection.dimension !== player.dimension.id) {
    player.setDynamicProperty(houseKey(player), undefined);
    return reply(player, "House selection reset. Mark the first corner again in the same dimension.");
  }
  const first = selection.first;
  const volume = (Math.abs(first.x - position.x) + 1) * (Math.abs(first.y - position.y) + 1) * (Math.abs(first.z - position.z) + 1);
  if (volume > HOUSE_MAX_VOLUME) return reply(player, "That house selection is too large. Keep it within 4,096 blocks and mark the second corner again.");
  player.setDynamicProperty(houseKey(player), JSON.stringify({
    dimension: player.dimension.id,
    min: { x: Math.min(first.x, position.x), y: Math.min(first.y, position.y), z: Math.min(first.z, position.z) },
    max: { x: Math.max(first.x, position.x), y: Math.max(first.y, position.y), z: Math.max(first.z, position.z) }
  }));
  reply(player, "House area marked. Run /chibi:packhouse to have your companion pack supported furniture and appliances.");
}

function packHouse(player) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Bring your companion within five blocks before packing the house.");
  }
  const raw = player.getDynamicProperty(houseKey(player));
  if (typeof raw !== "string") return reply(player, "Mark two opposite house corners first with /chibi:movehouse.");
  let area;
  try { area = JSON.parse(raw); } catch { area = undefined; }
  if (!area?.min || !area?.max || area.dimension !== player.dimension.id) return reply(player, "Mark the house area again in this dimension.");
  const here = player.location;
  const nearest = Object.fromEntries(["x", "y", "z"].map(axis => [axis, Math.max(area.min[axis], Math.min(area.max[axis] + 1, here[axis]))]));
  if (distance2(here, nearest) > 64) return reply(player, "Return to the marked house before packing it.");
  const dimension = player.dimension;
  const blocks = [];
  const items = [];
  try {
    for (let x = area.min.x; x <= area.max.x; x++) for (let y = area.min.y; y <= area.max.y; y++) for (let z = area.min.z; z <= area.max.z; z++) {
      const block = dimension.getBlock({ x, y, z });
      if (!block || !HOUSE_BLOCKS.has(block.typeId) || hasContents(block)) continue;
      const stack = block.getItemStack(1, true);
      if (!stack) continue;
      blocks.push({ location: { x, y, z }, permutation: block.permutation });
      items.push(stack);
    }
  } catch (error) {
    console.warn(`[Chibi Companions] House scan: ${error}`);
    return reply(player, "I couldn’t safely scan every block in that area. Keep the whole house loaded and try again.");
  }
  if (!blocks.length) return reply(player, "I found no supported, empty furniture or appliance blocks in the marked area.");
  const playerBag = inv(player);
  if (!playerBag) return reply(player, "Your inventory is unavailable right now.");
  const crateCount = Math.ceil(blocks.length / 9);
  const supplies = snapshot(playerBag);
  const cratePlan = planRemove(supplies, "cc:moving_box", crateCount);
  if (!cratePlan) return reply(player, `Bring ${crateCount} Moving Box${crateCount === 1 ? "" : "es"} to pack these items (one box per nine blocks).`);
  for (const change of cratePlan) supplies[change.slot] = change.after;
  const tapePlan = planRemove(supplies, "cc:packing_tape", crateCount);
  if (!tapePlan) return reply(player, `Bring ${crateCount} rolls of Packing Tape (one per Moving Box).`);
  const supplyPlan = [...cratePlan, ...tapePlan];
  const movingBag = movingInventory(inv(pet));
  if (!movingBag?.size) return reply(player, "This companion has an older inventory layout. Take supplies to retrieve any cargo already in their backpack.");
  const plan = planInsert(snapshot(movingBag), items);
  if (!plan) return reply(player, "The moving inventory is full. Take moving cargo or pack a smaller area first.");

  const removed = [];
  let packed = false;
  try {
    for (const entry of blocks) {
      const block = dimension.getBlock(entry.location);
      if (!block || !HOUSE_BLOCKS.has(block.typeId) || hasContents(block)) throw new Error("A selected block changed during packing.");
      block.setType("minecraft:air");
      removed.push(entry);
    }
    commit(movingBag, plan);
    packed = true;
    commit(playerBag, supplyPlan);
  } catch (error) {
    try { if (packed) restore(movingBag, plan); } catch (restoreError) { console.warn(`[Chibi Companions] Moving inventory rollback: ${restoreError}`); }
    for (const entry of removed.reverse()) {
      try { dimension.getBlock(entry.location)?.setPermutation(entry.permutation); }
      catch (restoreError) { console.warn(`[Chibi Companions] House rollback: ${restoreError}`); }
    }
    console.warn(`[Chibi Companions] House pack rolled back: ${error}`);
    return reply(player, "Packing stopped, and I restored the selected blocks. Please try again.");
  }
  player.setDynamicProperty(houseKey(player), undefined);
  reply(player, `Your companion packed ${blocks.length} household items into the Moving Inventory, using ${crateCount} Moving Box${crateCount === 1 ? "" : "es"} and ${crateCount} roll${crateCount === 1 ? "" : "s"} of Packing Tape.`);
}

function planCosts(slots, ingredients) {
  const next = slots.slice();
  const changes = [];
  for (const [typeId, amount] of ingredients) {
    const plan = planRemove(next, typeId, amount);
    if (!plan) return undefined;
    for (const change of plan) next[change.slot] = change.after;
    changes.push(...plan);
  }
  return { next, changes };
}

function nearbyCraftingTable(pet) {
  return nearby(pet.dimension, pet.location, 4, 2, ["minecraft:crafting_table"])
    .some(position => distance2(center(position), pet.location) <= 16);
}

function craftAtTable(player, recipe) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Bring your companion within five blocks before asking them to craft.");
  }
  if (!nearbyCraftingTable(pet)) return reply(player, "Place a crafting table within four blocks of your companion.");
  const bag = inv(player);
  if (!bag) return reply(player, "Your inventory is unavailable right now.");
  const before = snapshot(bag);
  const costs = planCosts(before, recipe.ingredients);
  if (!costs) return reply(player, `You need the listed ingredients for ${recipe.name}.`);
  const result = new ItemStack(recipe.output, recipe.count);
  const outputPlan = planInsert(costs.next, [result]);
  if (!outputPlan) return reply(player, "Make room in your inventory for the crafted item first.");
  const payment = new Map(costs.changes.map(change => [change.slot, change]));
  for (const { slot, after } of outputPlan) payment.set(slot, { slot, before: before[slot], after });
  try {
    commit(bag, payment.values());
  } catch (error) {
    console.warn(`[Chibi Companions] Crafting ${recipe.name}: ${error}`);
    return reply(player, "The craft could not finish, so I restored your ingredients.");
  }
  setPose(pet, "gather");
  pet.dimension.playSound("random.pop", pet.location, { volume: 0.5, pitch: 1.15 });
  reply(player, `${appearanceOf(pet).name} crafted ${recipe.count} ${recipe.name}.`);
}

async function openCraftMenu(player) {
  await system.waitTicks(1);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Bring your companion within five blocks to open their crafting menu.");
  }
  if (!nearbyCraftingTable(pet)) return reply(player, "Place a crafting table within four blocks of your companion.");
  const form = new ActionFormData().title("Companion Crafting").body("Choose a supported recipe. Your companion will use the nearby crafting table and your inventory.");
  for (const recipe of CRAFTING_RECIPES) {
    const ingredients = recipe.ingredients.map(([id, count]) => `${count} ${id.split(":")[1].replaceAll("_", " ")}`);
    form.button(`${recipe.count} ${recipe.name}\n${ingredients.join(", ")}`);
  }
  const result = await form.show(player);
  if (!player.isValid || result.canceled || result.selection === undefined) return;
  const selected = CRAFTING_RECIPES[result.selection];
  if (selected) craftAtTable(player, selected);
}

function cabinBlueprint(base) {
  const plan = [];
  const add = (type, x, y, z) => plan.push({ type, location: { x: base.x + x, y: base.y + y, z: base.z + z } });
  for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) add("minecraft:oak_planks", x, 0, z);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) {
    if (x !== 1 && x !== 5 && z !== 1 && z !== 5) continue;
    const doorway = z === 1 && x === 3 && y <= 2;
    const window = y === 2 && ((z === 1 && (x === 2 || x === 4)) || (z === 5 && x === 3) || (x === 1 && z === 3));
    if (doorway) continue;
    add(window ? "minecraft:glass_pane" : "minecraft:oak_planks", x, y, z);
  }
  for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) add("minecraft:oak_planks", x, 4, z);
  return { plan, ingredients: [["minecraft:oak_planks", 92], ["minecraft:glass_pane", 4]], width: 5, height: 5, name: "Oak Starter Cabin" };
}

function watchPostBlueprint(base) {
  const plan = [];
  const add = (type, x, y, z) => plan.push({ type, location: { x: base.x + x, y: base.y + y, z: base.z + z } });
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) add("minecraft:cobblestone", x, 0, z);
  for (let y = 1; y <= 2; y++) for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) {
    if (x !== 1 && x !== 3 && z !== 1 && z !== 3) continue;
    if (z === 1 && x === 2) continue;
    add("minecraft:cobblestone", x, y, z);
  }
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) add("minecraft:cobblestone", x, 3, z);
  return { plan, ingredients: [["minecraft:cobblestone", 32]], width: 3, height: 4, name: "Stone Watch Post" };
}

function buildStructure(player, blueprintFactory) {
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Bring your companion within five blocks before asking them to build.");
  }
  const standing = cell(player.location);
  const base = { x: standing.x + 1, y: standing.y, z: standing.z + 1 };
  const blueprint = blueprintFactory(base);
  const bag = inv(player);
  if (!bag) return reply(player, "Your inventory is unavailable right now.");
  const costs = planCosts(snapshot(bag), blueprint.ingredients);
  if (!costs) return reply(player, `Gather the materials for the ${blueprint.name} first.`);
  const dimension = player.dimension;
  const oldBlocks = [];
  try {
    const middle = { x: base.x + 1 + blueprint.width / 2, y: base.y + blueprint.height / 2, z: base.z + 1 + blueprint.width / 2 };
    const occupied = dimension.getEntities({ location: middle, maxDistance: 5 }).some(entity =>
      entity.typeId !== "minecraft:item"
      && entity.location.x >= base.x + 1 && entity.location.x < base.x + 1 + blueprint.width
      && entity.location.z >= base.z + 1 && entity.location.z < base.z + 1 + blueprint.width
      && entity.location.y >= base.y && entity.location.y < base.y + blueprint.height
    );
    if (occupied) return reply(player, "Move everyone and nearby mobs clear of the build site first.");
    for (const entry of blueprint.plan) {
      const block = dimension.getBlock(entry.location);
      if (!block?.isAir) return reply(player, "The build site is blocked. Move to a clear, level area and try again.");
      if (entry.location.y === base.y) {
        const ground = dimension.getBlock({ x: entry.location.x, y: base.y - 1, z: entry.location.z });
        if (!ground || ground.isAir || ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"].includes(ground.typeId)) {
          return reply(player, "Choose a level site with solid ground under the whole build.");
        }
      }
    }
    for (const entry of blueprint.plan) {
      const block = dimension.getBlock(entry.location);
      oldBlocks.push({ location: entry.location, permutation: block.permutation });
      block.setType(entry.type);
    }
    commit(bag, costs.changes);
  } catch (error) {
    for (const old of oldBlocks.reverse()) {
      try { dimension.getBlock(old.location)?.setPermutation(old.permutation); }
      catch (restoreError) { console.warn(`[Chibi Companions] Build rollback: ${restoreError}`); }
    }
    console.warn(`[Chibi Companions] ${blueprint.name}: ${error}`);
    return reply(player, "The build stopped. I restored the site and materials; try a clear, level area.");
  }
  setPose(pet, "happy");
  const task = getTask(player.id);
  task.happyUntil = now() + 40;
  reply(player, `${appearanceOf(pet).name} finished the ${blueprint.name}.`);
}

async function openBuildMenu(player) {
  await system.waitTicks(1);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Bring your companion within five blocks before asking them to build.");
  }
  const site = cell(player.location);
  const dimensionId = player.dimension.id;
  const form = new ActionFormData().title("Companion Builds")
    .body(`The structure goes southeast of ${key(site)}. Keep the site clear and level, and stand here while choosing.`)
    .button("Oak Starter Cabin\n92 oak planks, 4 glass panes")
    .button("Stone Watch Post\n32 cobblestone");
  const result = await form.show(player);
  if (!player.isValid || result.canceled || result.selection === undefined) return;
  if (locate(player)?.id !== pet.id || player.dimension.id !== dimensionId || key(cell(player.location)) !== key(site)) {
    return reply(player, "The build site changed. Open the build menu from where you want to start.");
  }
  if (result.selection === 0) buildStructure(player, cabinBlueprint);
  if (result.selection === 1) buildStructure(player, watchPostBlueprint);
}

async function openWorkshopMenu(player) {
  await system.waitTicks(1);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (!pet) return reply(player, "Call your companion first.");
  const form = new ActionFormData().title("Moving and crafting")
    .body("Mark two opposite corners to pack supported, empty furniture. Bring one Moving Box and one roll of Packing Tape for every nine blocks.")
    .button("Mark house corner").button("Pack marked house").button("Take moving cargo")
    .button("Craft at crafting table").button("Clear house selection");
  const result = await form.show(player);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator || result.canceled) return;
  if (locate(player)?.id !== pet.id) return reply(player, "Call your companion and reopen the workshop.");
  switch (result.selection) {
    case 0: return markHouseCorner(player);
    case 1: return packHouse(player);
    case 2: return collectBack(player, pet, true);
    case 3: return openCraftMenu(player);
    case 4:
      player.setDynamicProperty(houseKey(player), undefined);
      return reply(player, "House selection cleared.");
  }
}

function consumeHeldItem(player, typeId) {
  const equipment = player.getComponent("minecraft:equippable");
  const held = equipment?.getEquipment(EquipmentSlot.Mainhand);
  if (held?.typeId !== typeId) return false;
  if (held.amount > 1) {
    held.amount--;
    return equipment.setEquipment(EquipmentSlot.Mainhand, held);
  }
  return equipment.setEquipment(EquipmentSlot.Mainhand, undefined);
}

const workbenchGear = new Set(["cc:healing_salve", "cc:guard_biscuit", "cc:camp_tag"]);

function useWorkbenchGear(player, companion, item) {
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator
    || !companion.isValid || locate(player)?.id !== companion.id) return;
  const held = player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
  if (held?.typeId !== item || player.dimension.id !== companion.dimension.id
    || distance2(player.location, companion.location) > 25) return;
  if (item === "cc:camp_tag") return toggleStay(player);

  if (item === "cc:healing_salve") {
    const health = companion.getComponent("minecraft:health");
    if (!health || health.currentValue <= 0 || health.currentValue >= health.effectiveMax) {
      return reply(player, "Your companion doesn't need salve right now.");
    }
    if (!health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 8))) return;
  } else {
    if ((companion.getEffect("resistance")?.duration ?? 0) >= 20 * 20) {
      return reply(player, "Your companion already has enough resistance.");
    }
    companion.addEffect("resistance", 30 * 20, { amplifier: 0, showParticles: false });
  }
  if (player.getGameMode() !== GameMode.Creative) consumeHeldItem(player, item);
  reply(player, item === "cc:healing_salve" ? "Applied Healing Salve to your companion." : "Your companion has damage resistance for 30 seconds.");
}

async function changeAppearance(player, companionId) {
  await system.waitTicks(1);
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  const pet = locate(player);
  if (pet?.id !== companionId) return reply(player, "Call your companion before changing its appearance.");
  const saved = pet.getProperty(appearanceKey) ?? 0;
  const current = appearances[saved] ? saved : 0;
  const options = [...appearances.entries()].filter(([, appearance]) => appearance);
  const pageSize = 8;
  const pages = Math.ceil(options.length / pageSize);
  let page = Math.floor(options.findIndex(([index]) => index === current) / pageSize);
  while (player.isValid && fullMember(player) && player.getGameMode() !== GameMode.Spectator) {
    const form = new ActionFormData().title("Change Appearance")
      .body(`Page ${page + 1} of ${pages}`);
    const choices = options.slice(page * pageSize, (page + 1) * pageSize);
    for (const [index, { icon, name, trait }] of choices) {
      const label = index === current ? `${name} (Current)` : name;
      form.button(`${label}\n${trait}`, `textures/ui/companions/${icon}`);
    }
    const navigation = [];
    if (page > 0) { form.button("Previous page"); navigation.push(page - 1); }
    if (page < pages - 1) { form.button("Next page"); navigation.push(page + 1); }
    form.button("Cancel");
    const result = await form.show(player);
    if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
    if (result.cancelationReason === FormCancelationReason.UserBusy) {
      return reply(player, "Close your chat or inventory, then reopen the companion menu.");
    }
    if (result.canceled || result.selection === undefined) return;
    const choice = choices[result.selection];
    if (choice) {
      const [index, appearance] = choice;
      const ownedPet = locate(player);
      if (ownedPet?.id !== companionId) return reply(player, "Call your companion before changing its appearance.");
      if (index === saved) return;
      ownedPet.setProperty(appearanceKey, index);
      displayHud(player, ownedPet, tasks.get(player.id), player.getDynamicProperty(hudKey) ?? defaultHudMode, appearance);
      return speak(player, appearance, appearance.greeting);
    }
    const next = navigation[result.selection - choices.length];
    if (next === undefined) return;
    page = next;
    await system.waitTicks(1);
  }
}

async function showMenu(player) {
  if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
  if (openMenus.has(player.id) || (menuRequests.get(player.id) ?? -10) + 8 > now()) return;
  menuRequests.set(player.id, now());
  const session = {};
  openMenus.set(player.id, session);
  try {
    const pet = locate(player);
    const storage = inv(pet);
    const bag = workInventory(storage);
    const moving = movingInventory(storage);
    const sortEnabled = !player.getDynamicProperty(sortOffKey);
    const workPaused = !!player.getDynamicProperty(workOffKey);
    const appearance = appearanceOf(pet);
    const form = new ActionFormData().title(pet ? appearance.name : "Chibi Companions").body([
      "Chibi Companions " + PACK_VERSION,
      ...(pet ? ["HUD theme: " + hudTheme(appearance).name] : []),
      bag ? `Backpack  ${bag.size - bag.emptySlotsCount} / ${bag.size} slots` : "Your companion is away or hasn’t joined you yet.",
      ...(bag && bag.size < BACKPACK_CAPACITY ? ["This companion still has its older backpack."] : []),
      ...(moving?.size ? [`Moving inventory  ${moving.size - moving.emptySlotsCount} / ${moving.size} slots`] : []),
      ...(pet?.getDynamicProperty(recoveredKey) ? ["Recovered gear is protected from sorting. Use Take supplies."] : []),
      ...(pet?.getDynamicProperty(legacyCargoKey) ? ["Older cargo is protected from sorting until you empty the backpack."] : []),
      ...(pet ? [appearance.greeting, ""] : []),
      `Mining, chopping and harvesting  ${workPaused ? "Paused" : "Automatic"}`,
      `Chest sorting  ${sortEnabled ? "On" : "Paused"}`
    ].join("\n"));
    const actions = [];
    function button(label, action) {
      form.button(label);
      actions.push(action);
    }
    if (pet) {
      if (tasks.get(player.id)?.guide) button("Stop guiding", stopGuide);
      else button("Guide me to my bed", startGuide);
      button("Take supplies", collectBack);
      button("Build a house or structure", openBuildMenu);
      button("Moving and crafting", openWorkshopMenu);
    }
    button("Call companion", summonOrRecall);
    if (pet) {
      const companionId = pet.id;
      button("Change Appearance", () => changeAppearance(player, companionId));
      button(pet.getDynamicProperty(stayKey) ? "Follow me" : "Stay here", toggleStay);
    }
    button("Companion status", companionStatus);
    const hudMode = player.getDynamicProperty(hudKey) ?? defaultHudMode;
    button("HUD: " + hudModes[hudMode] + " · Change mode", cycleHud);
    if (workPaused) button("Resume automatic work", resumeWork);
    else button("Pause automatic work", pauseWork);
    button(sortEnabled ? "Pause chest sorting" : "Resume chest sorting", toggleSorting);
    const result = await form.show(player);
    if (openMenus.get(player.id) !== session || !player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator) return;
    if (result.cancelationReason === FormCancelationReason.UserBusy) {
      return reply(player, "Close your chat or inventory, then use the whistle again.");
    }
    if (!result.canceled && result.selection !== undefined) await actions[result.selection]?.(player);
  } finally {
    if (openMenus.get(player.id) === session) openMenus.delete(player.id);
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
  movehouse: ["Mark opposite house corners.", markHouseCorner],
  packhouse: ["Pack furniture from the marked area.", packHouse],
  build: ["Open the companion structure menu.", openBuildMenu],
  status: ["Check your companion’s backpack and work status.", player => {
    const pet = locate(player);
    const backpack = workInventory(inv(pet));
    const task = tasks.get(player.id);
    const work = player.getDynamicProperty(workOffKey) ? "paused" : "automatic";
    reply(player, `Backpack ${backpack ? `${backpack.size - backpack.emptySlotsCount}/${backpack.size} slots` : "away or unbound"}. Work: ${work}. ${task?.note ?? "Ready."}`);
  }],
  help: ["Show companion commands.", player => reply(player, "/chibi:whistle • /chibi:call • /chibi:work • /chibi:stop • /chibi:take • /chibi:build • /chibi:movehouse • /chibi:packhouse • /chibi:sorting • /chibi:mining • /chibi:status")]
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

world.afterEvents.worldLoad.subscribe(() => {
  guarded("recall cleanup", () => world.tickingAreaManager.removeAllTickingAreas());
  for (const id of ["overworld", "nether", "the_end"]) {
    guarded(`world load (${id})`, () => {
      for (const pet of world.getDimension(id).getEntities({ type: TYPE })) {
        guarded("pet load", () => recoverLegacy(pet));
      }
    });
  }
});
world.afterEvents.entityLoad.subscribe(({ entity }) => {
  if (entity.typeId === TYPE) guarded("pet load", () => recoverLegacy(entity));
});
world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  if (deadEntity.typeId === "minecraft:player") {
    return guarded("owner death", () => rememberDeath(deadEntity));
  }
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
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => guarded("player spawn", () => {
  const dead = world.getDynamicProperty(`cc:dead:${player.id}`);
  if (dead && dead === player.getDynamicProperty(packKey)) player.setDynamicProperty(packKey, undefined);
  if (dead) world.setDynamicProperty(`cc:dead:${player.id}`, undefined);
  if (!initialSpawn) stopGuide(player, "");
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
    } else if (owner === player.id && workbenchGear.has(itemStack?.typeId)) {
      event.cancel = true;
      const item = itemStack.typeId;
      system.run(() => guarded("workbench gear", () => useWorkbenchGear(player, target, item)));
    } else if (owner === player.id && itemStack?.typeId === "cc:companion_toy") {
      event.cancel = true;
      system.run(() => guarded("companion toy", () => {
        if (!player.isValid || !target.isValid || locate(player)?.id !== target.id) return;
        const task = getTask(player.id);
        task.happyUntil = now() + 60;
        setPose(target, "happy");
        target.dimension.playSound("random.pop", target.location, { volume: 0.5, pitch: 1.45 });
        reply(player, `${appearanceOf(target).name} is delighted with the toy.`);
      }));
    } else if (owner === player.id && (!itemStack || itemStack.typeId === "cc:snowdrop_whistle")) {
      event.cancel = true;
      if (locate(player)?.id === target.id) requestMenu(player);
    } else if (["minecraft:dried_kelp", "cc:companion_treat"].includes(itemStack?.typeId) && !owner) {
      event.cancel = true;
      system.run(() => guarded("befriend", () => {
        if (!player.isValid || !fullMember(player) || player.getGameMode() === GameMode.Spectator || !target.isValid || tame(target)?.isTamed) return;
        if (world.getDynamicProperty(linkKey(player.id)) || player.getDynamicProperty(packKey)) {
          return reply(player, "You already have a companion.");
        }
        if (itemStack.typeId === "cc:companion_treat"
          && inv(player)?.getItem(player.selectedSlotIndex)?.typeId !== itemStack.typeId) return;
        if (tame(target)?.tame(player)) {
          register(player, target);
          if (itemStack.typeId === "cc:companion_treat") consumeHeldItem(player, itemStack.typeId);
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

function rememberDeath(player) {
  const ownerId = player.id;
  const pet = locate(player);
  if (!pet) return;
  const task = getTask(ownerId);
  const flight = task.defense?.route?.flight ?? task.guide?.route?.flight ?? task.job?.flight;
  if (flight) abortFlight(pet, flight);
  task.guide = undefined;
  task.defense = undefined;
  task.job = undefined;
  task.trigger = undefined;
  if (world.gameRules.keepInventory || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 144) return;
  park(pet, task);
  pet.clearVelocity();
  setPose(pet, "idle");
  const death = { dimensionId: pet.dimension.id, location: player.location, tick: now(), items: new Map() };
  deathDrops.set(ownerId, death);
  const recent = recentDrops.get(ownerId);
  if (recent?.tick === death.tick) {
    for (const item of recent.items) death.items.set(item.id, item);
  }
  system.runTimeout(() => guarded("recover gear", () => {
    if (deathDrops.get(ownerId) !== death) return;
    deathDrops.delete(ownerId);
    const inventory = pet.isValid && workInventory(inv(pet));
    if (!inventory || pet.dimension.id !== death.dimensionId || distance2(pet.location, death.location) > 144) return;
    let recovered = 0;
    for (const item of death.items.values()) {
      if (!item.isValid || item.dimension.id !== death.dimensionId || distance2(item.location, death.location) > 36) continue;
      const amount = guarded("recover stack", () => recoverStack(inventory, item)) ?? 0;
      if (amount) pet.setDynamicProperty(recoveredKey, true);
      recovered += amount;
    }
    const owner = world.getAllPlayers().find(entry => entry.id === ownerId);
    if (owner && recovered) reply(owner, "Your companion recovered " + recovered + " items. Use Take supplies to get them back.");
  }), 4);
}

// Attribute drops only when the game identifies the player who dropped them.
world.afterEvents.entityItemDrop.subscribe(({ entity, items }) => guarded("manual drops", () => {
  if (entity.typeId !== "minecraft:player") return;
  const tick = now();
  const recent = recentDrops.get(entity.id);
  recentDrops.set(entity.id, { tick, items: recent?.tick === tick ? [...recent.items, ...items] : items });
  const death = deathDrops.get(entity.id);
  for (const item of items) {
    claims.set(item.id, { owner: entity.id, until: tick + 600 });
    if (death && tick - death.tick < 4) death.items.set(item.id, item);
  }
}));

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => guarded("defend owner", () => {
  if (hurtEntity.typeId !== "minecraft:player") return;
  const attacker = damageSource.damagingEntity;
  if (!mobThreat(attacker, TYPE) || !fullMember(hurtEntity) || hurtEntity.getGameMode() === GameMode.Spectator) return;
  const pet = locate(hurtEntity);
  if (!pet || pet.getDynamicProperty(stayKey) || attacker.dimension.id !== hurtEntity.dimension.id || pet.dimension.id !== hurtEntity.dimension.id
    || distance2(pet.location, hurtEntity.location) > 144) return;
  const task = getTask(hurtEntity.id);
  if (task.defense?.attacker.id === attacker.id) {
    task.defense.until = now() + 200;
    return;
  }
  if (task.defense?.route?.flight) abortFlight(pet, task.defense.route.flight);
  const flight = task.guide?.route?.flight ?? task.job?.flight;
  if (flight) abortFlight(pet, flight);
  if (task.guide) task.guide.route = undefined;
  task.job = undefined;
  task.defense = { attacker, until: now() + 200, nextPlan: 0 };
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
  job.useGroundClimb = false;
  return job.path.length ? "walking" : "arrived";
}

function walkTask(pet, job, tick) {
  const avoid = job.kind === "work" ? job.location : undefined;
  if (job.flight) {
    if (!appearanceOf(pet).canFly) return "blocked";
    const outcome = advanceFlight(pet, job.flight, avoid);
    if (outcome === "blocked" && job.flight.isStep) {
      abortFlight(pet, job.flight);
      job.flight = undefined;
      job.useGroundClimb = true;
      return "walking";
    }
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
  if (delta.y > 0.6) {
    // The native jump may still be in progress when a step-up job takes over.
    if (!pet.isOnGround) return "walking";
    const from = cell(here);
    if (!canClimb(pet.dimension, from, step, avoid)) return "blocked";
    const start = point(from);
    const canFly = appearanceOf(pet).canFly && !job.useGroundClimb;
    // Start from the middle of the lower tile, clear of the ledge face.
    if (distance2(here, start) > (canFly ? 0.025 : 0.075)) return steer(pet, here, start);
    if (canFly) {
      job.flight = planFlight(pet.dimension, here, step, avoid);
      if (job.flight) {
        job.flight.isStep = true;
        return "flying";
      }
    }
    job.climb = { from, step, at: tick, start, facing: { x: step.x - from.x, z: step.z - from.z } };
    return climbStep(pet, job, tick, avoid);
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

function startGuide(player) {
  const pet = locate(player);
  if (!pet) return reply(player, "Call your companion first.");
  const target = bedTarget(player.getSpawnPoint());
  if (!target) return reply(player, "Set your respawn point by using your bed in the Overworld first.");
  if (player.dimension.id !== target.dimensionId) {
    return reply(player, "Return to the Overworld and ask me to guide you to your bed.");
  }
  if (nearSpawn(player.location, target.location)) return reply(player, "You're already near your bed.");
  const task = getTask(player.id);
  pet.setDynamicProperty(stayKey, undefined);
  if (task.job?.flight) abortFlight(pet, task.job.flight);
  task.job = undefined;
  task.trigger = undefined;
  task.guide = { target, nextPlan: 0 };
  reply(player, "Follow your companion back to your bed.");
}

function stopGuide(player, message = "Home guidance stopped.") {
  const task = tasks.get(player.id);
  if (!task?.guide) return;
  const pet = locate(player);
  if (pet) {
    if (task.guide.route?.flight) abortFlight(pet, task.guide.route.flight);
    follow(pet, task);
  }
  task.guide = undefined;
  if (message) reply(player, message);
}

function updateGuide(player, pet, task, tick) {
  const guide = task.guide;
  const { target } = guide;
  if (!fullMember(player) || player.getGameMode() === GameMode.Spectator) return stopGuide(player);
  if (player.dimension.id !== target.dimensionId) return stopGuide(player, "You changed dimensions. Ask me to guide you again when you return.");
  if (nearSpawn(player.location, target.location)) {
    const bed = bedTarget(player.getSpawnPoint(), true);
    return stopGuide(player, bed && nearSpawn(player.location, bed.location)
      ? "We're back near your bed."
      : "Your bed is missing or its respawn point has changed. Use a bed and try again.");
  }
  const gap = distance2(player.location, pet.location);
  if (pet.dimension.id !== player.dimension.id || gap > 144) {
    if (guide.route?.flight) abortFlight(pet, guide.route.flight);
    guide.route = undefined;
    guide.waiting = true;
    follow(pet, task);
    if (tick >= task.recallAt) {
      task.recallAt = tick + 160;
      recallTo(pet, player);
    }
    return;
  }
  if (tick % 20 === 0) {
    const heading = spawnDirections(player.location, target.location);
    player.onScreenDisplay.setActionBar("Bed: " + heading + (guide.waiting ? " | Find safe footing nearby" : " | Follow your companion"));
  }
  if (guide.route) {
    if (gap > 36 && !guide.route.flight && !guide.route.climb) {
      pet.clearVelocity();
      guide.route.deadline++;
      return;
    }
    const route = guide.route;
    const result = tick < route.deadline ? walkTask(pet, route, tick) : "blocked";
    if (result === "walking" || result === "flying" || result === "climbing") {
      setPose(pet, result === "flying" ? "fly" : result === "climbing" ? "climb" : "idle");
      return;
    }
    if (route.flight) abortFlight(pet, route.flight);
    guide.route = undefined;
    if (result === "blocked") {
      guide.nextPlan = tick + 30;
      guide.waiting = true;
      return follow(pet, task);
    }
    pet.clearVelocity();
    setPose(pet, "idle");
  }
  if (gap > 16 || tick < guide.nextPlan || !pet.isOnGround) return;
  guide.nextPlan = tick + 20;
  const path = guidePath(pet.dimension, pet.location, target.location).slice(0, 4);
  guide.waiting = !path.length;
  if (!path.length) return follow(pet, task);
  park(pet, task);
  guide.route = { kind: "guide", path, deadline: tick + 150 };
}

function toggleStay(player) {
  const pet = locate(player);
  if (!pet || pet.dimension.id !== player.dimension.id || distance2(pet.location, player.location) > 25) {
    return reply(player, "Come within five blocks to ask your companion to stay or follow.");
  }
  const task = getTask(player.id);
  if (pet.getDynamicProperty(stayKey)) {
    pet.setDynamicProperty(stayKey, undefined);
    follow(pet, task);
    return reply(player, "Your companion will follow you again.");
  }
  const flight = task.defense?.route?.flight ?? task.guide?.route?.flight ?? task.job?.flight;
  if (flight) abortFlight(pet, flight);
  task.defense = undefined;
  task.guide = undefined;
  task.job = undefined;
  task.trigger = undefined;
  pet.setDynamicProperty(stayKey, true);
  remember(pet, player.id);
  park(pet, task);
  pet.clearVelocity();
  setPose(pet, "idle");
  reply(player, "Your companion will stay here. Use Call companion when you're ready.");
}

function hudTheme(appearance) {
  return hudThemes[appearance.hudTheme] ?? hudThemes.orchid;
}

function cycleHud(player) {
  const next = ((player.getDynamicProperty(hudKey) ?? defaultHudMode) + 1) % hudModes.length;
  player.setDynamicProperty(hudKey, next);
  const task = tasks.get(player.id);
  if (!task?.guide) {
    if (next === 0) player.onScreenDisplay.setActionBar("");
    else displayHud(player, locate(player), task, next);
  }
  reply(player, "HUD: " + hudModes[next]);
}

function displayHud(player, pet, task, mode, appearance = appearanceOf(pet)) {
  if (!mode || task?.guide || player.getGameMode() === GameMode.Spectator) return;
  const theme = hudTheme(appearance);
  const lines = [];
  if (mode & 1) {
    const parts = [theme.color + (pet ? appearance.voice : "Companion") + "§r"];
    if (pet) {
      const health = pet.getComponent("minecraft:health");
      const activity = pet.getDynamicProperty(stayKey) ? "Staying"
        : task?.defense ? "Defending"
        : task?.job?.kind === "work" ? "Gathering"
        : task?.job?.kind === "pickup" ? "Collecting"
        : task?.job?.kind === "sort" ? "Sorting" : "Following";
      parts.push(activity);
      if (health) parts.push(Math.ceil(health.currentValue) + " HP");
      if (pet.dimension.id === player.dimension.id) {
        parts.push(Math.round(Math.sqrt(distance2(player.location, pet.location))) + " blocks");
      } else {
        parts.push("Other dimension");
      }
    } else {
      parts.push("Away");
    }
    lines.push(parts.join("  "));
  }
  if (mode & 2) {
    const { x, y, z } = cell(player.location);
    const sector = Math.round(player.getRotation().y / 45);
    const heading = compassPoints[(sector + 8) % 8];
    lines.push(theme.color + heading + "§r  XYZ " + x + " / " + y + " / " + z);
  }
  player.onScreenDisplay.setActionBar(lines.join("\n"));
}

function companionStatus(player) {
  const pet = locate(player);
  if (!pet) {
    const raw = world.getDynamicProperty(linkKey(player.id) + ":spot");
    if (typeof raw !== "string") return reply(player, "No companion location has been recorded.");
    const { dim, pos } = JSON.parse(raw);
    return reply(player, "Last seen in " + dim.replace("minecraft:", "") + " at " + key(pos) + ".");
  }
  const health = pet.getComponent("minecraft:health");
  const storage = inv(pet);
  const bag = workInventory(storage);
  const moving = movingInventory(storage);
  const task = tasks.get(player.id);
  const mode = pet.getDynamicProperty(stayKey) ? "Staying"
    : task?.defense ? "Defending" : task?.guide ? "Guiding you" : "Following";
  const status = [
    mode + " in " + pet.dimension.id.replace("minecraft:", "") + " at " + key(cell(pet.location)),
    health && "Health: " + Math.ceil(health.currentValue),
    bag && "Backpack: " + bag.emptySlotsCount + " free of " + bag.size,
    moving?.size && "Moving: " + moving.emptySlotsCount + " free of " + moving.size
  ].filter(Boolean).join(" | ");
  speak(player, appearanceOf(pet), status);
}

function defendOwner(player, pet, task, tick) {
  const fight = task.defense;
  const { attacker } = fight;
  if (tick >= fight.until || !fullMember(player) || player.getGameMode() === GameMode.Spectator
    || !mobThreat(attacker, TYPE) || pet.dimension.id !== player.dimension.id
    || attacker.dimension.id !== pet.dimension.id || distance2(player.location, attacker.location) > 144
    || distance2(player.location, pet.location) > 196) {
    if (fight.route?.flight) abortFlight(pet, fight.route.flight);
    task.defense = undefined;
    return false;
  }
  park(pet, task);
  if (canStrike(pet, attacker)) {
    if (fight.route?.flight) abortFlight(pet, fight.route.flight);
    fight.route = undefined;
    pet.clearVelocity();
    pet.lookAt(attacker.location);
    if (tick >= (task.nextStrike ?? 0)) {
      task.nextStrike = tick + 20;
      attacker.applyDamage(4, { cause: EntityDamageCause.entityAttack, damagingEntity: pet });
      fight.swingUntil = tick + 8;
    }
    setPose(pet, tick < (fight.swingUntil ?? 0) ? "defend" : "idle");
    return true;
  }
  if (!fight.route && tick >= fight.nextPlan && pet.isOnGround) {
    fight.nextPlan = tick + 10;
    const path = guidePath(pet.dimension, pet.location, attacker.location).slice(0, 3);
    if (path.length) fight.route = { kind: "defense", path, deadline: tick + 50 };
  }
  if (fight.route) {
    const route = fight.route;
    const result = tick < route.deadline ? walkTask(pet, route, tick) : "blocked";
    if (result === "blocked" || result === "arrived") {
      if (route.flight) abortFlight(pet, route.flight);
      fight.route = undefined;
    }
    setPose(pet, result === "flying" ? "fly" : result === "climbing" ? "climb" : "idle");
  }
  return true;
}

function update(player, pet, tick) {
  const task = getTask(player.id);
  const inventory = workInventory(inv(pet));
  if (!inventory) return;
  if (deathDrops.has(player.id)) return;
  if (pet.getDynamicProperty(stayKey)) {
    park(pet, task);
    setPose(pet, "idle");
    return;
  }
  if (task.defense && defendOwner(player, pet, task, tick)) return;
  if (tick % 20 === 0 || !task.position) {
    const previous = task.position;
    if (!previous || distance2(previous, pet.location) >= 1) {
      task.lastMove = tick;
      task.position = pet.location;
      remember(pet, player.id);
    }
  }
  if (task.guide) return updateGuide(player, pet, task, tick);
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
  if (!job && tick >= task.nextSort && inventory.emptySlotsCount < inventory.size && !pet.getDynamicProperty(recoveredKey) && !pet.getDynamicProperty(legacyCargoKey) && !player.getDynamicProperty(sortOffKey)) {
    task.nextSort = tick + 120;
    job = makeSort(pet, inventory, tick);
  }
  if (!job && tick >= (task.nextLedge ?? 0)) {
    const canFly = appearanceOf(pet).canFly;
    const rise = cell(player.location).y - cell(pet.location).y;
    if (canFly && rise === 1) {
      task.nextLedge = tick + 24;
      const path = ledgeRoute(pet.dimension, pet.location, player.location);
      if (path) job = { kind: "follow", path, deadline: tick + 130 };
    }
    if (!job && canFly && gap > 1 && pet.isOnGround) {
      task.nextLedge = tick + 24;
      const flight = followFlight(pet.dimension, pet.location, player.location);
      if (flight) job = { kind: "follow", path: [flight.landing], flight, deadline: tick + 90 };
    } else if (!canFly && gap > 1 && pet.isOnGround && player.location.y - pet.location.y >= 0.8) {
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
      if (tick % 20 === 0) displayHud(player, pet, tasks.get(player.id), player.getDynamicProperty(hudKey) ?? defaultHudMode);
    });
  }
  if (tick % 100 === 0) {
    for (const [id, claim] of claims) if (claim.until <= tick) claims.delete(id);
    for (const [id, drop] of recentDrops) if (tick - drop.tick > 2) recentDrops.delete(id);
  }
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const task = tasks.get(playerId);
  const flight = task?.defense?.route?.flight ?? task?.guide?.route?.flight ?? task?.job?.flight;
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
  if (pet && !deathDrops.has(player.id) && !pet.getDynamicProperty(stayKey)) guarded("dimension follow", () => {
    stopGuide(player, "Home guidance stopped because you changed dimensions.");
    recallTo(pet, player);
  });
});
