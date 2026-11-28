import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { appearanceOf, appearances } from "../behavior_pack/scripts/appearances.js";

const source = path => new URL("../" + path, import.meta.url);
const archive = readFileSync(source("Chibi-Companions-Archive-Art.zip"));
const central = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const files = new Map();
let offset = archive.readUInt32LE(central + 16);
for (let index = 0; index < archive.readUInt16LE(central + 10); index++) {
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  const length = archive.readUInt16LE(offset + 28);
  files.set(archive.toString("utf8", offset + 46, offset + 46 + length), offset);
  offset += 46 + length + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
}

function file(path) {
  const local = source(path);
  if (existsSync(local)) return readFileSync(local);
  const entry = files.get(path);
  assert.notEqual(entry, undefined, path + " is missing from the source archive");
  const header = archive.readUInt32LE(entry + 42);
  assert.equal(archive.readUInt32LE(header), 0x04034b50);
  const start = header + 30 + archive.readUInt16LE(header + 26) + archive.readUInt16LE(header + 28);
  const compressed = archive.subarray(start, start + archive.readUInt32LE(entry + 20));
  const method = archive.readUInt16LE(entry + 10);
  assert.ok(method === 0 || method === 8);
  return method === 0 ? compressed : inflateRawSync(compressed);
}
const json = path => JSON.parse(file(path));

test("saved appearance indices resolve to a matching model, texture, and menu icon", () => {
  const entity = json("behavior_pack/entities/mizuki.json")["minecraft:entity"];
  const client = json("resource_pack/entity/mizuki.entity.json")["minecraft:client_entity"].description;
  const { arrays } = json("resource_pack/render_controllers/mizuki.render_controllers.json")
    .render_controllers["controller.render.ochub.mizuki"];
  assert.deepEqual(appearances.slice(0, 6).map(profile => profile.icon), [
    "mizuki", "sora", "yukishiro", "shion", "lucien", "naoki"
  ]);
  assert.deepEqual(entity.description.properties["cc:appearance"].range, [0, appearances.length - 1]);
  assert.equal(arrays.geometries["Array.variants"].length, appearances.length);
  assert.equal(arrays.textures["Array.skins"].length, appearances.length);
  const archiveModels = new Map(json("resource_pack/models/entity/oc_hub_chibis.geo.json")["minecraft:geometry"]
    .map(model => [model.description.identifier, model]));
  assert.equal(appearances.filter(Boolean).length, 56);
  assert.deepEqual(appearances.slice(6, 9), [null, null, null]);
  for (const [index, profile] of appearances.entries()) {
    const icon = profile?.icon ?? "mizuki";
    const key = index === 0 || !profile ? "default" : icon;
    assert.equal(arrays.geometries["Array.variants"][index], "Geometry." + key);
    assert.equal(arrays.textures["Array.skins"][index], "Texture." + key);
    if (!profile) assert.equal(appearanceOf({ getProperty: () => index }).icon, "mizuki");
    const model = archiveModels.get(client.geometry[key])
      ?? json("resource_pack/models/entity/" + icon + ".geo.json")["minecraft:geometry"][0];
    assert.equal(model.description.identifier, client.geometry[key]);
    const skin = file("resource_pack/" + client.textures[key] + ".png");
    assert.equal(skin.readUInt32BE(16), model.description.texture_width);
    assert.equal(skin.readUInt32BE(20), model.description.texture_height);
    assert.equal(file("resource_pack/textures/ui/companions/" + icon + ".png").toString("ascii", 1, 4), "PNG");
  }
});

test("archive chibis use solid limb rigs and dedicated, grounded walk animations", () => {
  const animations = json("resource_pack/animations/mizuki.animation.json").animations;
  const prefix = "animation.ochub.mizuki.archive_";
  for (const name of ["walk", "carry_walk", "pickup", "happy", "climb"]) {
    assert.equal(animations[prefix + name].bones.root, undefined);
  }
  const walk = animations[prefix + "walk"].bones;
  assert.match(walk.left_leg.rotation[0], /query.modified_distance_moved/);
  assert.match(walk.right_leg.rotation[0], /\* -21$/);
  assert.deepEqual(Object.keys(animations[prefix + "carry_walk"].bones), ["left_leg", "right_leg"]);
  const look = animations[prefix + "look"].bones.head.rotation;
  assert.match(look[0], /math\.clamp\(.+, -10, 10\)/);
  assert.match(look[1], /math\.clamp\(.+, -15, 15\)/);

  const models = json("resource_pack/models/entity/oc_hub_chibis.geo.json")["minecraft:geometry"];
  assert.equal(models.length, 50);
  for (const model of models) {
    const bones = new Map(model.bones.map(bone => [bone.name, bone]));
    for (const name of ["left_leg", "right_leg", "left_arm", "right_arm", "body", "head"]) {
      assert.ok(bones.get(name).cubes.length > 0);
      assert.ok(bones.get(name).cubes[0].size[2] >= 3);
      assert.notDeepEqual(bones.get(name).cubes[0].uv.north, bones.get(name).cubes[0].uv.south);
    }
    for (const name of ["backpack", "axe", "pickaxe"]) assert.ok(bones.get(name).cubes.length);
    const head = bones.get("head").cubes;
    assert.ok(head.length >= 10, "hair and face should be separate layers");
    for (const bone of model.bones) {
      for (const cube of bone.cubes ?? []) {
        for (const { uv: [x, y], uv_size: [width, height] } of Object.values(cube.uv)) {
          assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
          assert.ok(x + width <= model.description.texture_width && y + height <= model.description.texture_height);
        }
      }
    }
  }
});

test("each archive appearance has its own dialogue and exactly one grounded idle gesture", () => {
  const original = 9;
  const profiles = appearances.slice(original);
  for (const line of ["trait", "greeting", "recalled", "handedOver", "empty"]) {
    assert.equal(new Set(profiles.map(profile => profile[line])).size, profiles.length, line);
    assert.ok(profiles.every(profile => profile[line]?.length > 0));
  }
  const client = json("resource_pack/entity/mizuki.entity.json")["minecraft:client_entity"].description;
  const { animations } = json("resource_pack/animations/archive_personalities.animation.json");
  const { states } = json("resource_pack/animation_controllers/mizuki.animation_controllers.json")
    .animation_controllers[client.animations.pose];
  const cases = new Map();
  for (const animation of states.default.animations) {
    const [alias, condition] = Object.entries(animation)[0];
    if (!alias.startsWith("archive_idle_")) continue;
    assert.ok(animations[client.animations[alias]]);
    assert.equal(animations[client.animations[alias]].bones.root, undefined);
    assert.match(condition, /query.property\('cc:pose'\) == 'idle'/);
    for (const match of condition.matchAll(/cc:appearance'\) == (\d+)/g)) {
      const index = Number(match[1]);
      assert.ok(!cases.has(index), "appearance has more than one idle gesture");
      cases.set(index, alias);
    }
  }
  assert.deepEqual([...cases.keys()].sort((a, b) => a - b), profiles.map((_, i) => i + original));
});
