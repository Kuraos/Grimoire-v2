import { describe, expect, it } from "vitest";
import { toBezier, toSeconds } from "./theme-tokens";

describe("tokens de movimiento", () => {
  it("convierte duraciones CSS a segundos", () => {
    expect(toSeconds("240ms")).toBeCloseTo(0.24);
    expect(toSeconds(" 0.3s")).toBeCloseTo(0.3);
  });
  it("lee la curva de theme.css, incluida la que rebasa 1", () => {
    expect(toBezier("cubic-bezier(0.34, 1.36, 0.5, 1)")).toEqual([0.34, 1.36, 0.5, 1]);
  });
  it("cae a ease-out si la curva no es un cubic-bezier", () => {
    expect(toBezier("ease")).toEqual([0.22, 1, 0.36, 1]);
  });
});
