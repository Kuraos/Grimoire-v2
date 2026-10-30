import { describe, expect, it } from "vitest";
import { isoDay } from "./kit";

describe("isoDay", () => {
  it("lee el día en hora local, no en UTC", () => {
    const d = isoDay("2026-10-20");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 20, 0]);
  });
});
