// Screenshots of the app for the docs.
//
// Starts the app's dev server on its own port, drives it in headless
// Chromium as a user would (keys, drags, typing), and saves 2× PNGs to
// src/assets/screenshots/. The docs show them through
// src/components/Screenshot.astro at half their pixel size.
//
// Each scene makes the pictures for one docs page, each in a fresh browser
// (a new, empty drawing and no remembered settings). Run them all with
// `pnpm screenshots` (here, or `pnpm screenshots:site` at the repo root)
// after UI changes, or name some: `pnpm screenshots drawing-shapes`.
// Needs Playwright's Chromium once per machine: `pnpm exec playwright install chromium`.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SITE, "..");
const OUT = path.join(SITE, "src/assets/screenshots");
const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const WIDE = { width: 1100, height: 720 };
/**
 * The window for everything but the full view: as narrow as the toolbar
 * goes (833 px), so the toolbar and status bar strips stay legible in the
 * docs column, with the file name close to the buttons.
 */
const NARROW = { width: 840, height: 720 };
/** Room around a floating panel's box for its shadow, CSS px; less than the gap between the palettes. */
const PAD = 8;
/** Room around a crop of the drawing, CSS px. */
const DRAWING_PAD = 20;

// ---- Scenes: one per docs page ----

const SCENES = {
  /** The app's parts, kept at the top level: other pages may use them too. */
  async "getting-started"(open) {
    const page = await open(WIDE);
    // As it opens: an empty, untitled drawing.
    await shot(page, "app");

    await page.setViewportSize(NARROW);
    await park(page);
    await shot(page, "toolbar", page.locator(".toolbar"));
    await shot(page, "tool-palette", page.locator(".tool-palette"), PAD);

    // The rulers' corner, with the palettes out of the way.
    const hide = await page.addStyleTag({ content: ".palette { visibility: hidden; }" });
    const frame = await page.locator(".canvas-frame").boundingBox();
    await shot(page, "rulers", { x: frame.x, y: frame.y, width: 420, height: 240 });
    await hide.evaluate((el) => el.remove());

    // Two layers, so there's something to tell apart.
    await page.getByRole("button", { name: "Add a layer" }).click();
    await park(page);
    await shot(page, "layer-palette", page.locator(".layer-palette"), PAD);

    // Draw a rectangle, catching the status bar mid-drag.
    await page.keyboard.press("r");
    await drag(page, [260, 160], [500, 320], { release: false });
    await shot(page, "status-bar", page.locator(".status"));
    await page.mouse.up();

    // Size it in the selection panel, as Getting started says.
    await setFields(page, { width: "600", height: "400" });
    await shot(page, "selection-panel", page.locator(".selection-panel"), PAD);
  },

  async "drawing-shapes"(open) {
    // A line, a rectangle and a circle, each with the dimensions it gets.
    let page = await open(NARROW);
    await draw(page, "l", [130, 300], [290, 180]);
    await draw(page, "r", [350, 170], [550, 310]);
    await draw(page, "c", [660, 240], [710, 240]);
    await shot(page, "drawing-shapes/shapes", await drawingBox(page));

    // A line's end snapping to the middle of a rectangle's top edge, mid-drag.
    page = await open(NARROW);
    await noDimensions(page);
    await draw(page, "r", [330, 240], [590, 400]);
    await page.keyboard.press("l");
    await drag(page, [190, 130], [463, 243], { release: false });
    await shot(page, "drawing-shapes/snap", await drawingBox(page));
    await page.mouse.up();

    // Properties › Grid.
    page = await open(NARROW);
    await page.getByRole("button", { name: "Properties…" }).click();
    await page.getByRole("tab", { name: "Grid" }).click();
    await park(page);
    await shot(page, "drawing-shapes/grid-settings", page.locator(".properties-dialog"));

    // A line's and a circle's panels: a 3-4-5 line, 100 mm long, and a 50 mm circle.
    page = await open(NARROW);
    await draw(page, "l", [140, 360], [300, 240], { deselect: false });
    await park(page);
    await shot(page, "drawing-shapes/line-panel", page.locator(".selection-panel"), PAD);
    await page.keyboard.press("Escape");
    await draw(page, "c", [300, 460], [350, 460], { deselect: false });
    await park(page);
    await shot(page, "drawing-shapes/circle-panel", page.locator(".selection-panel"), PAD);
  },

  async paths(open) {
    // Part way through: four nodes placed, the next segment following the pointer.
    let page = await open(NARROW);
    await page.keyboard.press("p");
    await clickPath(page, ARCH.slice(0, 4));
    const next = await at(page, ARCH[4].at);
    await page.mouse.move(next.x + 6, next.y + 4, { steps: 8 });
    await page.waitForTimeout(150);
    await shot(page, "paths/drawing", await drawingBox(page));

    // The finished arch, its smooth top node selected: handles and card.
    page = await open(NARROW);
    await drawArch(page);
    await shot(page, "paths/panel", page.locator(".selection-panel"), PAD);
    await clickAt(page, ARCH[3].at);
    await park(page);
    await shot(page, "paths/node", await drawingBox(page));

    // Its bottom segment selected.
    page = await open(NARROW);
    await drawArch(page);
    await clickAt(page, [(ARCH[0].at[0] + ARCH[1].at[0]) / 2, ARCH[0].at[1]]);
    await park(page);
    await shot(page, "paths/segment", await drawingBox(page));
  },

  async text(open) {
    // Typing on the drawing, straight after dragging out the box.
    let page = await open(NARROW);
    await addText(page, ...textBox(200), MEANING, { finish: false });
    await shot(page, "text/typing", await drawingBox(page));

    // The finished box's panel.
    await finishText(page);
    await shot(page, "text/panel", page.locator(".selection-panel"), PAD);

    // The same text in each font.
    page = await open(NARROW);
    for (const [i, font] of ["Sans", "Serif", "Mono"].entries()) {
      await addText(page, ...textBox(120 + i * 90), MEANING);
      await panelButton(page, font);
      await deselect(page);
    }
    await shot(page, "text/fonts", await drawingBox(page));

    // Plain, then mirrored.
    page = await open(NARROW);
    await addText(page, ...textBox(160), MEANING);
    await deselect(page);
    await addText(page, ...textBox(260), MEANING);
    await field(page, "mirrored").click();
    await deselect(page);
    await shot(page, "text/mirrored", await drawingBox(page));
  },

  async "selecting-and-editing"(open) {
    // A lasso round the rectangle and circle but not the line: those two select as it goes.
    let page = await open(NARROW);
    await noDimensions(page);
    await draw(page, "r", [120, 200], [220, 280]);
    await draw(page, "c", [300, 240], [340, 240]);
    await draw(page, "l", [400, 280], [480, 200]);
    await drag(page, [90, 170], [370, 310], { release: false });
    await shot(page, "selecting-and-editing/lasso", await drawingBox(page));
    await page.mouse.up();

    // Each kind selected on its own, with its handles.
    for (const [kind, key, from, to] of [
      ["rect", "r", [200, 260], [320, 340]],
      ["circle", "c", [260, 300], [300, 300]],
      ["line", "l", [200, 340], [320, 260]],
    ]) {
      page = await open(NARROW);
      await noDimensions(page);
      await draw(page, key, from, to, { deselect: false });
      await shot(page, `selecting-and-editing/handles-${kind}`, await drawingBox(page));
    }

    // A rectangle part way through a turn by its rotate handle, 20° clockwise.
    page = await open(NARROW);
    await noDimensions(page);
    await draw(page, "r", [200, 260], [400, 380], { deselect: false });
    const h = await page.locator(".rotate-handle").boundingBox();
    const centre = await at(page, [300, 320]);
    const grip = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    const reach = centre.y - grip.y, turn = (20 * Math.PI) / 180;
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + reach * Math.sin(turn), centre.y - reach * Math.cos(turn), { steps: 12 });
    await page.waitForTimeout(150);
    await shot(page, "selecting-and-editing/turning", await drawingBox(page));
    await page.mouse.up();
  },

  async dimensions(open) {
    // Dimension new shapes in the toolbar, on as it starts, with its tooltip.
    let page = await open(NARROW);
    await toolbarButton(page, "dimensions/toolbar-button", "Dimension new shapes");

    // The Dimension tool: the top edge clicked, the width dimension following the pointer up.
    page = await open(NARROW);
    await noDimensions(page);
    await draw(page, "r", [200, 240], [400, 340]);
    await page.keyboard.press("d");
    await clickAt(page, [300, 240]);
    const up = await at(page, [300, 196]);
    await page.mouse.move(up.x, up.y, { steps: 8 });
    await page.waitForTimeout(150);
    await shot(page, "dimensions/placing", await drawingBox(page));

    // A rectangle's height dimension selected and dragged further out.
    page = await open(NARROW);
    await draw(page, "r", [260, 240], [460, 340]);
    const label = page.locator(".canvas-area svg g.dimension text", { hasText: /^50$/ });
    const b = await label.boundingBox();
    const grip = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.click(grip.x, grip.y);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x - 40, grip.y, { steps: 10 });
    await page.mouse.up();
    await park(page);
    await shot(page, "dimensions/selected", await drawingBox(page));

    // Radius labels: all four corners alike ("4× R10"), then each on its own.
    page = await open(NARROW);
    await noDimensions(page);
    await draw(page, "r", [140, 220], [340, 340], { deselect: false });
    await setInput(page, page.getByLabel("Radius of all corners"), "10");
    await page.getByLabel("Label the radius").click();
    await deselect(page);
    await shot(page, "dimensions/radius-all", await drawingBox(page));

    page = await open(NARROW);
    await noDimensions(page);
    await draw(page, "r", [140, 220], [340, 340], { deselect: false });
    await page.getByLabel("Same radius on all corners").click();
    for (const [corner, r] of [["top-left", "20"], ["top-right", "10"], ["bottom-right", "10"], ["bottom-left", "0"]]) {
      await setInput(page, page.getByLabel(`${corner} radius`, { exact: true }), r);
      if (r !== "0") await page.getByLabel(`Label the ${corner} radius`).click();
    }
    await page.evaluate(() => document.activeElement?.blur());
    await park(page);
    await shot(page, "dimensions/corners-panel", page.locator(".selection-panel"), PAD);
    await deselect(page);
    await shot(page, "dimensions/radius-each", await drawingBox(page));
  },

  async links(open) {
    const page = await open(NARROW);
    await noDimensions(page);
    for (const [i, [centre, edge]] of HOLES.entries()) {
      await draw(page, "c", centre, edge, { deselect: i > 0 });
      // Only the first, the reference, gets a dimension: its "= hole" shows the link.
      if (i === 0) {
        await page.locator(".selection-panel").getByRole("checkbox", { name: "diameter" }).click();
        await deselect(page);
      }
    }

    // All five selected, the first as reference: the arrange panel.
    await selectAt(page, HOLES.map(([, edge]) => edge));
    await shot(page, "links/arrange-panel", page.locator(".selection-panel"), PAD);

    // Linked: middles aligned, gaps equal, diameters through a variable named "hole".
    await page.getByLabel("Keep linked").check();
    await page.getByRole("button", { name: "Align centres vertically" }).click();
    await page.getByRole("button", { name: "Gaps ↔" }).click();
    page.once("dialog", (d) => d.accept("hole"));
    await page.locator(".selection-panel").getByRole("button", { name: "Diameter", exact: true }).click();
    await deselect(page);
    await shot(page, "links/linked", await drawingBox(page));

    // Properties › Variables.
    await page.getByRole("button", { name: "Properties…" }).click();
    await page.getByRole("tab", { name: "Variables" }).click();
    await park(page);
    await shot(page, "links/variables", page.locator(".properties-dialog"));
    await page.keyboard.press("Escape");

    // The reference's panel: its diameter linked to hole.
    const first = await page.locator(".canvas-area svg g.shape").first().boundingBox();
    await page.mouse.click(first.x + first.width - 1, first.y + first.height / 2);
    await park(page);
    await shot(page, "links/linked-panel", page.locator(".selection-panel"), PAD);
    await deselect(page);

    // The guide clicked between the middle holes, clear of the dimension: its remove-link button.
    const [third, fourth] = await Promise.all([2, 3].map((i) => page.locator(".canvas-area svg g.shape").nth(i).boundingBox()));
    await page.mouse.click((third.x + third.width + fourth.x) / 2, first.y + first.height / 2);
    await park(page);
    await shot(page, "links/remove", await drawingBox(page));
  },

  async layers(open) {
    // Three layers: 1 locked, 3 hidden, 2 current with a colour and its card open.
    let page = await open(NARROW);
    await page.getByRole("button", { name: "Add a layer" }).click();
    await page.getByRole("button", { name: "Add a layer" }).click();
    await setLayer(page, 0, { name: "Board", lock: true });
    await setLayer(page, 2, { name: "Notes", hide: true });
    await setLayer(page, 1, { name: "Holes", colour: "Navy" });
    await page.locator(".layer-button").nth(1).click();
    await park(page);
    await shot(page, "layers/palette", await around(page, [".layer-palette", ".layer-card"]));

    // Its look picked from the one button.
    await page.locator(".layer-card .look-button").click();
    await park(page);
    await shot(page, "layers/look", await around(page, [".layer-palette", ".layer-card", ".look-picker"]));

    // A sand-filled board on layer 1, holes on layer 2 in navy with a sky fill and lines,
    // one over the board's edge.
    page = await open(NARROW);
    await noDimensions(page);
    await setLayer(page, 0, { fill: "Sand" });
    await draw(page, "r", [140, 200], [460, 360]);
    await page.getByRole("button", { name: "Add a layer" }).click();
    await setLayer(page, 1, { colour: "Navy", fill: "Sky", pattern: "Lines" });
    for (const [centre, edge] of [[[220, 280], [250, 280]], [[330, 280], [360, 280]], [[460, 300], [490, 300]]]) {
      await draw(page, "c", centre, edge);
    }
    await shot(page, "layers/fills", await drawingBox(page));

    // Moving a shape between layers: the selection panel's Layer menu, open.
    page = await open(NARROW);
    await noDimensions(page);
    await setLayer(page, 0, { name: "Board" });
    await draw(page, "r", [140, 200], [460, 360]);
    await page.getByRole("button", { name: "Add a layer" }).click();
    await setLayer(page, 1, { name: "Holes" });
    await draw(page, "c", [300, 280], [330, 280], { deselect: false });
    // A native menu opens outside the page, where no screenshot reaches; as a list box it's in the page.
    await page.locator(".selection-panel .layer-select").evaluate((el) => { el.size = el.options.length; });
    await park(page);
    await shot(page, "layers/layer-menu", page.locator(".selection-panel"), PAD);
  },
};

