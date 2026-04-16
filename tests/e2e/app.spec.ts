import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const reports = JSON.parse(readFileSync(new URL("../../public/reports.json", import.meta.url), "utf8")) as { id: string }[];

test("public map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /About Amma Odisha/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Report Garbage/i })).toBeVisible();
  await expect(page.getByLabel("Amma Odisha civic reporting context")).toContainText("Bhubaneswar accountability");
  await expect(page.getByRole("button", { name: /Open Amma Odisha insights/i })).toBeVisible();
  await expect(page.getByLabel("Map cluster guidance")).toContainText("Grouped reports");
});

test("list mode exposes the issue feed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^List$/i }).click();
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

test("mobile report controls expose search and sort", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /Open search and filters/i }).click();
  const filterDialog = page.getByRole("dialog", { name: /Search and filter reports/i });
  await expect(filterDialog.getByLabel("Search reports")).toBeVisible();
  await expect(filterDialog.getByLabel("Sort reports")).toBeVisible();
});

test("report form requests location only after user action", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          window.localStorage.setItem("geo-calls", String(Number(window.localStorage.getItem("geo-calls") || "0") + 1));
          success({
            coords: {
              accuracy: 12,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              latitude: 20.2961,
              longitude: 85.8245,
              speed: null
            },
            timestamp: Date.now()
          } as GeolocationPosition);
        }
      }
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^Report Garbage$/i }).first().click();
  await expect(page.getByText(/Use current location to detect your ward faster/i)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("geo-calls") || "0")).toBe("0");
  await page.getByRole("button", { name: /Use current location/i }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("geo-calls") || "0")).toBe("1");
});

test("filtered list empty state can clear filters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /Open search and filters/i }).click();
  const filterDialog = page.getByRole("dialog", { name: /Search and filter reports/i });
  await filterDialog.getByLabel("Search reports").fill("zzzz-no-report-here");
  await expect(filterDialog.getByLabel("Active report filters")).toContainText("Search: zzzz-no-report-here");
  await page.getByRole("button", { name: /^Apply$/i }).click();
  await page.getByRole("button", { name: /^List$/i }).click();
  await expect(page.getByText(/No reports match your current filters/i)).toBeVisible();
  await page.getByRole("button", { name: /Clear filters/i }).click();
  await expect(page.locator(".report-item").first()).toBeVisible();
});

test("report form validates fields and confirms submission", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^Report Garbage$/i }).first().click();
  await page.locator(".form-sheet .primary-cta").click();
  await expect(page.getByText(/Add a clear photo/i)).toBeVisible();
  await expect(page.getByText(/Choose a ward/i)).toBeVisible();
  await expect(page.getByText(/Add a nearby landmark/i)).toBeVisible();

  await page.locator(".form-sheet input[type='file']").setInputFiles({
    name: "garbage.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-image")
  });
  await page.getByLabel(/Ward/i).selectOption({ index: 1 });
  await page.getByPlaceholder(/Near Unit 4 market/i).fill("Near Unit 4 market");
  await page.locator(".form-sheet .primary-cta").click();
  await expect(page.getByRole("status").getByText(/Report submitted/i)).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Submitted for review/i);
});

test("deep links open contextual public sheets", async ({ page }) => {
  await page.goto("/ward/5");
  await expect(page.getByRole("heading", { name: "Ward 5" })).toBeVisible();

  await page.goto(`/report/${reports[0].id}`);
  await expect(page.getByRole("button", { name: /Close report detail/i })).toBeVisible();
  await page.getByRole("button", { name: /Get directions/i }).click();
  await expect(page.getByRole("dialog", { name: /Open directions/i })).toContainText("Google Maps");
  await page.getByRole("button", { name: /Not now/i }).click();
  await page.getByRole("button", { name: /Contact BMC/i }).click();
  await page.getByRole("button", { name: /Call BMC/i }).click();
  await expect(page.getByRole("dialog", { name: /^Call BMC$/i })).toContainText("start a phone call");
});

test("admin login route loads", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByAltText("Amma Odisha")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Amma Odisha Moderation/i })).toBeVisible();
  await expect(page.getByPlaceholder("Admin key")).toBeVisible();
});
