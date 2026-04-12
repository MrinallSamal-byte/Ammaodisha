import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const reports = JSON.parse(readFileSync(new URL("../../public/reports.json", import.meta.url), "utf8")) as { id: string }[];

test("public map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /About Amma Odisha/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Report Garbage/i })).toBeVisible();
  await expect(page.getByLabel("Amma Odisha civic reporting context")).toContainText("Public garbage map");
  await expect(page.getByRole("button", { name: /Open Amma Odisha insights/i })).toBeVisible();
});

test("list mode exposes the issue feed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^List$/i }).click();
  await expect(page.getByText(/visible issues/i)).toBeVisible();
  await expect(page.locator(".report-item").first()).toBeVisible();
});

test("report form opens as a mobile-first sheet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^Report Garbage$/i }).first().click();
  await expect(page.getByRole("heading", { name: /^Report Garbage$/i })).toBeVisible();
  await expect(page.getByText("Take a Photo", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(/Near Unit 4 market/i)).toBeVisible();
});

test("deep links open contextual public sheets", async ({ page }) => {
  await page.goto("/ward/5");
  await expect(page.getByRole("heading", { name: "Ward 5" })).toBeVisible();

  await page.goto(`/report/${reports[0].id}`);
  await expect(page.getByRole("button", { name: /Close report detail/i })).toBeVisible();
});

test("admin login route loads", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByAltText("Moderator")).toBeVisible();
  await expect(page.getByPlaceholder("Admin key")).toBeVisible();
});
