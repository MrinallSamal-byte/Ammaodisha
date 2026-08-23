import { expect, test } from "@playwright/test";
import { pinOdia } from "../helpers/lang";

test.beforeEach(async ({ page }) => {
  test.setTimeout(30_000);
  await pinOdia(page);
});

async function dismissIntro(page: import("@playwright/test").Page) {
  await page.locator(".intro-explore-link").click().catch(() => undefined);
}

test("language toggle renders the control dock in Odia", async ({ page }) => {
  await page.goto("/");
  const filterButton = page.locator(".filter-button");
  await expect(filterButton).toContainText("ଫିଲଟର", { timeout: 30_000 });
  await expect(page.locator(".lang-toggle-button")).toHaveText("EN");
});

test("report form shows the Odia step-1 heading", async ({ page }) => {
  await page.goto("/");
  const introCta = page.locator(".intro-report-cta");
  await expect(introCta).toBeVisible({ timeout: 30_000 });
  await introCta.click();
  const formSheet = page.locator(".form-sheet");
  await expect(formSheet).toBeVisible();
  await expect(formSheet.locator(".form-header strong")).toHaveText("ଆବର୍ଜନା କେଉଁଠି?");
  await expect(formSheet.locator(".form-header .eyebrow")).toHaveText("ଆବର୍ଜନା ରିପୋର୍ଟ");
});

test("about sheet opens with an Odia heading", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);
  await page.getByRole("button", { name: "ଆମା ଓଡ଼ିଶା ପରିଚୟ" }).click();
  const aboutDialog = page.locator(".top-sheet");
  await expect(aboutDialog).toBeVisible();
  await expect(aboutDialog.getByRole("heading", { name: "ଆମା ଓଡ଼ିଶା କାହିଁକି?" })).toBeVisible();
});

test("list view header translates to Odia", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);
  await page.getByRole("button", { name: "ତାଲିକା", exact: true }).first().click();
  await expect(page.locator(".report-list-header .eyebrow")).toHaveText("ଲାଇଭ୍ ରିପୋର୍ଟ", { timeout: 30_000 });
});