/**
 * Saves a toolbar button in context: hovered until its tooltip shows,
 * cropped to it and `around` controls either side, with the tooltip.
 */
async function toolbarButton(page, name, label, around = 2) {
  const controls = page.locator(".toolbar").locator("button, select");
  const labels = await controls.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const i = labels.indexOf(label);
  if (i < 0) throw new Error(`No toolbar button "${label}"`);
  const button = controls.nth(i);
  const first = await controls.nth(Math.max(0, i - around)).boundingBox();
  const last = await controls.nth(Math.min(labels.length - 1, i + around)).boundingBox();
  const bar = await page.locator(".toolbar").boundingBox();
  await button.hover();
  const tip = page.locator(".tooltip");
  await tip.waitFor({ state: "visible" });
  await page.waitForTimeout(200);
  const t = await tip.boundingBox();
  // Take in the tooltip, then whole controls wherever an edge would cut one.
  // The margin is 8 px, or half the gap to the next control if that's less.
  const boxes = await controls.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right }; }));
  let left = Math.min(first.x, t.x), right = Math.max(last.x + last.width, t.x + t.width);
  for (const b of boxes) {
    if (b.l < left && b.r > left) left = b.l;
    if (b.l < right && b.r > right) right = b.r;
  }
  const before = Math.max(bar.x, ...boxes.filter((b) => b.r <= left).map((b) => b.r));
  const after = Math.min(bar.x + bar.width, ...boxes.filter((b) => b.l >= right).map((b) => b.l));
  const x = left - Math.min(8, (left - before) / 2), end = right + Math.min(8, (after - right) / 2);
  await shot(page, name, { x, y: bar.y, width: end - x, height: t.y + t.height + 8 - bar.y });
}

