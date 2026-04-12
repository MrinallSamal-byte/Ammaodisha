import { expect, test } from "@playwright/test";

test("public map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /About Amma Odisha/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Report Garbage/i })).toBeVisible();
  await expect(page.getByText("Worst Wards by Reports")).toBeVisible();
});

test("admin login route loads", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByAltText("Kasa Moderator")).toBeVisible();
  await expect(page.getByPlaceholder("Admin key")).toBeVisible();
});
