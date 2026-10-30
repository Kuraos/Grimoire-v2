import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("ignora tildes y mayúsculas", () => {
    expect(fuzzyMatch("Ir a Hábitos", "habitos")?.matches).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
  it("encuentra subsecuencias y rechaza lo que no lo es", () => {
    expect(fuzzyMatch("Ir al Calendario", "clnd")).not.toBeNull();
    expect(fuzzyMatch("Ir al Calendario", "zz")).toBeNull();
  });
  it("prefiere la subcadena a la subsecuencia dispersa", () => {
    const exacta = fuzzyMatch("Ir al Diario", "diario")!.score;
    const dispersa = fuzzyMatch("Ir a Revisión semanal", "rsnl")!.score;
    expect(exacta).toBeGreaterThan(dispersa);
  });
  it("favorece comienzos de palabra", () => {
    expect(fuzzyMatch("Ir a Tareas y Proyectos", "tp")!.matches).toEqual([5, 14]);
  });
});
