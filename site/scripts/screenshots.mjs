// Screenshots of the app for the docs.
//
// Starts the app's dev server on its own port, drives it in headless
// Chromium as a user would (keys, drags, typing), and saves 2× PNGs to
// src/assets/screenshots/. The docs show them through
// src/components/Screenshot.astro at half their pixel size.
//
// Run `pnpm screenshots` (here or at the repo root) after UI changes.
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
const VIEWPORT = { width: 1100, height: 720 };
/**
 * The window for everything after the full view: as narrow as the toolbar
 * goes (833 px), so the toolbar and status bar strips stay legible in the
 * docs column, with the file name close to the buttons.
 */
const NARROW = { width: 840, height: 720 };
/** Room around a floating panel's box for its shadow, CSS px; less than the gap between the palettes. */
const PAD = 8;

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

/**
 * Saves `name`.png: the whole page, a region ({x, y, width, height}), an
 * element, or an element with `pad` px around it for its shadow.
 */
async function shot(page, name, target = null, pad = 0) {
  const file = path.join(OUT, `${name}.png`);
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

/** Parks the pointer on the status bar's empty middle, away from anything with a hover state or tooltip. */
async function park(page) {
  const b = await page.locator(".status .grow").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(400);
}

/** The selection panel's number field labelled `label`. */
const field = (page, label) =>
  page.locator(".selection-panel label.row", { has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) }).locator("input");

async function main() {
  await mkdir(OUT, { recursive: true });
  const app = await startApp();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: "en-GB", colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(URL);
    await page.locator(".tool-palette").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await park(page);
    console.log("Saving:");

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
    const area = await page.locator(".canvas-area").boundingBox();
    const from = { x: area.x + area.width * 0.4, y: area.y + area.height * 0.3 };
    await page.keyboard.press("r");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 240, from.y + 160, { steps: 12 });
    await page.waitForTimeout(200);
    await shot(page, "status-bar", page.locator(".status"));
    await page.mouse.up();

    // Size it in the selection panel, as Getting started says.
    for (const [label, value] of [["width", "600"], ["height", "400"]]) {
      await field(page, label).click({ clickCount: 3 });
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
    }
    await page.evaluate(() => document.activeElement?.blur());
    await park(page);
    await shot(page, "selection-panel", page.locator(".selection-panel"), PAD);
  } finally {
    await browser.close();
    app.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
