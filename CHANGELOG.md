# Changelog

## 3.8.0

- Added eight manually selectable resource-pack palettes for the hotbar, health hearts, XP bar and container screens. Amethyst is the default. The companion HUD readouts continue to follow the selected skin automatically.

## 3.7.7

- Companion readouts appear by default for players without a saved HUD preference. Companion dialogue also uses the active skin’s accent, including the greeting after changing appearance.

## 3.7.6

- Added eight skin-matched accent palettes. Companion and Navigation readouts follow the active appearance, and the whistle menu lists its theme.

## 3.7.5

- Stretched the title-screen background to the full screen so wide phones no longer show the original panorama along the sides.

## 3.7.4

- Added an optional HUD with companion activity, health and distance, plus a compass and coordinates mode. Change the mode with the Snowdrop Whistle. Bed guidance takes priority over the readout.

## 3.7.3

- Added a twilight title-screen background and a charcoal-and-lilac button theme. Enable Mizuki Resources under Global Resources on mobile or Windows for the main menu.

## 3.7.2

- Matched the inventory, crafting table, furnace family and chest family to the Mizuki HUD palette using Bedrock container textures.

## 3.7.1

- Added the Mizuki HUD for Minecraft Bedrock. The charcoal hotbar, lilac selection and XP, and colour-coded health, hunger, and armour use the native HUD layout and controls.
- On Android or iOS, open the .mcaddon in Minecraft and activate the packs on your world. For Nintendo Switch, import on mobile or Windows and join a Realm running the packs from the Switch. Mobile and Switch gameplay still needs device verification.

## 3.7.0

- Craft a placeable Companion Workbench from a crafting table, a chest, and a copper ingot at a regular crafting table.
- Use the workbench to make Healing Salve, Guard Biscuits, and Camp Tags. It also accepts the existing Companion Treat and Companion Toy recipes.
## 3.6.5

- Preserve Stay and restore an appropriate pose when a saved companion loads. Repeated join events leave an active job in place.
- Isolate world-start recovery failures so another saved companion can still rejoin. Restore following on a successful whistle recall.
- Prevent a form from a disconnected session from handling input or unlocking a newer companion menu.



## 3.6.4

- Rebuilt all 50 archive appearances with hand-authored voxel designs and painted faces, outfits, and accessories based on Penney's references. Companion menu icons now show the actual in-game models.
- Added character-specific greetings, recall lines, supply reactions, and profile descriptions, with work and sorting replies matched to their personalities.
- Added subtle idle gestures for the archive personalities while keeping the six original appearances and the saved appearance indices.


## 3.6.3

- Combined the 3.6.2 roster, flight, bed guidance, gear recovery, defense and stay/follow with the separate moving, crafting, and building features.
- Combined a 36-slot regular backpack with 27 dedicated moving slots. Older packed items in the first 36 slots are accessible through Take supplies.
- Improved the workshop menu, safe build placement, and retention of recovered gear.
- Physical Bedrock playtesting is pending.

## 3.6.2

- Rebuilt the 50 archive chibis with solid bodies, articulated limbs, and more detailed textures based on their OC Hub artwork.
- Added separate archive movement and carrying animations. Limited head rotation and removed whole-body bouncing from the archive pickup and happy animations.

## 3.6.1

- Added 50 appearances based on OC Hub chibi artwork, for 56 selectable appearances.
- Removed Silas Clive, Caelum Veyr Clive, and Kaien Tsukishiro. Companions using those appearances display as Mizuki until the owner picks another appearance.
- Split Change Appearance into pages.

## 3.6.0

- Added Silas Clive, Caelum Veyr Clive, and Kaien Tsukishiro to Change Appearance.
- Added Stay here, Follow me, and Companion status to the Snowdrop Whistle menu.
- Calling a companion clears any stale defense chase after a successful recall.

## 3.5.2

- Increased companion backpacks from 9 to 36 slots for gathering and gear recovery.

## 3.5.1

- **Guide me to my bed** uses the player's Overworld bed respawn point. Set it by using a bed first.
- Companions now approach and strike the mob that hurt their owner using scripted retaliation. Compatible add-on mobs need a health component and must report themselves as the source of the hit.

## 3.5.0

- Nearby companions recover owner-attributed death drops when there is room in the backpack. Use **Take supplies** to retrieve recovered gear before automatic sorting resumes.
- Companions retaliate when a vanilla or add-on mob attacks their owner. They do not retaliate against players or other chibi companions.

## 3.4.0

- Added **Guide me home** to the companion menu. Companions lead players in short, walkable steps toward their personal respawn point or Overworld spawn.
- Guidance waits for the player and displays compass directions when terrain blocks progress. Use **Stop guiding** to resume normal companion behavior.

## 3.3.1

- Fixed Sora getting stuck at one-block ledges. He lines up his takeoff on the lower tile, and uses the regular climb animation if the game blocks his wing hop.

## 3.3.0

- Sora flaps over nearby ledges, low obstacles, and short gaps and lands on solid ground. His scheduled jobs use the wing hop for one-block climbs.
- Added checks for blocked flight paths and unsafe landings. The other five appearances retain their ground movement.
- In-game Bedrock playtesting is pending.

## 3.2.0

- Added a per-companion appearance picker with Mizuki, Sora, Yukishiro, Shion, Lucien, and Naoki.
- Polished character models and added distinct dialogue and idle gestures. Pickaxes appear during mining and axes during chopping.
- Preserved ownership, inventory, and the original companion abilities when changing appearance.
- Package and simulated multiplayer checks passed. In-game Bedrock playtesting is pending.

## 2.3.0

- Baseline recovered from the supplied Chibi_Companions_Mizuki-3.0.mcaddon.
- Checks available here cover inventory and terrain. Record Samsung and Switch playtest results before releasing another version.
