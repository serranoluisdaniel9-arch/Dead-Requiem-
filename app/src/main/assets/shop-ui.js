// Local, fictional-credit storefront. Gameplay and persistence stay with the caller.
let shopSequence = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const amount = value => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const number = value => amount(value).toLocaleString('es-ES');

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function svgNode(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function icon(type) {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const paths = {
    close: 'M6 6l12 12M18 6L6 18',
    wallet: 'M12 2l9 5v10l-9 5-9-5V7zM15 8h-4a4 4 0 000 8h4',
    ammo: 'M4 21V8l3-5 3 5v13zM14 21V8l3-5 3 5v13zM4 16h6M14 16h6',
    weapon: 'M3 7h18v5h-8l-3 8H5l3-8H3zM16 7V5M12 12v4h4v-4',
    attachment: 'M4 10h11v4H4zM15 12h5M7 10v4M10 10v4M13 10v4',
    skin: 'M8 3l4 3 4-3 6 6-4 4-2-2v10H8V11l-2 2-4-4z',
  };
  svg.append(svgNode('path', { d: paths[type] || paths.ammo }));
  return svg;
}

const WEAPON_SHAPES = {
  pistol: 'M38 27h160v24h-83l-11 36H72l11-36H38z',
  revolver: 'M39 34h154v15h-62l-10 9h-18l-11 29H64l13-37H39z',
  smg: 'M30 30h150v20h-40l-6 10h-16l-8 30H58l10-40H30z',
  shotgun: 'M26 32h186v16h-96l-8 8h-14l-10 30H52l12-38H26z',
  rifle: 'M22 34h196v14h-104l-6 8h-12l-9 28H48l11-36H22z',
  compact: 'M40 34h150v16h-70l-8 8h-14l-9 26H60l11-34H40z',
  carbine: 'M24 32h180v18h-70l-6 9h-14l-9 30H52l11-39H24z',
  marksman: 'M18 35h204v12h-118l-5 7h-11l-8 26H44l10-33H18z',
  burst: 'M26 31h172v19h-58l-6 9h-14l-9 29H54l11-38H26z',
  magnum: 'M36 33h158v17h-64l-9 10h-17l-12 31H62l14-41H36z',
  pump: 'M24 32h188v17h-98l-8 8h-14l-10 30H50l12-38H24z',
  lmg: 'M20 30h196v22h-72l-7 10h-16l-10 32H48l12-42H20z',
};

function weaponPreview(item) {
  const svg = svgNode('svg', { viewBox: '0 0 240 100', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgNode('path', {
    d: WEAPON_SHAPES[item.id] || WEAPON_SHAPES.pistol,
    fill: 'currentColor', opacity: '.8',
  }));
  svg.append(svgNode('path', {
    d: 'M45 34h142M117 54v13h22V51M79 66l18 5M76 75l18 5',
    fill: 'none', stroke: '#a9b6ab', 'stroke-width': '2', opacity: '.6',
  }));
  if (item.id === 'revolver') {
    svg.append(svgNode('rect', { x: 94, y: 29, width: 32, height: 27, rx: 8, fill: '#9ba6a0' }));
    svg.append(svgNode('path', { d: 'M103 32v21M115 32v21', stroke: '#34413e', 'stroke-width': 3 }));
  }
  if (item.id === 'smg') {
    svg.append(svgNode('rect', { x: 96, y: 50, width: 14, height: 34, rx: 2, fill: '#8d9a92' }));
  }
  if (item.id === 'shotgun') {
    svg.append(svgNode('path', { d: 'M40 40h150M40 46h150', stroke: '#8d9a92', 'stroke-width': 3 }));
  }
  if (item.id === 'rifle') {
    svg.append(svgNode('rect', { x: 96, y: 22, width: 46, height: 9, rx: 4, fill: '#8d9a92' }));
  }
  if (item.id === 'compact') {
    svg.append(svgNode('path', { d: 'M44 40h140M44 46h140', stroke: '#8d9a92', 'stroke-width': 3 }));
  }
  if (item.id === 'carbine') {
    svg.append(svgNode('rect', { x: 92, y: 50, width: 13, height: 30, rx: 2, fill: '#8d9a92' }));
    svg.append(svgNode('rect', { x: 100, y: 24, width: 34, height: 7, rx: 3, fill: '#8d9a92' }));
  }
  if (item.id === 'marksman') {
    svg.append(svgNode('rect', { x: 88, y: 20, width: 62, height: 10, rx: 5, fill: '#8d9a92' }));
    svg.append(svgNode('path', { d: 'M150 25h44', stroke: '#8d9a92', 'stroke-width': 4 }));
  }
  if (item.id === 'burst') {
    svg.append(svgNode('rect', { x: 90, y: 50, width: 12, height: 32, rx: 2, fill: '#8d9a92' }));
    svg.append(svgNode('path', { d: 'M96 26h40', stroke: '#8d9a92', 'stroke-width': 5 }));
  }
  if (item.id === 'magnum') {
    svg.append(svgNode('rect', { x: 92, y: 28, width: 34, height: 28, rx: 9, fill: '#9ba6a0' }));
    svg.append(svgNode('path', { d: 'M126 40h58', stroke: '#8d9a92', 'stroke-width': 5 }));
  }
  if (item.id === 'pump') {
    svg.append(svgNode('path', { d: 'M36 40h158M36 46h158', stroke: '#8d9a92', 'stroke-width': 3 }));
    svg.append(svgNode('rect', { x: 96, y: 50, width: 30, height: 9, rx: 3, fill: '#8d9a92' }));
  }
  if (item.id === 'lmg') {
    svg.append(svgNode('rect', { x: 88, y: 52, width: 26, height: 22, rx: 3, fill: '#8d9a92' }));
    svg.append(svgNode('path', { d: 'M60 66l-8 14M150 66l8 14', stroke: '#8d9a92', 'stroke-width': 3 }));
  }
  return svg;
}

/** Attachment glyph: a small schematic of the part, not a generic icon. */
function attachmentPreview(item) {
  const svg = svgNode('svg', { viewBox: '0 0 120 60', 'aria-hidden': 'true', focusable: 'false' });
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round' };
  const shapes = {
    suppressor: [['rect', { x: 18, y: 24, width: 62, height: 14, rx: 7, ...stroke }],
      ['path', { d: 'M80 31h22M28 24v14M40 24v14M52 24v14M64 24v14', ...stroke }]],
    heavyBarrel: [['path', { d: 'M14 30h74M88 22v16M14 24v12', ...stroke }],
      ['path', { d: 'M30 30h10M48 30h10M66 30h10', ...stroke }]],
    optic: [['rect', { x: 26, y: 20, width: 68, height: 20, rx: 9, ...stroke }],
      ['circle', { cx: 60, cy: 30, r: 6, ...stroke }], ['path', { d: 'M40 40v8M80 40v8', ...stroke }]],
    extendedMag: [['path', { d: 'M44 12h32v40H44z', ...stroke }],
      ['path', { d: 'M44 24h32M44 36h32', ...stroke }]],
    stock: [['path', { d: 'M20 22h44l24 8-24 8H20z', ...stroke }],
      ['path', { d: 'M64 30h34', ...stroke }]],
  };
  for (const [tag, attributes] of shapes[item.id] || shapes.optic) svg.append(svgNode(tag, attributes));
  return svg;
}

function color(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${Math.max(0, Math.min(0xffffff, Math.trunc(value))).toString(16).padStart(6, '0')}`;
  }
  return typeof value === 'string' && /^(#[\da-f]{3,8}|[a-z]+)$/i.test(value)
    ? value : fallback;
}

function survivorPreview(skin) {
  const svg = svgNode('svg', { viewBox: '0 0 120 160', 'aria-hidden': 'true', focusable: 'false' });
  const jacket = color(skin.jacket, '#405c68');
  const pants = color(skin.pants, '#493d39');
  const hair = color(skin.hair, '#302c29');
  const backpack = color(skin.backpack, '#6e5b43');
  const style = ['crimson', 'olive', 'reborn'].includes(skin.id) ? skin.id : 'survivor';
  const reborn = style === 'reborn';
  const olive = style === 'olive';
  const crimson = style === 'crimson';
  // Original vector drawings: each outfit has its own cut, hair and carried kit.
  const shapes = [
    ['ellipse', { cx: 60, cy: 149, rx: 31, ry: 4, fill: '#000', opacity: '.32' }],
    ['circle', { cx: 60, cy: 64, r: 43, fill: 'none', stroke: '#a8c8b4', opacity: '.11' }],
  ];
  if (reborn) {
    shapes.push(['path', { d: 'M45 34C38 5 75 2 77 26l-2 18-8 3-18-3z', fill: hair }]);
  } else if (crimson) {
    shapes.push(['path', { d: 'M70 17c19-6 18 16 12 25l-2 17-7-9 3-18-8-6z', fill: hair }]);
    shapes.push(['rect', { x: 38, y: 55, width: 43, height: 34, rx: 8, fill: backpack }]);
  } else if (olive) {
    shapes.push(['path', { d: 'M46 33c-8-29 31-32 30-6l-4 18H49z', fill: hair }]);
  } else {
    shapes.push(['path', { d: 'M70 24c16-2 18 12 8 21l-7-4 5-8-8-1z', fill: hair }]);
    shapes.push(['rect', { x: 34, y: 52, width: 46, height: 44, rx: 9, fill: backpack }]);
    shapes.push(['path', { d: 'M36 72h8v17h-8M75 72h4v17h-4', fill: 'none', stroke: '#191f21', opacity: '.35' }]);
  }
  shapes.push(
    ['path', { d: reborn ? 'M45 91h30l-1 23-2 28H60l-1-33-5 33H42l2-30z' : 'M45 91h31l-3 51H60l-1-33-4 33H42z', fill: pants }],
    ['path', { d: reborn ? 'M43 134h11v10l-3 4H36v-4l7-4zM61 134h11v7l7 4v4H60z' : 'M42 139h13v9H38v-5zM61 139h12l7 9H61z', fill: reborn ? '#795039' : '#292e2c' }],
    ['path', { d: 'M39 148h15M61 148h17', fill: 'none', stroke: '#141b1d', 'stroke-width': 2 }],
    ['path', { d: 'M48 102l-2 31M68 102l-1 31M45 98l8 5M65 103l7-5', fill: 'none', stroke: '#b8b9a8', 'stroke-width': 1, opacity: '.22' }],
  );
  if (olive) {
    shapes.push(
      ['path', { d: 'M44 49l-9 5-5 23 10 3 9-19M74 49l9 5 5 23-10 3-9-19', fill: jacket }],
      ['path', { d: 'M31 77l8 2-3 18-2 9-7-2 2-11zM79 79l8-2 4 17 1 10-7 2-3-10z', fill: '#bd997e' }],
      ['path', { d: 'M30 73l11 3-2 6-11-3zM77 76l11-3 2 6-11 3z', fill: '#a3a57b' }],
    );
  } else {
    shapes.push(
      ['path', { d: reborn ? 'M47 48l-10 6-9 39 10 4 10-31M72 48l10 6 9 39-10 4-9-31' : 'M45 49l-8 5-9 39 9 3 12-30M73 49l9 5 9 39-9 3-12-30', fill: jacket }],
      ['path', { d: 'M29 94l8 2-1 6-3 5-6-3zM82 96l8-2 2 10-6 3-3-5z', fill: '#bd997e' }],
      ['path', { d: 'M30 91l8 2M81 93l8-2', fill: 'none', stroke: '#151c20', 'stroke-width': 2, opacity: '.6' }],
    );
  }
  shapes.push(
    ['path', { d: reborn ? 'M51 47h17l8 12-6 22 5 17H43l5-17-5-22z' : 'M50 46h18l9 11-7 27 5 15H43l5-15-6-27z', fill: reborn ? '#e3e0d6' : jacket }],
    ['path', { d: 'M54 39h12v11l-6 7-6-7z', fill: '#b88f76' }],
  );
  if (reborn) {
    shapes.push(
      ['path', { d: 'M50 47l-9 8 4 24-4 20 12-2 1-21 3-20zM68 47l10 8-5 23 4 21-11-2-2-22-1-19z', fill: jacket }],
      ['path', { d: 'M49 48l-6 12 8 7-3-11 9 8-3-13zM69 48l7 12-8 7 3-11-8 8 2-13z', fill: '#414648' }],
      ['path', { d: 'M56 51l4 6 5-6M59 60v34M46 84l5-3M69 81l5 3', fill: 'none', stroke: '#9ba39c', 'stroke-width': 1 }],
      ['path', { d: 'M45 97h29v4H45z', fill: '#75583c' }],
      ['rect', { x: 57, y: 96, width: 7, height: 6, rx: 1, fill: '#a4aaa1' }],
    );
  } else if (crimson) {
    shapes.push(
      ['path', { d: 'M51 43l8 7 10-7 4 11-13 9-13-9z', fill: jacket }],
      ['path', { d: 'M51 44l8 8 10-8M60 55v41M44 89h30M46 68h9M66 68h7', fill: 'none', stroke: '#d0b5a2', 'stroke-width': 1, opacity: '.55' }],
      ['path', { d: 'M43 87h32v5H43z', fill: '#333639' }],
      ['rect', { x: 58, y: 87, width: 5, height: 5, fill: '#ac9d7e' }],
    );
  } else {
    shapes.push(
      ['path', { d: 'M50 48l9 10-9 5-5-9zM68 48l-9 10 10 5 5-9z', fill: olive ? '#7e8457' : '#587582' }],
      ['path', { d: 'M59 59v36M46 86h26M48 65h7v9h-8M64 65h8v9h-7', fill: 'none', stroke: '#d2d7b5', 'stroke-width': 1, opacity: '.4' }],
    );
    if (olive) {
      shapes.push(
        ['path', { d: 'M47 51l27 40', fill: 'none', stroke: backpack, 'stroke-width': 3 }],
        ['rect', { x: 70, y: 85, width: 15, height: 18, rx: 4, fill: backpack }],
        ['path', { d: 'M71 89h13l-6 6z', fill: '#797460' }],
      );
    } else {
      shapes.push(['path', { d: 'M45 52l7 2-3 29M73 52l-6 2 3 29', fill: 'none', stroke: backpack, 'stroke-width': 4 }]);
    }
  }
  shapes.push(
    ['path', { d: 'M48 25c0-15 25-16 25 0l-2 11-5 7-7 2-7-5-3-7z', fill: '#c7a087' }],
    ['path', { d: 'M50 31l3 1M65 32l4-1M59 32l-1 5 3 1M56 40l6 1 3-1', fill: 'none', stroke: '#886957', 'stroke-width': 1 }],
    ['path', { d: 'M51 29l4-1M65 28l4 1', fill: 'none', stroke: hair, 'stroke-width': 1.2 }],
    ['path', { d: 'M52 31h2M66 31h2', fill: 'none', stroke: '#37444a', 'stroke-width': 1.4 }],
  );
  if (reborn) {
    shapes.push(
      ['path', { d: 'M45 32C39 11 55 6 64 10c13 2 16 16 12 28l-4 6-3-6 2-12c-9-1-14-6-15-9-1 10-7 15-9 25l-4-3z', fill: hair }],
      ['path', { d: 'M56 15c3 6 9 9 16 10M52 16c0 8-5 14-6 20M63 13c6 2 10 6 11 12M73 30l-1 9', fill: 'none', stroke: '#e2cd95', 'stroke-width': 1, opacity: '.55' }],
    );
  } else if (olive) {
    shapes.push(
      ['path', { d: 'M46 31c-5-22 27-29 29-7l-2 12-5-15-7-3-11 15-1 7z', fill: hair }],
      ['path', { d: 'M72 37c-9 7 5 11-2 16s6 9 0 14l5 4c9-7-3-11 3-17s-6-10 0-16z', fill: hair }],
      ['path', { d: 'M72 43l4 3-4 4 4 4-4 5 3 4', fill: 'none', stroke: '#ad8054', 'stroke-width': 1, opacity: '.6' }],
      ['path', { d: 'M70 67h6', stroke: '#b4b590', 'stroke-width': 2 }],
    );
  } else {
    shapes.push(['path', { d: crimson ? 'M47 31c-5-24 26-29 28-9l-3 13-5-16-13 4-6 14z' : 'M46 31c-5-24 25-29 28-8l-2 12-5-15-13 3-6 14z', fill: hair }]);
    shapes.push(['path', { d: crimson ? 'M73 22l7 2' : 'M73 29l6 3', stroke: crimson ? '#a87e77' : '#b2aa88', 'stroke-width': 2 }]);
  }
  for (const [tag, attributes] of shapes) svg.append(svgNode(tag, attributes));
  return svg;
}

function catalogItems(catalog) {
  return Object.entries(catalog || {}).map(([key, item]) => ({
    ...item, id: String(item.id || key), price: amount(item.price),
  }));
}

/** Turns an attachment's effect map into the short lines the card prints. */
function effectLinesFor(item) {
  const labels = {
    noise: 'Ruido', damage: 'Daño', aggro: 'Atracción', moveScale: 'Movilidad',
    recoil: 'Retroceso', aimZoom: 'Zoom', spread: 'Dispersión', aimRange: 'Alcance',
    magazine: 'Cargador', reload: 'Recarga',
  };
  return Object.entries(item.effects || {}).map(([key, effect]) => {
    const label = labels[key] || key;
    if (effect.mul !== undefined) {
      const percent = Math.round((effect.mul - 1) * 100);
      return `${label} ${percent > 0 ? '+' : ''}${percent}%`;
    }
    return `${label} ${effect.add > 0 ? '+' : ''}${effect.add}`;
  });
}

/**
 * Builds once; render only updates text, action states and selected markers.
 * The caller owns profile mutations, saving and overlay visibility.
 */
export function createShop({ container, weapons, skins, attachments, attachmentsFor, onAction, onClose }) {
  if (!container || typeof onAction !== 'function' || typeof onClose !== 'function') {
    throw new TypeError('La tienda necesita un contenedor y sus acciones.');
  }
  const prefix = `d09-shop-${++shopSequence}`;
  const weaponItems = catalogItems(weapons);
  const skinItems = catalogItems(skins);
  const attachmentItems = catalogItems(attachments).map(item => ({
    ...item, effectLines: effectLinesFor(item),
  }));
  const compatibleWith = typeof attachmentsFor === 'function' ? attachmentsFor : () => [];
  // One ammo entry per weapon: buying rounds is per-gun, with its own stock cap.
  const ammoItems = weaponItems.map(weapon => ({
    id: weapon.id,
    name: `${weapon.name} · munición`,
    price: amount(weapon.ammo.price),
    amount: amount(weapon.ammo.amount),
    maxPacks: amount(weapon.ammo.maxPacks),
    label: weapon.ammo.label,
    weaponName: weapon.name,
  }));
  const cards = [];
  const tabs = [];
  const panels = [];
  let currentProfile = null;
  let pending = null;
  let cooldownKey = '';
  let cooldownUntil = 0;
  let cooldownTimer;
  let activeTab = 0;

  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  container.setAttribute('aria-labelledby', `${prefix}-title`);
  const shell = node('div', 'shop-shell');
  const header = node('header', 'shop-header');
  const heading = node('div', 'shop-heading');
  heading.append(node('span', 'shop-eyebrow', 'DSR / PREPARACIÓN DE SALIDA'));
  const title = node('h2', 'shop-title', 'Tienda del refugio');
  title.id = `${prefix}-title`;
  heading.append(title);
  const wallet = node('div', 'shop-wallet');
  wallet.append(icon('wallet'));
  const walletText = node('div', 'shop-wallet-text');
  const balance = node('strong', 'shop-balance', '0');
  walletText.append(balance, node('span', '', 'CRÉDITOS'));
  wallet.append(walletText);
  const close = node('button', 'shop-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar tienda y volver');
  close.append(icon('close'));
  close.addEventListener('click', onClose);
  header.append(heading, wallet, close);
  const guide = node('p', 'shop-guide', 'Prepara tu equipo entre salidas. Solo créditos ficticios, sin dinero real.');
  const tablist = node('div', 'shop-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Categorías de la tienda');
  const content = node('div', 'shop-panels');
  const footer = node('footer', 'shop-footer');
  const message = node('p', 'shop-message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.setAttribute('aria-atomic', 'true');
  const storage = node('p', 'shop-storage');
  footer.append(message, storage);

  function chooseTab(index, focus = false) {
    activeTab = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  }

  ['Suministros', 'Armas', 'Acoples', 'Aspectos'].forEach((label, index) => {
    const tab = node('button', 'shop-tab');
    tab.type = 'button';
    tab.id = `${prefix}-tab-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${prefix}-panel-${index}`);
    tab.append(icon(['ammo', 'weapon', 'attachment', 'skin'][index]), node('span', '', label));
    tab.addEventListener('click', () => chooseTab(index));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        chooseTab(next, true);
      }
    });
    const panel = node('section', `shop-panel shop-panel-${index}`);
    panel.id = `${prefix}-panel-${index}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    tabs.push(tab);
    panels.push(panel);
    tablist.append(tab);
    content.append(panel);
  });

  function panelHeading(panel, titleText, note) {
    const top = node('div', 'shop-panel-heading');
    top.append(node('h3', '', titleText), node('p', '', note));
    panel.append(top);
  }
  panelHeading(panels[0], 'Para la próxima salida', 'Las reservas se consumen al empezar.');
  panelHeading(panels[1], 'Elige tu arma', 'Cada arma cambia el daño, el cargador y el ruido.');
  panelHeading(panels[2], 'Acoples del arma equipada', 'Un acople por ranura. Se montan y se quitan sin coste.');
  panelHeading(panels[3], 'La misma superviviente. Tu estilo.', 'Cada aspecto cambia tus estadísticas: elige el precio.');

  function card(kind, item, grid) {
    const element = node('article', `shop-card shop-card-${kind}`);
    const top = node('div', 'shop-card-top');
    const state = node('span', 'shop-card-state');
    const price = node('span', 'shop-price', item.price ? `${number(item.price)} CR` : 'DE SERIE');
    top.append(state, price);
    const preview = node('div', `shop-preview shop-preview-${kind}`);
    if (kind === 'skin') preview.append(survivorPreview(item));
    else if (kind === 'weapon') preview.append(weaponPreview(item));
    else if (kind === 'attachment') preview.append(attachmentPreview(item));
    else preview.append(icon('ammo'));
    const body = node('div', 'shop-card-body');
    const name = node('h4', 'shop-card-name', item.name);
    body.append(name);
    const button = node('button', 'shop-action');
    button.type = 'button';
    button.dataset.shopAction = '';
    button.dataset.kind = kind;
    button.dataset.id = item.id;
    button.disabled = true;
    element.append(top, preview, body, button);
    grid.append(element);
    const entry = { kind, item, element, body, state, button };
    cards.push(entry);
    return entry;
  }

  const ammoGrid = node('div', 'shop-card-grid shop-grid-ammo');
  panels[0].append(ammoGrid);
  const ammoEntries = [];
  ammoItems.forEach(item => {
    const entry = card('ammo', item, ammoGrid);
    entry.body.append(node('p', 'shop-description', `+${item.amount} balas para ${item.weaponName}.`));
    const queued = node('p', 'shop-queued');
    entry.body.append(queued);
    ammoEntries.push({ ...entry, queued });
  });
  const ammoNote = node('div', 'shop-ammo-note');
  const loadout = node('strong', 'shop-loadout');
  ammoNote.append(
    node('span', 'shop-eyebrow', 'MUNICIÓN DE SALIDA'),
    loadout,
    node('p', '', 'Cada arma tiene su propia munición y su tope. No es un banco: lo que compras se gasta al empezar la salida.'),
  );
  panels[0].append(ammoNote);
  const weaponGrid = node('div', 'shop-card-grid shop-grid-weapons');
  panels[1].append(weaponGrid);
  weaponItems.forEach(item => {
    const entry = card('weapon', item, weaponGrid);
    const stats = node('dl', 'shop-stats');
    [
      ['Cargador', `${amount(item.magazine)}`],
      ['Daño', `${amount(item.damage)}`],
      ['Recarga', `${Number(item.reload).toLocaleString('es-ES')} s`],
      ['Ruido', `${amount(item.noise)} m`],
    ].forEach(([label, value]) => {
      const stat = node('div', 'shop-stat');
      stat.append(node('dt', '', label), node('dd', '', value));
      stats.append(stat);
    });
    entry.body.append(stats);
  });
  // --- attachments: only what the equipped weapon can mount ---------------
  const attachmentGrid = node('div', 'shop-card-grid shop-grid-attachments');
  panels[2].append(attachmentGrid);
  const attachmentNote = node('div', 'shop-ammo-note');
  const attachmentWeapon = node('strong', 'shop-loadout');
  attachmentNote.append(
    node('span', 'shop-eyebrow', 'ARMA EQUIPADA'),
    attachmentWeapon,
    node('p', '', 'Los acoples se guardan por arma. Cambiar de arma no pierde lo montado.'),
  );
  panels[2].append(attachmentNote);
  const attachmentEntries = [];
  attachmentItems.forEach(item => {
    const entry = card('attachment', item, attachmentGrid);
    entry.body.append(node('p', 'shop-description', item.summary || ''));
    const effects = node('ul', 'shop-effects');
    for (const line of (item.effectLines || [])) {
      effects.append(node('li', '', line));
    }
    entry.body.append(effects);
    const slot = node('p', 'shop-queued');
    entry.body.append(slot);
    attachmentEntries.push({ ...entry, slot });
  });
  const skinGrid = node('div', 'shop-card-grid shop-grid-skins');
  panels[3].append(skinGrid);
  skinItems.forEach(item => {
    const entry = card('skin', item, skinGrid);
    const swatches = node('div', 'shop-swatches');
    swatches.setAttribute('aria-hidden', 'true');
    ['jacket', 'pants', 'backpack'].forEach(key => {
      const swatch = node('span', 'shop-swatch');
      swatch.style.backgroundColor = color(item[key], '#405c68');
      swatches.append(swatch);
    });
    entry.body.append(node('p', 'shop-description', item.tension || 'Aspecto cosmético'), swatches);
    if (item.modifiers) {
      const mods = node('dl', 'shop-stats shop-stats-skin');
      const rows = [
        ['Vitales', item.modifiers.health ? `${item.modifiers.health > 0 ? '+' : ''}${item.modifiers.health}` : '—'],
        ['Velocidad', item.modifiers.speed ? `${item.modifiers.speed > 0 ? '+' : ''}${Math.round(item.modifiers.speed * 100)}%` : '—'],
        ['Daño', item.modifiers.damage ? `${item.modifiers.damage > 0 ? '+' : ''}${Math.round(item.modifiers.damage * 100)}%` : '—'],
      ];
      rows.forEach(([label, value]) => {
        const stat = node('div', 'shop-stat');
        stat.append(node('dt', '', label), node('dd', '', value));
        mods.append(stat);
      });
      entry.body.append(mods);
    }
  });
  shell.append(header, guide, tablist, content, footer);
  // replaceChildren is newer than the Android 11 emulator's WebView 83.
  container.textContent = '';
  container.append(shell);
  chooseTab(0);

  function stateFor(entry) {
    const { kind, item } = entry;
    if (!currentProfile) return { disabled: true, label: 'No disponible', state: '' };
    const credits = amount(currentProfile.credits);
    if (kind === 'ammo') {
      const weapon = weapons[item.id];
      if (!weapon) return { disabled: true, label: 'No disponible', state: '' };
      if (!Array.isArray(currentProfile.ownedWeapons) || !currentProfile.ownedWeapons.includes(item.id)) {
        return { disabled: true, label: 'Necesitas el arma', state: 'BLOQUEADO' };
      }
      const cap = item.amount * item.maxPacks;
      const held = amount(currentProfile.ammo && currentProfile.ammo[item.id]);
      if (held >= cap) return { disabled: true, label: 'Munición al máximo', state: 'LÍMITE' };
    }
    if (kind === 'attachment') {
      const weaponId = currentProfile.weapon;
      const weapon = weapons[weaponId];
      const fits = Array.isArray(item.compatible) && item.compatible.includes(weaponId);
      if (!fits) {
        return { disabled: true, label: `No encaja en ${weapon ? weapon.name : 'esta arma'}`, state: 'INCOMPATIBLE' };
      }
      const owned = Array.isArray(currentProfile.ownedAttachments) &&
        currentProfile.ownedAttachments.includes(item.id);
      const mounted = Array.isArray(currentProfile.attachments && currentProfile.attachments[weaponId]) &&
        currentProfile.attachments[weaponId].includes(item.id);
      if (mounted) {
        return { disabled: false, action: 'unequip', selected: true, label: 'Quitar', state: 'MONTADO' };
      }
      if (owned) {
        return { disabled: false, action: 'mount', selected: false, label: 'Montar', state: 'EN PROPIEDAD' };
      }
      const affordable = credits >= item.price;
      return {
        disabled: !affordable, action: 'buy', selected: false,
        label: affordable ? 'Comprar' : `Faltan ${number(item.price - credits)} CR`,
        state: 'SIN ADQUIRIR',
      };
    }
    if (kind !== 'ammo') {
      const owned = kind === 'weapon' ? currentProfile.ownedWeapons : currentProfile.ownedSkins;
      if (Array.isArray(owned) && owned.includes(item.id)) {
        const selected = currentProfile[kind] === item.id;
        return {
          disabled: selected, action: 'equip', selected,
          label: selected ? (kind === 'weapon' ? 'Equipada' : 'Equipado') : 'Equipar',
          state: selected ? 'EN USO' : 'EN PROPIEDAD',
        };
      }
    }
    const affordable = credits >= item.price;
    return {
      disabled: !affordable, action: 'buy', selected: false,
      label: affordable ? (kind === 'ammo' ? 'Comprar reserva' : 'Comprar y equipar') : `Faltan ${number(item.price - credits)} CR`,
      state: kind === 'ammo' ? 'CONSUMIBLE' : 'SIN ADQUIRIR',
    };
  }

  function refreshActions() {
    cards.forEach(entry => {
      const state = stateFor(entry);
      const key = `${entry.kind}:${entry.item.id}`;
      const cooling = key === cooldownKey && Date.now() < cooldownUntil;
      entry.button.disabled = state.disabled || pending !== null || cooling;
      entry.button.textContent = state.label;
      entry.button.dataset.action = state.action || '';
      entry.button.setAttribute('aria-label', `${entry.item.name}: ${state.label}`);
      if (entry.kind !== 'ammo' && state.action === 'equip') {
        entry.button.setAttribute('aria-pressed', String(Boolean(state.selected)));
      } else entry.button.removeAttribute('aria-pressed');
      entry.element.dataset.selected = String(Boolean(state.selected));
      entry.state.textContent = state.state;
    });
  }

  container.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('button[data-shop-action]');
    if (!button || !container.contains(button) || button.disabled || pending !== null) return;
    const entry = cards.find(candidate => candidate.button === button);
    if (!entry) return;
    const state = stateFor(entry);
    if (state.disabled || !state.action) return;
    const key = `${entry.kind}:${entry.item.id}`;
    if (key === cooldownKey && Date.now() < cooldownUntil) return;
    pending = key;
    cooldownKey = key;
    cooldownUntil = Date.now() + 450;
    refreshActions();
    clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(refreshActions, 460);
    try {
      onAction(entry.kind, entry.item.id, state.action);
    } catch (error) {
      pending = null;
      refreshActions();
      throw error;
    }
  });

  container.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== 'Tab') return;
    // Keep keyboard navigation inside the active modal, without stealing focus on render.
    const stops = [close, tabs[activeTab], panels[activeTab], ...cards
      .filter(entry => panels[activeTab].contains(entry.button) && !entry.button.disabled)
      .map(entry => entry.button)];
    const index = stops.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      stops[stops.length - 1].focus();
    } else if (!event.shiftKey && (index === stops.length - 1 || index < 0)) {
      event.preventDefault();
      stops[0].focus();
    }
  });

  return {
    render(profile, { persisted = true, message: announcement = '' } = {}) {
      currentProfile = profile;
      pending = null;
      balance.textContent = number(profile.credits);
      wallet.setAttribute('aria-label', `Saldo: ${number(profile.credits)} créditos ficticios`);
      const held = amount(profile.ammo && profile.ammo[profile.weapon]);
      ammoEntries.forEach(entry => {
        const stock = amount(profile.ammo && profile.ammo[entry.item.id]);
        const cap = entry.item.amount * entry.item.maxPacks;
        entry.queued.textContent = `En reserva: ${stock} / ${cap} balas`;
      });
      const weapon = weapons[profile.weapon];
      loadout.textContent = weapon
        ? `${weapon.name}: ${weapon.startReserve + held} balas de salida`
        : 'Sin arma equipada';
      const mountedIds = (profile.attachments && profile.attachments[profile.weapon]) || [];
      attachmentWeapon.textContent = weapon
        ? `${weapon.name} · ${mountedIds.length} acople${mountedIds.length === 1 ? '' : 's'} montado${mountedIds.length === 1 ? '' : 's'}`
        : 'Sin arma equipada';
      attachmentEntries.forEach(entry => {
        const fits = Array.isArray(entry.item.compatible) &&
          entry.item.compatible.includes(profile.weapon);
        const mounted = mountedIds.includes(entry.item.id);
        entry.slot.textContent = !fits
          ? 'No compatible con el arma equipada'
          : mounted ? 'Montado ahora mismo' : `Ranura: ${entry.item.slot}`;
      });
      message.textContent = String(announcement || '');
      storage.textContent = persisted
        ? 'Guardado en este navegador o app'
        : 'Solo esta sesión: almacenamiento no disponible';
      storage.classList.toggle('shop-storage-warning', !persisted);
      refreshActions();
    },
  };
}
