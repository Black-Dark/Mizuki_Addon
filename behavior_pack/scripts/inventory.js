export function snapshot(container) {
  return Array.from({ length: container.size }, (_, slot) => container.getItem(slot));
}

// Plan without touching the source or destination. A plan only succeeds if every
// item fits. Keep original ItemStacks so metadata is preserved on writes/rollback.
export function planInsert(slots, items) {
  const next = slots.slice();
  const changed = new Set();
  for (const item of items) {
    let remaining = item.amount;
    const write = (slot, stack, amount) => {
      const copy = stack.clone();
      copy.amount = amount;
      next[slot] = copy;
      changed.add(slot);
    };
    for (let i = 0; remaining && i < next.length; i++) {
      const stack = next[i];
      if (!stack || !stack.isStackableWith(item)) continue;
      const count = Math.min(remaining, stack.maxAmount - stack.amount);
      if (!count) continue;
      write(i, stack, stack.amount + count);
      remaining -= count;
    }
    for (let i = 0; remaining && i < next.length; i++) {
      if (next[i]) continue;
      const count = Math.min(remaining, item.maxAmount);
      write(i, item, count);
      remaining -= count;
    }
    if (remaining) return undefined;
  }
  return Array.from(changed, slot => ({ slot, before: slots[slot], after: next[slot] }));
}

export function restore(container, changes) {
  for (const { slot, before } of changes) container.setItem(slot, before);
}

export function commit(container, changes) {
  const written = [];
  try {
    for (const change of changes) {
      container.setItem(change.slot, change.after);
      written.push(change);
    }
  } catch (error) {
    restore(container, written);
    throw error;
  }
}

// Matching chests outrank completely empty ones. A partially full chest
// containing unrelated items is never a fallback.
export function chestRank(slots, item) {
  let matching = false;
  let empty = 0;
  for (const stack of slots) {
    if (!stack) {
      empty++;
    } else if (stack.typeId === item.typeId) {
      matching = true;
      if (stack.amount < stack.maxAmount && stack.isStackableWith(item)) return 0;
    }
  }
  if (matching && empty) return 1;
  if (empty === slots.length && empty) return 2;
  return Infinity;
}

// Transfer compatible partial stacks first, even if the chest's earliest slot
// is empty. swapItems moves a whole stack between containers in one native call.
export function depositSlot(source, sourceSlot, destination) {
  const original = source.getItem(sourceSlot);
  if (!original) return 0;
  const slots = snapshot(destination);
  if (!Number.isFinite(chestRank(slots, original))) return 0;

  for (let i = 0; i < slots.length; i++) {
    const existing = slots[i];
    const current = source.getItem(sourceSlot);
    if (!current) break;
    if (!existing || !existing.isStackableWith(current) || existing.amount >= existing.maxAmount) continue;
    const count = Math.min(current.amount, existing.maxAmount - existing.amount);
    const increased = existing.clone();
    increased.amount += count;
    const remainder = current.clone();
    if (count < current.amount) remainder.amount -= count;
    // Both writes are synchronous. Restore the source if the destination rejects
    // the write. Another script callback cannot interleave with this operation.
    source.setItem(sourceSlot, count === current.amount ? undefined : remainder);
    try {
      destination.setItem(i, increased);
    } catch (error) {
      source.setItem(sourceSlot, current);
      throw error;
    }
  }
  const empty = slots.findIndex(stack => !stack);
  if (empty !== -1 && source.getItem(sourceSlot) && !destination.getItem(empty)) {
    source.swapItems(sourceSlot, empty, destination);
  }
  return original.amount - (source.getItem(sourceSlot)?.amount ?? 0);
}
