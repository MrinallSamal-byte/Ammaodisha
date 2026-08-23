import type { Page } from "@playwright/test";

export async function pinEnglish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("ao_lang", "en");
  });
}
