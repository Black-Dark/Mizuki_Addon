import { commit, planInsert, restore, snapshot } from "./inventory.js";

export function recoverStack(inventory, item) {
  if (!item.isValid) return 0;
  const stack = item.getComponent("minecraft:item")?.itemStack;
  const plan = stack && planInsert(snapshot(inventory), [stack]);
  if (!plan) return 0;

  commit(inventory, plan);
  try {
    item.remove();
  } catch (error) {
    restore(inventory, plan);
    throw error;
  }
  return stack.amount;
}
