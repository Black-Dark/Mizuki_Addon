# Mizuki Workshop

The starting point is the supplied Chibi_Companions_Mizuki-3.0.mcaddon. The workshop preserves the existing pack and module UUIDs so Minecraft can recognize updates.

## Where to work

- behavior_pack/scripts: whistle, ownership, work areas, gathering and sorting
- behavior_pack/entities and items: companion and whistle definitions
- resource_pack: base models, textures, animations and in-game text
- Chibi-Companions-Archive-Art.zip: rebuilt archive chibi models, textures, and menu icons included by the build
- art: character-specific visual designs and the artwork generator
- tests: inventory and terrain checks
- CHANGELOG.md: record what each release changes and which devices tested it

## Moving house

Use `/chibi:movehouse` while standing at one corner of the house, then run it again at the opposite upper corner. Use `/chibi:packhouse` to have the nearby companion move supported blocks into its dedicated Moving Inventory (slots 10–36); the regular gathering backpack remains in slots 1–9. The pack operation refuses non-empty containers and rolls the selected blocks back if an inventory write fails. `/chibi:take` transfers both inventories to the player.

The current pack supports crafting/enchanting tables, workstations, anvils, jukeboxes, bells, campfires, furnaces, smokers, brewing stands, chests and barrels. This is a block-item move: it does not preserve non-empty container contents or unsupported blocks. In multiplayer, mark only an area you are authorized to edit; the add-on does not currently provide land-claim ownership checks.

### Crafting moving and companion items

- **Moving Box:** six paper and two planks. House packing uses one box per nine supported blocks.
- **Packing Tape:** one slimeball and one paper makes two rolls. Packing uses one roll per Moving Box.
- **Companion Treat:** dried kelp, wheat and sweet berries make three treats. Treats can be used to befriend or heal a companion.
- **Companion Toy:** four string and one wool. Use it on your companion for a happy reaction; the toy is reusable.
- **Snowdrop Whistle:** the existing crafted whistle still opens the companion menu.

The moving boxes and tape are consumed only after the pack operation succeeds. The packed blocks go into the companion's Moving Inventory; `/chibi:take` retrieves them at the new location.

## Companion workshop

Use **Craft at crafting table** in the companion menu while a crafting table is within four blocks of the companion. The companion can craft oak planks, sticks, Moving Boxes, Packing Tape, Companion Treats and a reusable Companion Toy from ingredients in the player's inventory. Use the Companion Toy on your owned companion for a happy reaction. Treats can be used to befriend a wild companion or heal an owned one.

Use **Build a structure** to choose an Oak Starter Cabin or Stone Watch Post. Stand just outside a clear, level site; the companion checks that the footprint is empty and that the ground is solid, then uses materials from the player's inventory. The cabin needs 92 oak planks and 4 glass panes; the watch post needs 32 cobblestone.

## Work together

This is the public `Black-Dark/Mizuki_Addon` repository. Penney and N7 Knight (`nobleknights015-maker`) can both push branches.

1. Start each update from the latest `main` and give it its own branch.
2. Run `./build.ps1`, then open a pull request. Include what changed, the test results, and any Samsung or Switch checks still pending.
3. Have the other collaborator review it before merging. Keep `main` playable and keep the pack and module UUIDs stable so Minecraft recognises future updates.

## Build a release

1. With Node.js available, run ./build.ps1 in PowerShell. It checks the manifests and scripts, runs the tests, and writes a versioned .mcaddon to dist.
2. For a new release, bump both header versions, their pack module versions and the behavior manifest's resource-pack dependency together. Leave the Script API dependency versions alone unless the code needs a different API.
3. Test on a copy of a world. On Samsung, import the .mcaddon and activate both packs. Join the hosted test world from Switch, verify the whistle/menu, then test the feature you changed together. Record the game versions and results in the changelog. Release the tested build from that commit.
