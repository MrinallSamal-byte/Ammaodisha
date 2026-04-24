import { expect, test, type Page } from "@playwright/test";

async function expectReportSheetOpen(page: Page) {
  await expect.poll(async () => {
    const closeVisible = await page.getByRole("button", { name: /Close report detail/i }).isVisible().catch(() => false);
    const backVisible = await page.getByRole("button", { name: /Back to map/i }).isVisible().catch(() => false);
    return closeVisible || backVisible;
  }).toBe(true);
}

async function getRuntimeReportPath(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^List$/i }).click();
  await page.locator(".report-item").first().click();
  await expectReportSheetOpen(page);
  const path = new URL(page.url()).pathname;
  expect(path).toMatch(/^\/report\//);
  return path;
}

test("public map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /About Amma Odisha/i })).toBeVisible();
  // Report Garbage is exposed directly on mobile and as a QR handoff on desktop.
  const reportCtaVisible = await page
    .getByRole("button", { name: "Report a garbage dump", exact: true })
    .isVisible()
    .catch(() => false);
  const desktopQrCtaVisible = await page
    .getByRole("button", { name: /Scan QR to report on mobile/i })
    .isVisible()
    .catch(() => false);
  expect(reportCtaVisible || desktopQrCtaVisible).toBe(true);
  await expect(page.getByRole("dialog", { name: /Amma Odisha intro/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open Amma Odisha insights/i })).toBeVisible();
  await expect(page.getByLabel("Map cluster guidance")).toContainText("Grouped reports");
  await expect(page.getByLabel("Visible map report statistics")).toBeVisible();
  await expect(page.getByLabel("Map severity legend")).toContainText("Critical");
});

test("list mode exposes the issue feed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^List$/i }).click();
  await expect(page.locator(".report-item").first()).toBeVisible();
});

test("map-first controls filter reports directly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);

  await expect(page.getByLabel("Filter by severity")).toBeVisible();
  await expect(page.getByLabel("Filter by status")).toBeVisible();
  await page.getByLabel("Filter by severity").selectOption("massive");
  await page.getByLabel("Filter by status").selectOption("resolved");
  await expect(page.getByRole("button", { name: /Open search and filters/i })).toContainText("2");
  await expect(page.getByLabel("Visible map report statistics")).toBeVisible();
  await page.getByRole("button", { name: /Open search and filters/i }).click();
  const filterDialog = page.getByRole("dialog", { name: /Search and filter reports/i });
  await expect(filterDialog.getByLabel("Active report filters")).toContainText("Severity: Critical");
  await expect(filterDialog.getByLabel("Active report filters")).toContainText("Status: Cleaned");
});

test("resolved-only map results guide users to list view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByLabel("Filter by status").selectOption("resolved");
  await expect(page.getByText(/Only cleaned reports match/i)).toBeVisible();
  await page.getByRole("button", { name: /Open list/i }).click();
  await expect(page.locator(".report-item").first()).toBeVisible();
});

test("insights priority queue opens urgent reports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /Open Amma Odisha insights/i }).click();
  await expect(page.getByRole("dialog", { name: /Amma Odisha insights/i })).toContainText("Priority Queue");
  await page.locator(".priority-report-row").first().click();
  await expectReportSheetOpen(page);
});

test("report form opens as a mobile-first sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /Report a garbage dump/i }).first().click();
  await expect(page.getByRole("heading", { name: /^Report Garbage$/i })).toBeVisible();
  await expect(page.getByText(/Step 1 of 3/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Neighbourhood, market, colony/i)).toBeVisible();
  await expect(page.getByText("Take a Photo", { exact: true })).not.toBeVisible();
  await expect(page.getByPlaceholder(/Near Unit 4 market/i)).not.toBeVisible();
});

test("mobile report controls expose search and sort", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^List$/i }).click();
  await expect(page.locator(".list-tools").getByLabel("Search reports")).toBeVisible();
  await expect(page.locator(".list-tools").getByLabel("Sort reports")).toBeVisible();
});

test("report form requests location only after user action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByRole("button", { name: /Report a garbage dump/i }).first().click();
  await expect(page.getByRole("button", { name: /Use my current location/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("geo-calls") || "0")).toBe("0");
  await page.getByRole("button", { name: /Use my current location/i }).click();
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
  test.setTimeout(60_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Start using map/i }).click().catch(() => undefined);
  await page.getByRole("button", { name: /Report a garbage dump/i }).first().click();
  await page.getByRole("button", { name: /^Next$/i }).click();
  await expect(page.locator("#report-ward-error")).toContainText(/Search for your area/i);

  await page.getByPlaceholder(/Neighbourhood, market, colony/i).fill("1");
  await page.getByRole("listbox", { name: /Matching wards/i }).getByRole("option").first().click();
  await page.getByRole("button", { name: /^Next$/i }).click();
  await expect(page.getByText(/Step 2 of 3/i)).toBeVisible();

  await page.getByRole("button", { name: /^Next$/i }).click();
  await expect(page.locator("#report-photo-error")).toContainText(/Add a clear photo/i);
  await expect(page.locator("#report-address-error")).toContainText(/Add a nearby landmark/i);

  await page.locator(".form-sheet input[type='file']").setInputFiles({
    name: "garbage.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-image")
  });
  await page.getByRole("textbox", { name: /Landmark \/ Address/i }).fill("Near Unit 4 market");
  await page.getByRole("button", { name: /^Next$/i }).click();
  await expect(page.getByText(/Step 3 of 3/i)).toBeVisible();
  await page.getByRole("button", { name: /Submit Report/i }).click();
  await expect(page.getByRole("status").getByText(/Report submitted/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status")).toContainText(/We review every photo/i, { timeout: 20_000 });
});

test("deep links open contextual public sheets", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/ward/5");
  await expect(page.getByRole("heading", { name: "Ward 5" })).toBeVisible({ timeout: 30_000 });

  const reportPath = await getRuntimeReportPath(page);
  await page.goto(reportPath);
  await expectReportSheetOpen(page);
  await page.getByRole("button", { name: /Get directions/i }).click();
  await expect(page.getByRole("dialog", { name: /Open directions/i })).toContainText("Google Maps");
  await page.getByRole("button", { name: /Not now/i }).click();
  await page.getByRole("button", { name: /Call BMC/i }).click();
  await expect(page.getByRole("dialog", { name: /^Call BMC$/i })).toContainText("start a phone call");
});

test("admin login route loads", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByAltText("Amma Odisha")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Amma Odisha Moderation/i })).toBeVisible();
  await expect(page.getByPlaceholder("Admin key")).toBeVisible();
});
