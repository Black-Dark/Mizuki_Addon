import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const accents = {
  blue: [88, 133, 250],
  aqua: [70, 207, 218],
  silver: [192, 202, 218],
  red: [240, 96, 104],
  gold: [244, 176, 72],
  rose: [231, 102, 173],
  lime: [133, 203, 97]
};

const textureNames = [
  ...Array.from({ length: 9 }, (_, slot) => "hotbar_" + slot),
  "hotbar_start_cap", "hotbar_end_cap", "selected_hotbar_slot",
  "heart", "heart_half", "heart_background",
  "experiencebarempty", "experiencebarfull", "experiencenub",
  "background_panel", "dialog_background_opaque", "dialog_background_opaque_overlap_bottom",
  "cell_image", "cell_image_darkgrey", "cell_image_normal",
  "highlight_slot", "pocket_ui_highlight_selected_slot", "pocket_ui_highlight_slot",
  "recipe_back_panel", "recipe_book_pane_bg", "recipe_book_item_bg", "recipe_book_touch_cell_selected",
  "player_preview_border", "arrow_active", "filled_progress_bar", "empty_progress_bar"
];

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, up, diagonal) {
  const estimate = left + up - diagonal;
  const leftError = Math.abs(estimate - left);
  const upError = Math.abs(estimate - up);
  const diagonalError = Math.abs(estimate - diagonal);
  if (leftError <= upError && leftError <= diagonalError) return left;
  return upError <= diagonalError ? up : diagonal;
}

function readRgba(png, name) {
  const header = png.subarray(16, 29);
  if (!png.subarray(0, 8).equals(signature) ||
      !header.subarray(8).equals(Buffer.from([8, 6, 0, 0, 0]))) {
    throw new Error(name + " must be an 8-bit non-interlaced RGBA PNG");
  }
  const stride = header.readUInt32BE(0) * 4;
  const height = header.readUInt32BE(4);
  const data = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const scan = inflateSync(Buffer.concat(data));
  if (scan.length !== (stride + 1) * height) throw new Error("Invalid scanlines in " + name);
  const rgba = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const start = row * stride;
    const filter = scan[row * (stride + 1)];
    if (filter > 4) throw new Error("Unknown PNG filter in " + name);
    for (let x = 0; x < stride; x++) {
      const index = start + x;
      const left = x >= 4 ? rgba[index - 4] : 0;
      const up = row > 0 ? rgba[index - stride] : 0;
      const diagonal = row > 0 && x >= 4 ? rgba[index - stride - 4] : 0;
      const prediction = [0, left, up, (left + up) >> 1, paeth(left, up, diagonal)][filter];
      rgba[index] = scan[row * (stride + 1) + 1 + x] + prediction;
    }
  }
  return { header, stride, height, rgba };
}

function chunk(type, payload) {
  const bytes = Buffer.concat([Buffer.from(type), payload]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE((~crc) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}

function tint(image, accent) {
  const { header, stride, height, rgba } = image;
  const scanlines = Buffer.alloc((stride + 1) * height);
  const accentLightness = 0.25 * accent[0] + 0.5 * accent[1] + 0.25 * accent[2];
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < stride; x += 4) {
      const source = row * stride + x;
      const dest = row * (stride + 1) + 1 + x;
      const alpha = rgba[source + 3];
      if (!alpha) continue;
      const lightness = 0.25 * rgba[source] + 0.5 * rgba[source + 1] + 0.25 * rgba[source + 2];
      const saturation = Math.min(lightness / accentLightness, (255 - lightness) / (255 - accentLightness), 0.85);
      for (let channel = 0; channel < 3; channel++) {
        scanlines[dest + channel] = Math.round(lightness + (accent[channel] - accentLightness) * saturation);
      }
      scanlines[dest + 3] = alpha;
    }
  }
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}

const resourceRoot = process.argv[2];
if (!resourceRoot) throw new Error("Pass the staged resource pack directory.");
const manifest = JSON.parse((await readFile(join(resourceRoot, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
const textures = await Promise.all(textureNames.map(async name => [
  name, readRgba(await readFile(join(resourceRoot, "textures", "ui", name + ".png")), name)
]));
for (const { folder_name: theme } of manifest.subpacks) {
  const output = join(resourceRoot, "subpacks", theme, "textures", "ui");
  await mkdir(output, { recursive: true });
  if (theme === "orchid") continue; // Amethyst inherits the original pack textures.
  const accent = accents[theme];
  if (!accent) throw new Error("Unknown UI palette: " + theme);
  await Promise.all(textures.map(async ([name, image]) => {
    await writeFile(join(output, name + ".png"), tint(image, accent));
  }));
}
