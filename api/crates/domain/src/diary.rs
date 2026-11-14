//! Reglas del diario (v1: `routers/diary.py`; `docs/tasks/fase-2-diario.md`).
//!
//! Una entrada por día. Aquí se decide qué es una entrada escrita, si un guardado pisa un texto
//! que el dispositivo no vio y qué fragmento muestra la búsqueda. El worker lee y escribe.

/// XP de la primera vez que una entrada se guarda escrita, sin multiplicador (v1: `BASE_XP`).
pub const ENTRY_XP: i64 = 5;

/// Decisión 10: la v1 no tenía límite; una entrada real es de 1–20 KB.
pub const MAX_CONTENT_CHARS: usize = 200_000;

/// Caracteres del fragmento de búsqueda (fila 38).
pub const SNIPPET_CHARS: usize = 80;

/// Una entrada está escrita si queda texto tras quitar los espacios, en todo: XP, logros, marcas,
/// volumen y búsqueda (fila 35). `trim` de Rust quita el espacio Unicode, como `str.strip()` de la
/// v1. El worker guarda el resultado en `diary_entries.written`: `trim()` de SQLite solo quita
/// espacios, no `\n` ni `\t`.
pub fn is_written(content: &str) -> bool {
    !content.trim().is_empty()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryRejected {
    /// Más de `MAX_CONTENT_CHARS` caracteres (fila 42).
    TooLong,
}

pub fn validate(content: &str) -> Result<(), EntryRejected> {
    // `chars().count()` recorre todo; antes se descarta por bytes, que nunca son menos que chars.
    if content.len() > MAX_CONTENT_CHARS && content.chars().count() > MAX_CONTENT_CHARS {
        return Err(EntryRejected::TooLong);
    }
    Ok(())
}

/// Lo guardado ese día, si hay entrada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stored<'a> {
    pub save_id: &'a str,
    pub content: &'a str,
}

/// El guardado que llega (decisión 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Incoming<'a> {
    pub save_id: &'a str,
    /// `save_id` de la versión sobre la que se escribió; `None` si el dispositivo no conocía ninguna.
    pub base_save_id: Option<&'a str>,
    pub content: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveDecision {
    /// Se guarda: no había entrada, se escribió sobre la vigente, o lo que se pisa no tiene texto o
    /// es igual a lo que llega.
    Write,
    /// Se guarda lo que llega y lo vigente se copia antes a `diary_conflicts`: nada se pierde.
    Conflict,
    /// El `save_id` ya es el vigente: un reintento de la cola, sin efecto (fila 40).
    Replay,
}

/// ¿Qué hace `PUT /diary/{date}`? Gana siempre lo que llega; la pregunta es si hay que guardar
/// aparte lo que se pisa.
///
/// `ponytail:` solo se recuerda el último `save_id`. Si un guardado ya aplicado se repite después de
/// que otro dispositivo escribió encima (respuesta perdida y reintento), se toma por conflicto: vuelve
/// el texto viejo y el nuevo queda en `diary_conflicts`. No se pierde nada, pero queda al revés.
/// Arreglarlo exige guardar cada `save_id` aplicado; se hace si aparece en la práctica.
pub fn decide_save(stored: Option<Stored<'_>>, incoming: Incoming<'_>) -> SaveDecision {
    let Some(stored) = stored else {
        return SaveDecision::Write;
    };
    if stored.save_id == incoming.save_id {
        return SaveDecision::Replay;
    }
    if incoming.base_save_id == Some(stored.save_id)
        || !is_written(stored.content)
        || stored.content == incoming.content
    {
        return SaveDecision::Write;
    }
    SaveDecision::Conflict
}

/// XP que paga un guardado: 5 la primera vez que la entrada queda escrita, y nunca más, aunque se
/// vacíe y se reescriba (v1, `xp_una_vez`). `already_granted`: hay concesión con `mark_id` = id.
pub fn xp_for_save(content: &str, already_granted: bool) -> i64 {
    if is_written(content) && !already_granted {
        ENTRY_XP
    } else {
        0
    }
}

