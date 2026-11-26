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
    await page.getByRole("button", { name: "Dimension new shapes" }).click();
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
};

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

/** What's drawn (shapes, dimensions, labels, link guides, a snap mark, the shape being drawn), with DRAWING_PAD round it. */
async function drawingBox(page) {
  const r = await page.evaluate(() => {
    const els = document.querySelectorAll(".canvas-area svg :is(g.shape, g.dimension, g.radius-label, g.link-guide, g.snap, .preview)");
    let box = null;
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      box = box
        ? { l: Math.min(box.l, b.left), t: Math.min(box.t, b.top), r: Math.max(box.r, b.right), b: Math.max(box.b, b.bottom) }
        : { l: b.left, t: b.top, r: b.right, b: b.bottom };
    }
    return box;
  });
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