/**
 * Holes for the Links page: centre and a point on the edge, drawing-area
 * px. Drawn unevenly (heights, sizes, gaps) so linking has work to do.
 */
const HOLES = [
  [[140, 300], [160, 300]], [[230, 290], [260, 290]], [[320, 310], [340, 310]],
  [[400, 290], [430, 290]], [[480, 300], [500, 300]],
];

/** Clicks shapes at these points in turn, Shift-clicking all but the first: the first is the reference. */
async function selectAt(page, points) {
  for (const [i, point] of points.entries()) {
    if (i) await page.keyboard.down("Shift");
    await clickAt(page, point);
    if (i) await page.keyboard.up("Shift");
  }
  await park(page);
}

/**
 * Sets up layer `i` (0-based) through its card: name, look (Line colour,
 * Fill and Pattern swatches by name), and hidden or locked. Leaves the
 * card closed and the layer current.
 */
async function setLayer(page, i, { name, colour, fill, pattern, hide, lock } = {}) {
  await deselect(page);
  await page.locator(".layer-button").nth(i).click();
  const card = page.locator(".layer-card");
  if (name) {
    await setInput(page, card.getByPlaceholder(`Layer ${i + 1}`), name);
  }
  const look = Object.entries({ "Line colour": colour, Fill: fill, Pattern: pattern }).filter(([, v]) => v);
  if (look.length) {
    await card.locator(".look-button").click();
    for (const [group, swatch] of look) {
      await page.locator(".look-picker").getByRole("group", { name: group }).getByRole("button", { name: swatch, exact: true }).click();
    }
    await page.keyboard.press("Escape");
  }
  if (lock) await card.getByRole("button", { name: /^Lock layer/ }).click();
  if (hide) await card.getByRole("button", { name: "Hide layer" }).click();
  await deselect(page);
}

