import { describe, expect, it } from "vitest";
import { resolveReduced } from "./motion-pref";

describe("preferencia de movimiento", () => {
  it("«sistema» obedece a Windows en las dos direcciones", () => {
    expect(resolveReduced("system", true)).toBe(true);
    expect(resolveReduced("system", false)).toBe(false);
  });
  it("«siempre» anima aunque el sistema pida reducir", () => {
    expect(resolveReduced("full", true)).toBe(false);
  });
  it("«reducido» manda aunque el sistema anime", () => {
    expect(resolveReduced("reduced", false)).toBe(true);
  });
});