/// Patrón de `LIKE ... ESCAPE '\'` para buscar `q` tal cual: `%` y `_` literales (v1, `busqueda`).
/// Como en la v1, `LIKE` de SQLite ignora mayúsculas solo en ASCII: `café` no encuentra `CAFÉ`.
pub fn like_pattern(q: &str) -> String {
    let mut p = String::with_capacity(q.len() + 2);
    p.push('%');
    for c in q.chars() {
        if matches!(c, '\\' | '%' | '_') {
            p.push('\\');
        }
        p.push(c);
    }
    p.push('%');
    p
}

/// Fragmento de `SNIPPET_CHARS` caracteres alrededor de la primera coincidencia de `q`, con `…`
/// donde se corta (fila 38). Busca igual que `LIKE`: mayúsculas ASCII da igual. Sin `q`, o si no
/// aparece, el comienzo del texto. Nunca parte un carácter.
pub fn snippet(content: &str, q: &str) -> String {
    // `to_ascii_lowercase` no cambia longitudes en bytes: los índices sirven en el original.
    let at = if q.is_empty() {
        0
    } else {
        content
            .to_ascii_lowercase()
            .find(&q.to_ascii_lowercase())
            .unwrap_or(0)
    };
    let chars: Vec<char> = content.chars().collect();
    let before = content[..at].chars().count();
    let total = chars.len();
    // la coincidencia queda a un cuarto del fragmento, con contexto a la izquierda
    let mut start = before
        .saturating_sub(SNIPPET_CHARS / 4)
        .min(total.saturating_sub(SNIPPET_CHARS));
    let end = (start + SNIPPET_CHARS).min(total);
    // Sin empezar a mitad de palabra («…é y apuntes», de «Café»): se salta lo que quede de ella,
    // sin pasar de la coincidencia. Una palabra que llega hasta la coincidencia se deja cortada.
    if start > 0
        && !chars[start - 1].is_whitespace()
        && let Some(k) = chars[start..before.max(start)]
            .iter()
            .position(|c| c.is_whitespace())
    {
        start += k + 1;
    }
    let body: String = chars[start..end].iter().collect();
    let mut out = String::with_capacity(body.len() + 6);
    if start > 0 {
        out.push('…');
    }
    out.push_str(body.trim());
    if end < total {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored<'a>(save_id: &'a str, content: &'a str) -> Option<Stored<'a>> {
        Some(Stored { save_id, content })
    }

    fn incoming<'a>(save_id: &'a str, base: Option<&'a str>, content: &'a str) -> Incoming<'a> {
        Incoming {
            save_id,
            base_save_id: base,
            content,
        }
    }

    #[test]
    fn written_means_text_after_unicode_trim() {
        assert!(!is_written(""));
        // `solo_espacios`: la v1 contaba esta entrada (fila 35)
        assert!(!is_written("   \n\t "));
        assert!(!is_written("\u{a0}\u{2003}"));
        assert!(is_written("  a "));
    }

    #[test]
    fn length_limit_counts_chars_not_bytes() {
        let at_limit = "é".repeat(MAX_CONTENT_CHARS); // 400 000 bytes
        assert_eq!(validate(&at_limit), Ok(()));
        assert_eq!(validate(&(at_limit + "a")), Err(EntryRejected::TooLong));
    }

    #[test]
    fn no_entry_writes_even_without_base() {
        assert_eq!(
            decide_save(None, incoming("s1", None, "Hola")),
            SaveDecision::Write
        );
        assert_eq!(
            decide_save(None, incoming("s1", Some("x"), "Hola")),
            SaveDecision::Write
        );
    }

    #[test]
    fn same_save_id_is_a_replay_whatever_the_rest() {
        let d = decide_save(
            stored("s1", "Hola"),
            incoming("s1", Some("otra"), "Distinto"),
        );
        assert_eq!(d, SaveDecision::Replay);
    }

    #[test]
    fn writing_on_the_current_version_is_not_a_conflict() {
        let d = decide_save(
            stored("s1", "Hola"),
            incoming("s2", Some("s1"), "Hola, mundo"),
        );
        assert_eq!(d, SaveDecision::Write);
    }

    #[test]
    fn writing_blind_over_text_is_a_conflict() {
        // el teléfono sin caché: no conocía ninguna versión
        let d = decide_save(
            stored("pc", "Lo del PC"),
            incoming("tel", None, "Lo del teléfono"),
        );
        assert_eq!(d, SaveDecision::Conflict);
        // dos dispositivos sobre la misma base: el segundo en llegar
        let d = decide_save(stored("b", "B"), incoming("c", Some("a"), "C"));
        assert_eq!(d, SaveDecision::Conflict);
    }

    #[test]
    fn nothing_to_lose_is_not_a_conflict() {
        let blind = |stored_content| {
            decide_save(stored("pc", stored_content), incoming("tel", None, "Texto"))
        };
        assert_eq!(blind(""), SaveDecision::Write);
        assert_eq!(blind("  \n"), SaveDecision::Write);
        assert_eq!(blind("Texto"), SaveDecision::Write);
    }

    #[test]
    fn xp_once_and_only_when_written() {
        assert_eq!(xp_for_save("Hola", false), 5);
        assert_eq!(xp_for_save("Hola", true), 0);
        assert_eq!(xp_for_save("", false), 0);
        assert_eq!(xp_for_save(" \t", false), 0);
    }

    #[test]
    fn like_pattern_escapes_wildcards_and_the_escape() {
        assert_eq!(like_pattern("100%"), r"%100\%%");
        assert_eq!(like_pattern("snake_case"), r"%snake\_case%");
        assert_eq!(like_pattern(r"a\b"), r"%a\\b%");
        assert_eq!(like_pattern(""), "%%");
    }

    #[test]
    fn short_text_is_the_whole_snippet() {
        assert_eq!(snippet("Café con Ana", "ana"), "Café con Ana");
        assert_eq!(snippet("Café con Ana", ""), "Café con Ana");
    }

    #[test]
    fn long_text_is_cut_around_the_match_on_char_boundaries() {
        let text = format!("{}AGUJA{}", "á".repeat(100), "ñ".repeat(100));
        let s = snippet(&text, "aguja");
        assert!(s.starts_with('…') && s.ends_with('…'), "{s}");
        assert!(s.contains("AGUJA"));
        // 80 caracteres más los dos «…»
        assert_eq!(s.chars().count(), SNIPPET_CHARS + 2);
        // 20 caracteres de contexto antes de la coincidencia
        assert!(s.starts_with(&format!("…{}AGUJA", "á".repeat(20))), "{s}");
    }

    #[test]
    fn the_snippet_does_not_start_mid_word() {
        // la frase de las capturas de la 2.4.5, repetida para que el tope del final no mueva el
        // corte: 20 caracteres antes de «álgebra» cae en «caf|é»
        let text =
            "Tarde de lluvia; café y apuntes. Repasé álgebra lineal: bases y dimensión. ".repeat(3);
        let s = snippet(&text, "álgebra");
        assert!(s.starts_with("…y apuntes"), "{s}");
        let first = s.trim_start_matches('…').split_whitespace().next().unwrap();
        assert!(
            text.split_whitespace().any(|w| w == first),
            "empieza a mitad de palabra: {s}"
        );
        assert!(s.contains("álgebra"));
    }

    #[test]
    fn match_near_the_end_keeps_a_full_window() {
        let text = format!("{}fin", "x".repeat(200));
        let s = snippet(&text, "FIN");
        assert!(s.starts_with('…') && s.ends_with("fin"), "{s}");
        assert_eq!(s.chars().count(), SNIPPET_CHARS + 1);
    }

    #[test]
    fn missing_match_or_accented_case_shows_the_start() {
        // como `LIKE`: la tilde en mayúscula no se pliega, así que no hay coincidencia aquí
        let text = format!("CAFÉ solo {}", "y".repeat(200));
        let s = snippet(&text, "café");
        assert!(s.starts_with("CAFÉ solo") && s.ends_with('…'), "{s}");
    }
}