/** A region round several elements, with `pad` px: for a palette and the card beside it. */
async function around(page, selectors, pad = PAD) {
  const boxes = await Promise.all(selectors.map((s) => page.locator(s).boundingBox()));
  const l = Math.min(...boxes.map((b) => b.x)), t = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width)), b = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: l - pad, y: t - pad, width: r - l + 2 * pad, height: b - t + 2 * pad };
}

/** Types a value into a field and leaves it with Tab, which applies it. */
async function setInput(page, input, value) {
  await input.click({ clickCount: 3 });
  await page.keyboard.type(value);
  await page.keyboard.press("Tab");
}

/** Turns off Dimension new shapes, for pictures about the shapes themselves. */
async function noDimensions(page) {
  await page.getByRole("button", { name: "Dimension new shapes" }).click();
  await park(page);
}

/** The text for the Text page's boxes: the name, and what it means. */
const MEANING = ["Delinya (Cornish / Kernewek):", "vi/vt. to draw or represent"];

/**
 * A text box's drag at `top`: 180 × 10 mm (at 2 px/mm the grid, and so
 * snapping, is every 5 mm), wide enough for MEANING's lines in Mono at
 * 10 mm, and left of where the selection panel sits.
 */
const textBox = (top) => [[120, top], [480, top + 20]];

