import { describe, expect, it } from "vitest";
import { ESCALATION_LABELS, escalationLevel } from "../../src/services/escalation";

describe("escalationLevel", () => {
  it("returns 0 below the first threshold", () => {
    expect(escalationLevel(0)).toBe(0);
    expect(escalationLevel(2)).toBe(0);
  });

  it("crosses level boundaries exactly at each threshold", () => {
    expect(escalationLevel(3)).toBe(1);
    expect(escalationLevel(5)).toBe(2);
    expect(escalationLevel(10)).toBe(3);
    expect(escalationLevel(20)).toBe(4);
    expect(escalationLevel(50)).toBe(5);
  });

  it("stays just below each threshold", () => {
    expect(escalationLevel(4)).toBe(1);
    expect(escalationLevel(9)).toBe(2);
    expect(escalationLevel(19)).toBe(3);
    expect(escalationLevel(49)).toBe(4);
  });

  it("caps at the number of thresholds for very old reports", () => {
    expect(escalationLevel(51)).toBe(5);
    expect(escalationLevel(365)).toBe(5);
  });

  it("never returns a negative level", () => {
    expect(escalationLevel(-7)).toBe(0);
  });
});

describe("ESCALATION_LABELS", () => {
  it("has one label per threshold plus the base level", () => {
    expect(ESCALATION_LABELS).toHaveLength(6);
    expect(ESCALATION_LABELS[0]).toBe("New");
    expect(ESCALATION_LABELS[5]).toBe("Emergency");
  });

  it("labels every achievable level", () => {
    for (let days = 0; days <= 60; days += 1) {
      expect(ESCALATION_LABELS[escalationLevel(days)]).toEqual(expect.any(String));
    }
  });
});
