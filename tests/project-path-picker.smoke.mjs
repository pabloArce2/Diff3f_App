import assert from "node:assert/strict";
import path from "node:path";
import { baseUrl, launchBrowser, screenshotDir, watchPage } from "./browser.mjs";

const browser = await launchBrowser();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const { errors: pageErrors, failedResponses } = watchPage(page);

  await page.goto(`${baseUrl}/#/match`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Feature Correspondences" }).waitFor();
  assert.equal(await page.locator("button.browse-button").count(), 36, "not every rendered pipeline path has a picker");

  const sourceGeometry = page.getByLabel("Source geometry", { exact: true }).first();
  await sourceGeometry.fill("manual\\still-editable.obj");
  assert.equal(await sourceGeometry.inputValue(), "manual\\still-editable.obj", "manual path entry stopped working");
  await sourceGeometry.fill("meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj");

  await page.getByRole("button", { name: "Browse Source geometry" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Source geometry" });
  await dialog.waitFor();
  const brownCricket = dialog.locator(".entry-row").filter({ hasText: "BrownCricket_rotated.obj" });
  await brownCricket.waitFor();
  assert.equal(await brownCricket.getAttribute("aria-pressed"), "true", "current file was not preselected");

  await dialog.getByPlaceholder("Search this folder").fill("BrownCricket");
  assert.equal(await brownCricket.isVisible(), true, "file search hid the matching file");
  assert.equal(await dialog.locator(".entry-row").filter({ hasText: "preprocessed" }).count(), 0, "folder search did not filter entries");
  await brownCricket.click();
  await dialog.getByRole("button", { name: "Use file" }).click();
  assert.equal(
    await sourceGeometry.inputValue(),
    "meshes\\bugnist_crickets\\bcrick_10_010\\BrownCricket_rotated.obj",
    "chosen project path was not written back to the form",
  );

  await page.getByRole("button", { name: "Browse Source features" }).click();
  const featureDialog = page.getByRole("dialog", { name: "Source features" });
  await featureDialog.waitFor();
  await featureDialog.locator(".entry-row").filter({ hasText: "BrownCricket_rotated_diff3f.pt" }).waitFor();
  const visibleFileNames = await featureDialog.locator(".entry-row:not(.directory) .entry-name").allTextContents();
  assert.ok(visibleFileNames.length > 0, "feature picker did not list descriptor files");
  assert.ok(visibleFileNames.every((name) => name.toLowerCase().endsWith(".pt")), "feature picker leaked another file type");
  await page.keyboard.press("Escape");
  await featureDialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Browse Output folder" }).first().click();
  const folderDialog = page.getByRole("dialog", { name: "Output folder" });
  await folderDialog.waitFor();
  const useFolder = folderDialog.getByRole("button", { name: "Use this folder" });
  await page.waitForFunction(() => {
    const button = document.querySelector('[role="dialog"] .confirm-button');
    return button && !button.disabled;
  });
  assert.equal(await useFolder.isEnabled(), true);
  assert.equal(await folderDialog.locator(".entry-row:not(.directory)").count(), 0, "folder mode should only show folders");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Descriptors" }).click();
  const meshCard = page.locator("article.panel").filter({ has: page.getByRole("heading", { name: "Mesh Diff3F Descriptors" }) });
  await meshCard.getByRole("button", { name: "Camel example" }).click();
  const meshCapture = meshCard.getByLabel("Capture images from this descriptor run");
  assert.equal(await meshCapture.isChecked(), true, "camel preset did not enable same-run image capture");
  assert.equal(await meshCard.getByLabel("Mesh", { exact: true }).inputValue(), "meshes\\camel.obj");
  assert.equal(await meshCard.getByLabel("TOSCA scaling (camel/cow meshes)").isChecked(), true);
  await meshCard.getByLabel("Image/debug folder", { exact: true }).waitFor();
  await meshCard.getByLabel("Views to capture").fill("0 2-3");
  assert.equal(await meshCard.getByLabel("Skip existing").isDisabled(), true, "capture should force a fresh descriptor run");
  assert.equal(
    await meshCard.getByRole("button", { name: "Compute descriptors + capture images" }).isVisible(),
    true,
    "combined descriptor action was not exposed",
  );
  await page.screenshot({ path: path.join(screenshotDir, "descriptor-capture-query.png"), fullPage: true });

  let submittedRun = null;
  await page.route("**/api/jobs/picker-smoke-job", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "picker-smoke-job", label: "Test descriptor capture", status: "running", log: "" }),
    });
  });
  await page.route("**/api/run", async (route) => {
    submittedRun = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "picker-smoke-job", status: "running" }),
    });
  });
  await meshCard.getByRole("button", { name: "Compute descriptors + capture images" }).click();
  await page.waitForFunction(() => window.location.hash === "#/jobs");
  assert.equal(submittedRun.step, "meshFeatures");
  assert.equal(submittedRun.params.captureImages, true);
  assert.equal(submittedRun.params.debugOutdir, "debug\\descriptor_runs\\camel");
  assert.equal(submittedRun.params.debugViews, "0 2-3");
  assert.equal(submittedRun.params.tosca, true);
  await page.unroute("**/api/run");

  await page.getByRole("button", { name: "Descriptors" }).click();
  const pointCard = page.locator("article.panel").filter({ has: page.getByRole("heading", { name: "Point-Cloud Diff3F Descriptors" }) });
  await pointCard.getByLabel("Capture images from this descriptor run").check();
  await pointCard.getByLabel("Image/debug folder", { exact: true }).waitFor();
  assert.equal(await pointCard.getByLabel("Skip existing").isDisabled(), true);

  const plyCard = page.locator("article.panel").filter({ has: page.getByRole("heading", { name: "Export Descriptor Colors To PLY" }) });
  await plyCard.getByRole("button", { name: "Camel example" }).click();
  assert.equal(await plyCard.getByLabel("Original mesh", { exact: true }).inputValue(), "meshes\\camel.obj");
  assert.equal(
    await plyCard.getByLabel("Descriptor .pt", { exact: true }).inputValue(),
    "output\\camel_features_debug_4v_256\\camel_diff3f.pt",
  );
  assert.equal(
    await plyCard.getByLabel("Output colored PLY", { exact: true }).inputValue(),
    "visualizations\\camel_features_debug_4v_256\\camel_diff3f_pca.ply",
  );

  submittedRun = null;
  await page.route("**/api/run", async (route) => {
    submittedRun = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "picker-smoke-job", status: "running" }),
    });
  });
  await plyCard.getByRole("button", { name: "Generate colored PLY" }).click();
  await page.waitForFunction(() => window.location.hash === "#/jobs");
  assert.equal(submittedRun.step, "visualizeMeshFeatures");
  assert.equal(submittedRun.params.mesh, "meshes\\camel.obj");
  assert.equal(submittedRun.params.features, "output\\camel_features_debug_4v_256\\camel_diff3f.pt");
  await page.unroute("**/api/run");

  await page.getByRole("button", { name: "Descriptors" }).click();
  await plyCard.getByRole("button", { name: "Point cloud", exact: true }).click();
  await plyCard.getByLabel("Original point cloud", { exact: true }).waitFor();
  assert.equal(await plyCard.getByRole("button", { name: "Point cloud", exact: true }).getAttribute("aria-pressed"), "true");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    captureWidth: document.querySelector(".capture-options.active")?.getBoundingClientRect().width || 0,
  }));
  assert.ok(mobileLayout.overflow <= 1, `descriptor capture UI overflows mobile width by ${mobileLayout.overflow}px`);
  assert.ok(mobileLayout.captureWidth > 250, "descriptor capture controls collapsed on mobile");
  await page.screenshot({ path: path.join(screenshotDir, "descriptor-capture-query-mobile.png"), fullPage: true });

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(failedResponses, [], `failed responses: ${failedResponses.join(" | ")}`);
  console.log(`Project path picker and descriptor-capture smoke test passed. Screenshot: ${screenshotDir}`);
} finally {
  await browser.close();
}