/**
 * Draws a text box with the Text tool and types `lines` into it on the
 * drawing; `finish: false` leaves it being typed into. Finishing (Escape)
 * sets a round 10 mm size in the panel and leaves the box selected.
 */
async function addText(page, from, to, lines, { finish = true } = {}) {
  await page.keyboard.press("t");
  await drag(page, from, to);
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  if (finish) await finishText(page);
  await park(page);
}

/** Finishes typing on the drawing, then sets the box's size to 10 mm. */
async function finishText(page) {
  await page.keyboard.press("Escape");
  await setFields(page, { size: "10" });
}

/** Deselects: out of any field first, since a focused field keeps Escape to itself. */
async function deselect(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
  await park(page);
}

/** Presses a button in the selection panel by its name. */
const panelButton = (page, name) => page.locator(".selection-panel").getByRole("button", { name, exact: true }).click();

/**
 * An arch: square bottom corners, a smooth node at the top of a curved
 * head. Drawing-area px; wide enough that the top node's card clears the
 * corner below it, and left of where the selection panel sits.
 */
const ARCH = [
  { at: [120, 460] }, { at: [480, 460] }, { at: [480, 280] }, { at: [300, 180], smooth: true }, { at: [120, 280] },
];

/** Clicks path nodes in (the Path tool already picked); Shift-click for smooth ones. */
async function clickPath(page, nodes) {
  for (const n of nodes) {
    if (n.smooth) await page.keyboard.down("Shift");
    await clickAt(page, n.at);
    if (n.smooth) await page.keyboard.up("Shift");
  }
}

