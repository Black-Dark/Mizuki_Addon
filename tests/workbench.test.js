import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = path => readFileSync(new URL("../" + path, import.meta.url));
const json = path => JSON.parse(file(path));
function recipe(id) {
  const data = json("behavior_pack/recipes/" + id + ".json");
  return data["minecraft:recipe_shapeless"] ?? data["minecraft:recipe_shaped"];
}

test("the vanilla crafting table makes a placeable, recoverable companion workbench", () => {
  const { tags, ingredients, result } = recipe("companion_workbench");
  const block = json("behavior_pack/blocks/companion_workbench.json")["minecraft:block"];
  assert.deepEqual(tags, ["crafting_table"]);
  assert.deepEqual(ingredients.map(({ item }) => item), ["minecraft:crafting_table", "minecraft:chest", "minecraft:copper_ingot"]);
  assert.equal(result.item, block.description.identifier);
  const loot = json("behavior_pack/" + block.components["minecraft:loot"]);
  assert.equal(loot.pools[0].entries[0].name, result.item);
  const atlas = json("resource_pack/textures/terrain_texture.json").texture_data;
  for (const { texture } of Object.values(block.components["minecraft:material_instances"])) {
    assert.equal(file("resource_pack/" + atlas[texture].textures + ".png").toString("ascii", 1, 4), "PNG");
  }
});

test("new gear uses the workbench tag and has registered items and icons", () => {
  const block = json("behavior_pack/blocks/companion_workbench.json")["minecraft:block"];
  const stationTags = block.components["minecraft:crafting_table"].crafting_tags;
  const atlas = json("resource_pack/textures/item_texture.json").texture_data;
  for (const id of ["healing_salve", "guard_biscuit", "camp_tag"]) {
    const item = json("behavior_pack/items/" + id + ".json")["minecraft:item"];
    assert.deepEqual(recipe(id).tags, stationTags);
    assert.equal(recipe(id).result.item, item.description.identifier);
    const texture = atlas[item.components["minecraft:icon"]].textures;
    assert.equal(file("resource_pack/" + texture + ".png").toString("ascii", 1, 4), "PNG");
  }
  for (const id of ["companion_toy", "companion_treat"]) {
    assert.deepEqual(recipe(id).tags, ["crafting_table", ...stationTags]);
  }
});
