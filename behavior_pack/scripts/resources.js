import { BlockPermutation, EquipmentSlot, GameMode, world } from "@minecraft/server";
import { center, distance2, getBlock, key, offset, sides } from "./terrain.js";
import { commit, planInsert, restore, snapshot } from "./inventory.js";

const vanilla = ids => new Set(ids.split(" ").map(id => "minecraft:" + id));
const ores = vanilla("coal_ore iron_ore copper_ore gold_ore redstone_ore lit_redstone_ore lapis_ore diamond_ore emerald_ore deepslate_coal_ore deepslate_iron_ore deepslate_copper_ore deepslate_gold_ore deepslate_redstone_ore lit_deepslate_redstone_ore deepslate_lapis_ore deepslate_diamond_ore deepslate_emerald_ore nether_gold_ore quartz_ore ancient_debris");
const logs = vanilla("oak_log spruce_log birch_log jungle_log acacia_log dark_oak_log mangrove_log cherry_log pale_oak_log");
const leaves = vanilla("oak_leaves spruce_leaves birch_leaves jungle_leaves acacia_leaves dark_oak_leaves mangrove_leaves cherry_leaves pale_oak_leaves leaves leaves2");
const rock = vanilla("stone deepslate tuff calcite granite diorite andesite netherrack basalt blackstone dirt coarse_dirt gravel bedrock");
const crops = new Map([
  ["minecraft:wheat", 7], ["minecraft:carrots", 7], ["minecraft:potatoes", 7], ["minecraft:beetroot", 7]
]);
const supply = new Map([
  ["minecraft:wheat", "minecraft:wheat_seeds"], ["minecraft:carrots", "minecraft:carrot"],
  ["minecraft:potatoes", "minecraft:potato"], ["minecraft:beetroot", "minecraft:beetroot_seeds"]
]);
const tiers = new Map(Object.entries({ wooden: 0, golden: 0, stone: 1, copper: 1, iron: 2, diamond: 3, netherite: 3 }));

export function kind(type) {
  if (ores.has(type)) return "mine";
  if (logs.has(type)) return "chop";
  if (crops.has(type)) return "gather";
}
const family = type => type.replace("minecraft:lit_", "minecraft:");
const placedKey = (dim, pos) => `cc:placed:${dim.id}:${key(pos)}`;
export function trackPlacement(block) {
  if (ores.has(block.typeId) || logs.has(block.typeId)) {
    world.setDynamicProperty(placedKey(block.dimension, block.location), true);
  }
}
export function forgetPlacement(dim, pos) {
  const id = placedKey(dim, pos);
  if (world.getDynamicProperty(id)) world.setDynamicProperty(id, undefined);
}

export function supportsTool(type, tool) {
  const group = kind(type);
  if (group === "gather") return true;
  const match = /^minecraft:(wooden|golden|stone|copper|iron|diamond|netherite)_(pickaxe|axe)$/.exec(tool?.typeId ?? "");
  if (!match) return false;
  if (group === "chop") return match[2] === "axe";
  if (group !== "mine" || match[2] !== "pickaxe") return false;
  let minimum = 0;
  if (/iron_ore|copper_ore|lapis_ore/.test(type)) minimum = 1;
  if (/deepslate_gold_ore|:gold_ore|redstone_ore|diamond_ore|emerald_ore/.test(type)) minimum = 2;
  if (type === "minecraft:ancient_debris") minimum = 3;
  return tiers.get(match[1]) >= minimum;
}

export function mature(permutation) {
  const maximum = crops.get(permutation.type.id);
  return maximum === undefined || permutation.getState("growth") === maximum;
}

export function withinWorkRange(trigger, dim, pos, radius = 6) {
  return trigger.dim === dim.id && distance2(trigger.pos, pos) <= radius ** 2;
}

function naturalLeavesNearby(dim, pos, type) {
  let top = 3;
  while (top < 7 && getBlock(dim, offset(pos, 0, top - 1, 0))?.typeId === type) top++;
  for (let y = 0; y <= top; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const block = getBlock(dim, offset(pos, x, y, z));
        if (block && leaves.has(block.typeId) && block.permutation.getState("persistent_bit") === false) return true;
      }
    }
  }
  return false;
}

