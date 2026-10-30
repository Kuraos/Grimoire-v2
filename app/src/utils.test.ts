import { describe, it, expect } from "vitest";
import {
  streakMultiplier, TIER_META,
  moneyDecimals, formatMoney, parseMoney, entrySign, budgetState,
  formatWeight, parseWeight,
} from "./utils";

describe("streakMultiplier", () => {
  it("is 1 below the first threshold", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(6)).toBe(1);
  });
  it("applies streak bonuses at thresholds", () => {
    expect(streakMultiplier(7)).toBe(1.1);
    expect(streakMultiplier(14)).toBe(1.2);
    expect(streakMultiplier(30)).toBe(1.35);
    expect(streakMultiplier(60)).toBe(1.5);
    expect(streakMultiplier(100)).toBe(1.75);
    expect(streakMultiplier(250)).toBe(1.75);
  });
});

describe("TIER_META", () => {
  it("covers every tier", () => {
    expect(Object.keys(TIER_META).sort()).toEqual(["common", "epic", "legendary", "rare"]);
  });
});

describe("moneyDecimals", () => {
  it("gives the peso zero decimals and everything unknown two", () => {
    expect(moneyDecimals("COP")).toBe(0);
    expect(moneyDecimals("cop")).toBe(0);
    expect(moneyDecimals("JPY")).toBe(0);
    expect(moneyDecimals("EUR")).toBe(2);
    expect(moneyDecimals("")).toBe(2);
  });
});

describe("parseMoney", () => {
  it("reads what people actually type", () => {
    expect(parseMoney("18000")).toBe(18000);
    expect(parseMoney("18.000")).toBe(18000);
    expect(parseMoney("$ 1.250.000")).toBe(1250000);
    expect(parseMoney("  820000  ")).toBe(820000);
  });
  it("treats a three-digit group as thousands, never as cents", () => {
    // 1250 euros = 125000 céntimos. Si "1.250" se leyera como 1,250 el importe
    // saldría cien veces más pequeño y nadie lo notaría hasta cuadrar el mes.
    expect(parseMoney("1.250", "EUR")).toBe(125000);
    expect(parseMoney("1,250", "EUR")).toBe(125000);
  });
  it("reads cents only where the currency has them", () => {
    expect(parseMoney("4,50", "EUR")).toBe(450);
    expect(parseMoney("4.5", "EUR")).toBe(450);
    expect(parseMoney("1.234,56", "EUR")).toBe(123456);
    // el peso no tiene centavos: los separadores son todos de miles
    expect(parseMoney("4,50", "COP")).toBe(450);
  });
  it("understands both minus signs and accounting parentheses", () => {
    expect(parseMoney("-4500")).toBe(-4500);
    expect(parseMoney("−4500")).toBe(-4500);
    expect(parseMoney("(1.200)")).toBe(-1200);
  });
  it("returns null when there is no number to read", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("$")).toBeNull();
  });
  it("refuses amounts past the safe integer instead of rounding them", () => {
    expect(parseMoney("9".repeat(20))).toBeNull();
  });
});

describe("formatMoney", () => {
  it("round-trips through parseMoney", () => {
    for (const [minor, cur] of [[18000, "COP"], [1250000, "COP"], [0, "COP"],
                                [123456, "EUR"], [450, "EUR"]] as const) {
      expect(parseMoney(formatMoney(minor, cur), cur)).toBe(minor);
    }
  });
  it("shows the peso without decimals and the euro with them", () => {
    expect(formatMoney(18000, "COP")).toMatch(/18[.\s]000/);
    expect(formatMoney(18000, "COP")).not.toMatch(/,\d\d/);
    expect(formatMoney(123456, "EUR")).toMatch(/1[.\s]234,56/);
  });
  it("uses the typographic minus so the column stays aligned", () => {
    expect(formatMoney(-18000, "COP")).toContain("−");
    expect(formatMoney(-18000, "COP")).not.toContain("-");
  });
  it("glues the peso symbol to its figure", () => {
    // Intl da "$ 18.000" con espacio duro; en Colombia se escribe pegado
    expect(formatMoney(18000, "COP")).toBe("$18.000");
    expect(formatMoney(-18000, "COP")).toBe("−$18.000");
  });
  it("drops the symbol on request", () => {
    expect(formatMoney(18000, "COP", { symbol: false })).not.toContain("$");
  });
});

describe("budgetState", () => {
  it("turns amber at 85% and oxblood only past the cerco", () => {
    expect(budgetState(0, 100000)).toBe("ok");
    expect(budgetState(84999, 100000)).toBe("ok");
    expect(budgetState(85000, 100000)).toBe("warn");
    expect(budgetState(100000, 100000)).toBe("warn"); // gastarlo justo no es pasarse
    expect(budgetState(100001, 100000)).toBe("over");
  });
  it("never divides by a cerco that is not there", () => {
    expect(budgetState(5000, 0)).toBe("ok");
    expect(budgetState(5000, -1)).toBe("ok");
  });
});

describe("entrySign", () => {
  it("puts the sign on the kind, and leaves a transfer unsigned", () => {
    expect(entrySign("income")).toBe("+");
    expect(entrySign("expense")).toBe("−");
    expect(entrySign("transfer")).toBe("");
  });
});

describe("parseWeight", () => {
  it("reads what people actually type", () => {
    expect(parseWeight("62,5")).toBe(62500);
    expect(parseWeight("62.5")).toBe(62500);
    expect(parseWeight("100 kg")).toBe(100000);
    expect(parseWeight("2,25")).toBe(2250); // el disco de 1,25 y su pareja
    expect(parseWeight("0")).toBe(0);
  });

  it("returns null when there is no number to read", () => {
    // devolvía 0, y una serie tecleada con basura se guardaba pesando 0 g
    expect(parseWeight("abc")).toBeNull();
    expect(parseWeight("kg")).toBeNull();
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("   ")).toBeNull();
  });

  it("refuses a negative instead of silently dropping its sign", () => {
    // el filtro se comía el signo antes de que el guardia pudiera verlo
    expect(parseWeight("-5")).toBeNull();
    expect(parseWeight("−5")).toBeNull();
  });

  it("treats a three-digit group as thousands, never as decimals", () => {
    expect(parseWeight("1.000")).toBe(1_000_000); // mil kilos, el tope
    expect(parseWeight("82.500")).toBeNull();     // no es 82,5: es un dedo resbalado
  });

  it("reads back what formatWeight prints", () => {
    // formatWeight imprime en es-CO: mil kilos son «1.000 kg». Leerlo como 1,0
    // era un error de mil veces que ninguna prueba veía.
    const casos = [[62500, "kg"], [100000, "kg"], [1_000_000, "kg"], [453592, "lb"]] as const;
    for (const [grams, unit] of casos) {
      expect(parseWeight(formatWeight(grams, unit), unit)).toBe(grams);
    }
  });

  it("caps at a thousand kilos", () => {
    expect(parseWeight("1000")).toBe(1_000_000);
    expect(parseWeight("1001")).toBeNull();
  });
});
