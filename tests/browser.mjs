// Shared setup for the browser smoke tests. They drive a running app (npm run dev) and
// expect the example data of the Diff3F checkout (cricket meshes, descriptors, benchmark).
//
//   APP_URL             app address (default http://127.0.0.1:5180)
//   PLAYWRIGHT_CHANNEL  use an installed browser, e.g. msedge or chrome, instead of
//                       Playwright's Chromium (npx playwright install chromium)
//   SCREENSHOT_DIR      where screenshots go (default: a folder in the system temp dir)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export const baseUrl = process.env.APP_URL || "http://127.0.0.1:5180";
export const screenshotDir = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "bugnist-app-smoke");
fs.mkdirSync(screenshotDir, { recursive: true });

// Software WebGL (SwiftShader) so the three.js viewers render without a GPU.
export function launchBrowser() {
  return chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
}

// Collect uncaught page errors, console errors and failed requests for the final assertions.
export function watchPage(page) {
  const errors = [];
  const failedResponses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  return { errors, failedResponses };
}
