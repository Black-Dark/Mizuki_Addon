# Mizuki Workshop

The starting point is the supplied Chibi_Companions_Mizuki-3.0.mcaddon. Its two internal pack versions are 2.3.0. The workshop keeps those manifests and gameplay files intact.

## Where to work

- behavior_pack/scripts: whistle, ownership, work areas, gathering and sorting
- behavior_pack/entities and items: companion and whistle definitions
- resource_pack: model, textures, animations and in-game text
- tests: inventory and terrain checks
- CHANGELOG.md: record what each release changes and which devices tested it

## Work together

Put this folder in a private Git repository and invite N7 Knight with write access. Keep the latest playable source on the main branch. Make each update on its own branch. Open a pull request so the other person can see the changes, run the build and check the result before merging. Keep the pack and module UUIDs stable for upgrades.

## Build a release

1. With Node.js available, run ./build.ps1 in PowerShell. It checks the manifests and scripts, runs the tests, and writes a versioned .mcaddon to dist.
2. For a new release, bump both header versions, their pack module versions and the behavior manifest's resource-pack dependency together. Leave the Script API dependency versions alone unless the code needs a different API.
3. Test on a copy of a world. On Samsung, import the .mcaddon and activate both packs. Join the hosted test world from Switch, verify the whistle/menu, then test the feature you changed together. Record the game versions and results in the changelog. Release the tested build from that commit.
