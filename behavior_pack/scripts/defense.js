import { clearSight, distance2, offset } from "./terrain.js";

export function mobThreat(entity, companionType) {
  return entity?.isValid && entity.typeId !== "minecraft:player" && entity.typeId !== companionType
    && (entity.getComponent("minecraft:health")?.currentValue ?? 0) > 0;
}

export function canStrike(companion, attacker) {
  return distance2(companion.location, attacker.location) <= 2.3 ** 2
    && clearSight(companion.dimension, offset(companion.location, 0, 0.7, 0), offset(attacker.location, 0, 0.65, 0));
}