/** Draws ARCH, closing it on its first node; it's left selected. */
async function drawArch(page) {
  await page.keyboard.press("p");
  await clickPath(page, ARCH);
  await clickAt(page, ARCH[0].at);
  await park(page);
}

/** Clicks a point in the drawing area. */
async function clickAt(page, point) {
  const p = await at(page, point);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}

// ---- Driving the app ----

/** A point in the drawing area, CSS px from its top-left corner, as page coordinates. */
async function at(page, [x, y]) {
  const b = await page.locator(".canvas-area").boundingBox();
  return { x: b.x + x, y: b.y + y };
}

/** Drags in the drawing area between two of its points; `release: false` stops mid-drag. */
async function drag(page, from, to, { release = true } = {}) {
  const a = await at(page, from), b = await at(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.waitForTimeout(150);
  if (release) await page.mouse.up();
}

/**
 * Draws with a tool's key; then deselects (Escape) unless `deselect: false`,
 * which leaves the panel up. Parks the pointer after, so nothing is left
 * hovered.
 */
async function draw(page, key, from, to, { deselect = true } = {}) {
  await page.keyboard.press(key);
  await drag(page, from, to);
  if (deselect) await page.keyboard.press("Escape");
  await park(page);
}

/** Types values into the selection panel's fields by label, then leaves the last field. */
async function setFields(page, values) {
  for (const [label, value] of Object.entries(values)) {
    await field(page, label).click({ clickCount: 3 });
    await page.keyboard.type(value);
    await page.keyboard.press("Tab");
  }
  await page.evaluate(() => document.activeElement?.blur());
  await park(page);
}

/** The selection panel's number field labelled `label`. */
const field = (page, label) =>
  page.locator(".selection-panel label.row", { has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) }).locator("input");