export function eligible(dim, block, trigger) {
  if (!block || family(block.typeId) !== family(trigger.type) || !mature(block.permutation)) return false;
  const pos = block.location;
  if (!withinWorkRange(trigger, dim, pos, 4) || block.isWaterlogged) return false;
  if (trigger.kind === "gather") return getBlock(dim, offset(pos, 0, -1, 0))?.typeId === "minecraft:farmland";
  if (world.getDynamicProperty(placedKey(dim, pos))) return false;
  if (trigger.kind === "chop" && !naturalLeavesNearby(dim, pos, block.typeId)) return false;
  let exposed = false;
  let naturalNeighbors = 0;
  for (const [x, y, z] of sides) {
    const neighbor = getBlock(dim, offset(pos, x, y, z));
    if (!neighbor || neighbor.isLiquid || neighbor.isWaterlogged) return false;
    if (neighbor.isAir) {
      if (y === 0) exposed = true;
      continue;
    }
    if (rock.has(neighbor.typeId) || ores.has(neighbor.typeId)) naturalNeighbors++;
    else if (trigger.kind === "mine") return false;
    if (trigger.kind === "chop" && !rock.has(neighbor.typeId) && !logs.has(neighbor.typeId) && !leaves.has(neighbor.typeId)
      && neighbor.typeId !== "minecraft:grass_block" && neighbor.typeId !== "minecraft:podzol") return false;
    if (y === 1 && ["minecraft:gravel", "minecraft:sand", "minecraft:red_sand"].includes(neighbor.typeId)) return false;
  }
  // Avoid exposed decorative ore in the default mode and reject underside-only
  // or top-only exposure. The work executor also checks for occupants.
  return exposed && (trigger.kind !== "mine" || naturalNeighbors >= 2);
}

export function makeTrigger(event, tick) {
  const { player, block, brokenBlockPermutation: permutation } = event;
  const type = permutation.type.id;
  const group = kind(type);
  if (!group || !mature(permutation) || player.getGameMode() !== GameMode.Survival || !world.gameRules.doTileDrops) return;
  const trigger = { type, kind: group, pos: block.location, dim: block.dimension.id, tick, tool: event.itemStackBeforeBreak };
  return {
    ...trigger,
    canWork: supportsTool(type, trigger.tool)
  };
}

export function heldTool(player, trigger) {
  const equipment = player.getComponent("minecraft:equippable");
  const tool = equipment?.getEquipment(EquipmentSlot.Mainhand);
  if (trigger.kind === "gather") return { equipment, tool: undefined };
  if (!supportsTool(trigger.type, tool) || tool.typeId !== trigger.tool?.typeId) return;
  const enchantments = item => JSON.stringify((item.getComponent("minecraft:enchantable")?.getEnchantments() ?? [])
    .map(({ type, level }) => [type.id, level]).sort());
  if (enchantments(tool) !== enchantments(trigger.tool)) return;
  return { equipment, tool };
}

function replant(block, drops) {
  const seed = drops.findIndex(item => item.typeId === supply.get(block.typeId));
  if (seed < 0) return;
  if (drops[seed].amount === 1) drops.splice(seed, 1);
  else drops[seed].amount--;
  return block.permutation.withState("growth", 0);
}

export function harvest(block, inventory, trigger, player) {
  if (!world.gameRules.doTileDrops || player.getGameMode() !== GameMode.Survival) return false;
  const held = heldTool(player, trigger);
  if (!held) return false;
  const drops = world.getLootTableManager().generateLootFromBlock(block, held.tool);
  if (!drops?.length) return false;
  const replacement = trigger.kind === "gather" ? replant(block, drops) : undefined;
  const plan = planInsert(snapshot(inventory), drops);
  if (!plan) return false;

  const old = block.permutation;
  const tool = held.tool?.clone();
  const durability = tool?.getComponent("minecraft:durability");
  let worn = false;
  let broken = false;
  if (durability && !durability.unbreakable) {
    const unbreaking = tool.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0;
    worn = Math.random() * 100 < durability.getDamageChance(unbreaking);
    if (worn) {
      broken = durability.damage + 1 >= durability.maxDurability;
      if (!broken) durability.damage++;
    }
  }
  block.setPermutation(replacement ?? BlockPermutation.resolve("minecraft:air"));
  try {
    commit(inventory, plan);
  } catch (error) {
    block.setPermutation(old);
    throw error;
  }
  try {
    if (worn && !held.equipment.setEquipment(EquipmentSlot.Mainhand, broken ? undefined : tool)) {
      throw new Error("The owner's tool could not be updated.");
    }
  } catch (error) {
    restore(inventory, plan);
    block.setPermutation(old);
    throw error;
  }
  if (broken) player.playSound("random.break");
  return true;
}

// A plant may mutate between planning and arrival, or a different player may
// claim a target first. Re-check the exact block from a loaded chunk at the swing.
export function reachableCandidates(dim, trigger, companionLocation, nearby) {
  return nearby
    .map(pos => getBlock(dim, pos))
    .filter(block => eligible(dim, block, trigger))
    .sort((a, b) => distance2(center(a.location), companionLocation) - distance2(center(b.location), companionLocation));
}
