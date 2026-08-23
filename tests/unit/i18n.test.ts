import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

type I18nModule = typeof import("../../src/services/i18n");

// In jsdom `language` lives on Navigator.prototype; fall back to deleting any own override.
const originalLanguageDescriptor =
  Object.getOwnPropertyDescriptor(window.navigator, "language") ?? Object.getOwnPropertyDescriptor(Navigator.prototype, "language");

function mockNavigatorLanguage(language: string): void {
  Object.defineProperty(window.navigator, "language", { configurable: true, value: language });
}

async function loadI18n(): Promise<I18nModule> {
  vi.resetModules();
  return import("../../src/services/i18n");
}

describe("i18n", () => {
  beforeEach(() => {
    document.documentElement.lang = "";
    localStorage.clear();
  });

  afterEach(() => {
    if (originalLanguageDescriptor) {
      Object.defineProperty(window.navigator, "language", originalLanguageDescriptor);
    } else {
      Reflect.deleteProperty(window.navigator, "language");
    }
    vi.resetModules();
  });

  describe("default language detection", () => {
    it('defaults to English when navigator.language is not Odia', async () => {
      mockNavigatorLanguage("en-IN");
      const i18n = await loadI18n();
      expect(i18n.getLang()).toBe("en");
    });

    it('defaults to Odia when navigator.language starts with "or"', async () => {
      mockNavigatorLanguage("or-IN");
      const i18n = await loadI18n();
      expect(i18n.getLang()).toBe("or");
    });

    it("prefers a persisted preference over the browser language", async () => {
      mockNavigatorLanguage("en-IN");
      localStorage.setItem("ao_lang", "or");
      const i18n = await loadI18n();
      expect(i18n.getLang()).toBe("or");
    });

    it("falls back to English for an invalid stored value", async () => {
      mockNavigatorLanguage("or-IN");
      localStorage.setItem("ao_lang", "fr");
      const i18n = await loadI18n();
      expect(i18n.getLang()).toBe("or");
    });
  });

  describe("t()", () => {
    it("translates a known key in the current language", async () => {
      const i18n = await loadI18n();
      expect(i18n.t("nav.map")).toBe("Map");
      i18n.setLang("or");
      expect(i18n.t("nav.map")).toBe("ନକ୍ସା");
    });

    it("interpolates {vars}", async () => {
      const i18n = await loadI18n();
      expect(i18n.t("units.daysAgo", { count: 5 })).toBe("5d ago");
    });

    it("interpolates multiple vars and leaves unknown placeholders intact", async () => {
      const i18n = await loadI18n();
      expect(i18n.t("detail.daysOpen", { count: 12 })).toBe("12 days open");
      expect(i18n.t("units.daysAgo")).toBe("{count}d ago");
    });

    it("returns the key itself for unknown keys", async () => {
      const i18n = await loadI18n();
      expect(i18n.t("totally.missing.key")).toBe("totally.missing.key");
    });

    it("falls back to the English value for keys missing in the active dictionary", async () => {
      const i18n = await loadI18n();
      i18n.setLang("or");
      expect(i18n.t("app.name")).toBe("Amma Odisha");
    });
  });

  describe("setLang persistence", () => {
    it("persists the choice to localStorage under ao_lang", async () => {
      const i18n = await loadI18n();
      i18n.setLang("or");
      expect(localStorage.getItem("ao_lang")).toBe("or");
      i18n.setLang("en");
      expect(localStorage.getItem("ao_lang")).toBe("en");
    });

    it("updates document.documentElement.lang", async () => {
      const i18n = await loadI18n();
      i18n.setLang("or");
      expect(document.documentElement.lang).toBe("or");
    });

    it("restores the persisted language on next module load", async () => {
      const first = await loadI18n();
      first.setLang("or");
      const second = await loadI18n();
      expect(second.getLang()).toBe("or");
    });
  });

  describe("subscribe", () => {
    it("notifies subscribers when the language changes", async () => {
      const i18n = await loadI18n();
      const listener = vi.fn();
      i18n.subscribe(listener);
      i18n.setLang("or");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stops notifying after unsubscribe", async () => {
      const i18n = await loadI18n();
      const listener = vi.fn();
      const unsubscribe = i18n.subscribe(listener);
      unsubscribe();
      i18n.setLang("or");
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not notify when setting the same language", async () => {
      const i18n = await loadI18n();
      const listener = vi.fn();
      i18n.subscribe(listener);
      i18n.setLang("en");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("useLang hook", () => {
    it("returns the current language and a setter that re-renders", async () => {
      const i18n = await loadI18n();
      const { result } = renderHook(() => i18n.useLang());
      expect(result.current[0]).toBe("en");

      act(() => result.current[1]("or"));
      expect(result.current[0]).toBe("or");
      expect(i18n.getLang()).toBe("or");
    });
  });
});