/** Parks the pointer on the status bar's empty middle, away from anything with a hover state or tooltip. */
async function park(page) {
  const b = await page.locator(".status .grow").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(400);
}

/** What a crop of the drawing takes in: drawn things, and the cards that float by them. */
const DRAWN = [
  "svg g.shape", "svg g.dimension", "svg g.radius-label", "svg g.link-guide", "svg g.snap", "svg .preview",
  "svg g.draft-nodes", "svg g.path-nodes", "svg g.handles", "svg g.rotate", "svg .lasso", ".path-card", ".text-editor", ".delink",
].join(", ");

/**
 * What's drawn (shapes, dimensions, labels, link guides, a snap mark, the
 * shape being drawn, a path's nodes and card), with DRAWING_PAD round it.
 */
async function drawingBox(page) {
  const r = await page.evaluate((drawn) => {
    const els = document.querySelectorAll(`.canvas-area :is(${drawn})`);
    let box = null;
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      box = box
        ? { l: Math.min(box.l, b.left), t: Math.min(box.t, b.top), r: Math.max(box.r, b.right), b: Math.max(box.b, b.bottom) }
        : { l: b.left, t: b.top, r: b.right, b: b.bottom };
    }
    return box;
  }, DRAWN);
  if (!r) throw new Error("Nothing drawn to crop to");
  const area = await page.locator(".canvas-area").boundingBox();
  const x = Math.max(area.x, r.l - DRAWING_PAD), y = Math.max(area.y, r.t - DRAWING_PAD);
  const right = Math.min(area.x + area.width, r.r + DRAWING_PAD), bottom = Math.min(area.y + area.height, r.b + DRAWING_PAD);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Saves `name`.png (a path under OUT): the whole page, a region
 * ({x, y, width, height}), an element, or an element with `pad` px
 * around it for its shadow.
 */
async function shot(page, name, target = null, pad = 0) {
  const file = path.join(OUT, `${name}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  if (!target) {
    await page.screenshot({ path: file });
  } else if (!("screenshot" in target)) {
    await page.screenshot({ path: file, clip: target });
  } else if (!pad) {
    await target.screenshot({ path: file });
  } else {
    const b = await target.boundingBox();
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    await page.screenshot({ path: file, clip: { x, y, width: b.x + b.width + pad - x, height: b.y + b.height + pad - y } });
  }
  console.log(`  ${path.relative(SITE, file)}`);
}

// ---- Running ----

async function startApp() {
  const proc = spawn("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort"], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The dev server didn't start within 30 s")), 30_000);
      const onData = (chunk) => {
        if (process.env.SCREENSHOT_DEBUG) process.stdout.write(`[vite] ${chunk}`);
        // Vite styles "Local" even with FORCE_COLOR=0: strip the escapes first.
        if (/Local:/.test(chunk.toString().replace(/\x1b\[[0-9;]*m/g, ""))) { clearTimeout(timer); resolve(); }
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`The dev server exited (${code}); is port ${PORT} free?`)); });
    });
  } catch (e) {
    proc.kill("SIGTERM");
    throw e;
  }
  return proc;
}

async function main() {
  const names = process.argv.slice(2);
  const unknown = names.filter((n) => !(n in SCENES));
  if (unknown.length) throw new Error(`No scene ${unknown.join(", ")}; scenes: ${Object.keys(SCENES).join(", ")}`);
  const app = await startApp();
  const browser = await chromium.launch();
  try {
    /** A fresh page on the app in its own context: an empty drawing, nothing remembered. */
    const open = async (viewport) => {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "en-GB", colorScheme: "light" });
      const page = await context.newPage();
      await page.goto(URL);
      await page.locator(".tool-palette").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await park(page);
      return page;
    };
    for (const name of names.length ? names : Object.keys(SCENES)) {
      console.log(`${name}:`);
      await SCENES[name](open);
    }
  } finally {
    await browser.close();
    app.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
