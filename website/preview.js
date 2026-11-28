const meters = [
  ['hearts', ['heart', 'heart', 'heart', 'heart', 'heart', 'heart', 'heart', 'heart', 'heart_half', 'heart_background']],
  ['hunger', [...Array(9).fill('hunger_full'), 'hunger_background']]
];
for (const [id, icons] of meters) {
  for (const icon of icons) {
    const image = new Image(18, 18);
    image.src = 'art/' + icon + '.png';
    image.alt = '';
    document.getElementById(id).append(image);
  }
}
const slots = document.getElementById('slots');
for (let index = 0; index < 9; index++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Slot ' + (index + 1));
  button.setAttribute('aria-pressed', String(index === 2));
  button.style.backgroundImage = 'url(art/hotbar_' + index + '.png)';
  button.addEventListener('click', () => {
    slots.querySelector('[aria-pressed="true"]').setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
  });
  slots.append(button);
}

const screens = {
  inventory: ['Inventory', 'Player inventory and personal crafting.'],
  crafting: ['Crafting table', 'The 3 × 3 crafting grid and output slot.'],
  furnace: ['Furnace', 'Regular furnaces, blast furnaces and smokers use the same palette.'],
  chest: ['Large chest', 'Single and double chests, trapped and Ender chests, shulker boxes and barrels.']
};
const picker = document.querySelector('.container-picker');
const preview = document.getElementById('container-preview');
function grid(count, columns) {
  const group = document.createElement('div');
  group.className = 'container-grid';
  group.style.gridTemplateColumns = 'repeat(' + columns + ',1fr)';
  for (let i = 0; i < count; i++) group.append(document.createElement('span'));
  return group;
}
function icon(name) {
  const image = new Image();
  image.src = 'art/' + name + '.png';
  image.alt = '';
  return image;
}
function showContainer(kind) {
  const [name, caption] = screens[kind];
  preview.replaceChildren();
  preview.setAttribute('aria-label', 'Illustrated ' + name.toLowerCase() + ' screen in lilac and charcoal');
  const title = document.createElement('strong');
  title.textContent = name;
  preview.append(title);
  if (kind === 'chest') {
    preview.append(grid(54, 9));
  } else {
    const workArea = document.createElement('div');
    workArea.className = 'work-area';
    if (kind === 'furnace') {
      const fuel = document.createElement('div');
      fuel.className = 'fuel';
      fuel.append(grid(1, 1), icon('flame_full_image'), grid(1, 1));
      workArea.append(fuel);
    } else {
      const size = kind === 'crafting' ? 3 : 2;
      workArea.append(grid(size * size, size));
    }
    workArea.append(icon('arrow_active'), grid(1, 1));
    preview.append(workArea);
  }
  const inventoryTitle = document.createElement('strong');
  inventoryTitle.textContent = 'Inventory slots';
  preview.append(inventoryTitle, grid(27, 9), grid(9, 9));
  document.getElementById('container-caption').textContent = 'Illustration. ' + caption;
  for (const button of picker.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.screen === kind));
  }
}
picker.addEventListener('click', event => {
  const button = event.target.closest('button[data-screen]');
  if (button) showContainer(button.dataset.screen);
});
showContainer('inventory');

const hudOptions = document.querySelector('.hud-options');
const hudReadouts = document.querySelector('.hud-readouts');
const companionSelect = document.getElementById('companion-theme');
const themeName = document.getElementById('theme-name');
let hudMode = 'off';
for (const [index, companion] of companionThemes.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = companion.name + ' · ' + companion.theme;
  companionSelect.append(option);
}
companionSelect.value = '0';
function renderHud() {
  const { voice, theme, swatch } = companionThemes[Number(companionSelect.value)];
  themeName.textContent = 'Theme: ' + theme;
  hudReadouts.style.setProperty('--companion-accent', swatch);
  hudReadouts.replaceChildren();
  function readout(label, value) {
    const line = document.createElement('div');
    const accent = document.createElement('strong');
    accent.textContent = label;
    line.append(accent, '  ' + value);
    hudReadouts.append(line);
  }
  if (hudMode === 'companion' || hudMode === 'both') readout(voice, 'Following  20 HP  6 blocks');
  if (hudMode === 'navigation' || hudMode === 'both') readout('NE', 'XYZ 128 / 64 / -32');
  hudReadouts.hidden = hudMode === 'off';
  for (const button of hudOptions.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.hud === hudMode));
  }
}
hudOptions.addEventListener('click', event => {
  const selected = event.target.closest('button[data-hud]');
  if (!selected) return;
  hudMode = selected.dataset.hud;
  renderHud();
});
companionSelect.addEventListener('change', () => {
  if (hudMode === 'off') hudMode = 'both';
  renderHud();
});
renderHud();
