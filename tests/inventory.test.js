import test from "node:test";
import assert from "node:assert/strict";
import { chestRank, commit, depositSlot, planInsert } from "../behavior_pack/scripts/inventory.js";

class Stack {
  constructor(typeId, amount = 1, data = "", maxAmount = 64) {
    Object.assign(this, { typeId, amount, data, maxAmount });
  }
  clone() { return new Stack(this.typeId, this.amount, this.data, this.maxAmount); }
  isStackableWith(other) {
    return this.maxAmount > 1 && this.typeId === other.typeId && this.data === other.data;
  }
}
class Container {
  constructor(...slots) { this.slots = slots; this.size = slots.length; }
  getItem(slot) { return this.slots[slot]?.clone(); }
  setItem(slot, item) { this.slots[slot] = item?.clone(); }
  swapItems(from, to, dest) {
    const other = dest.getItem(to);
    dest.setItem(to, this.getItem(from));
    this.setItem(from, other);
  }
}
const ore = (n, data) => new Stack("raw_iron", n, data);
const total = (...containers) => containers.flatMap(c => c.slots).reduce((sum, item) => sum + (item?.amount ?? 0), 0);

test("sort ranks partial stacks, matching empty slots, then an entirely empty chest", () => {
  const item = ore(5);
  assert.equal(chestRank([undefined, ore(63)], item), 0);
  assert.equal(chestRank([undefined, ore(64)], item), 1);
  assert.equal(chestRank([undefined, ore(3, "different data")], item), 1);
  assert.equal(chestRank([undefined, undefined], item), 2);
  assert.equal(chestRank([undefined, new Stack("apple")], item), Infinity);
  assert.equal(chestRank([ore(64)], item), Infinity);
});

test("fills existing partial stacks before an earlier empty slot", () => {
  const source = new Container(ore(9));
  const chest = new Container(undefined, ore(63), ore(60));
  const original = total(source, chest);
  assert.equal(depositSlot(source, 0, chest), 9);
  assert.deepEqual(chest.slots.map(i => i.amount), [4, 64, 64]);
  assert.equal(source.getItem(0), undefined);
  assert.equal(total(source, chest), original);
});

test("two companions sharing the last partial slot preserve the remainder", () => {
  const first = new Container(ore(2));
  const second = new Container(ore(4));
  const chest = new Container(ore(61));
  const original = total(first, second, chest);
  assert.equal(depositSlot(first, 0, chest), 2);
  assert.equal(depositSlot(second, 0, chest), 1);
  assert.equal(depositSlot(second, 0, chest), 0);
  assert.equal(second.getItem(0).amount, 3);
  assert.equal(total(first, second, chest), original);
});

test("chest rejects a write and the source is restored", () => {
  const source = new Container(ore(7));
  const chest = new Container(ore(60));
  chest.setItem = () => { throw new Error("invalid destination"); };
  assert.throws(() => depositSlot(source, 0, chest), /invalid destination/);
  assert.equal(total(source, chest), 67);
  assert.equal(source.getItem(0).amount, 7);
});

test("metadata and non-stackable amounts are preserved", () => {
  const source = new Container(new Stack("sword", 1, "enchanted", 1));
  const chest = new Container(new Stack("sword", 1, "custom_name", 1), undefined);
  assert.equal(depositSlot(source, 0, chest), 1);
  assert.equal(chest.getItem(0).data, "custom_name");
  assert.equal(chest.getItem(1).data, "enchanted");
});

test("pickup or harvest only plans when all resulting items fit", () => {
  const slots = [ore(63)];
  assert.equal(planInsert(slots, [ore(2)]), undefined);
  assert.equal(slots[0].amount, 63);
  assert.equal(planInsert(slots, [ore(1), new Stack("apple")]), undefined);
  assert.equal(planInsert(slots, [ore(1)])[0].after.amount, 64);
});

test("multi-item write restores prior backpack changes on failure", () => {
  const container = new Container(ore(63), undefined);
  const plan = planInsert(container.slots, [ore(2)]);
  const set = container.setItem.bind(container);
  container.setItem = (slot, item) => {
    if (slot === 1) throw new Error("stopped");
    set(slot, item);
  };
  assert.throws(() => commit(container, plan), /stopped/);
  assert.equal(container.getItem(0).amount, 63);
  assert.equal(container.getItem(1), undefined);
});
