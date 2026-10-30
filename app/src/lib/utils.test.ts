import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("no confunde el peldaño 2xs con un color", () => {
    expect(cn("text-2xs", "text-text-muted")).toBe("text-2xs text-text-muted");
  });
  it("resuelve conflictos de tamaño dentro de nuestra escala", () => {
    expect(cn("text-xs", "text-2xs")).toBe("text-2xs");
    expect(cn("rounded-md", "rounded-card")).toBe("rounded-card");
  });
});
