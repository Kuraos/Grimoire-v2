/**
 * Búsqueda aproximada para la paleta de comandos, a partir de la de Kokonut UI
 * («action search bar»), con una diferencia que en español importa: ignora las
 * tildes. «habitos» tiene que encontrar «Hábitos», y «revision», «Revisión».
 *
 * Devuelve los índices que casan —para resaltarlos— y una puntuación que
 * favorece las rachas seguidas, los comienzos de palabra y lo que casa pronto.
 * `null` si la consulta no es una subsecuencia del texto.
 */
const fold = (s: string) =>
  Array.from(s, (c) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() || c).join("");

const isWordStart = (t: string, i: number) => i === 0 || /[\s\-·/(]/.test(t[i - 1]);

export function fuzzyMatch(text: string, query: string): { score: number; matches: number[] } | null {
  const t = fold(text);
  const q = fold(query).replace(/\s+/g, "");
  if (!q) return { score: 0, matches: [] };

  // Subcadena exacta: lo mejor, y mejor cuanto antes empiece.
  const at = t.indexOf(q);
  if (at >= 0) {
    return { score: 100 - at + (isWordStart(t, at) ? 30 : 0), matches: Array.from({ length: q.length }, (_, k) => at + k) };
  }

  // Subsecuencia, prefiriendo saltar a comienzos de palabra.
  let score = 0;
  let from = 0;
  let prev = -1;
  const matches: number[] = [];
  for (const ch of q) {
    let i = t.indexOf(ch, from);
    if (i < 0) return null;
    for (let j = i; j >= 0 && j < t.length; j = t.indexOf(ch, j + 1)) {
      if (isWordStart(t, j)) { i = j; break; }
      if (prev >= 0 && j === prev + 1) { i = j; break; }
    }
    score += prev >= 0 && i === prev + 1 ? 6 : 1;
    score += isWordStart(t, i) ? 8 : 0;
    score -= prev < 0 ? i * 0.5 : (i - prev - 1) * 0.2;
    matches.push(i);
    prev = i;
    from = i + 1;
  }
  return { score, matches };
}
