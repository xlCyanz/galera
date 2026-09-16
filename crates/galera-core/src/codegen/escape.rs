//! Escape de texto del usuario hacia el marcado de Typst.
//!
//! Este módulo es el principio 6 del README hecho código: **todo** texto que
//! escribe una persona pasa por aquí antes de entrar en el archivo `.typ`.
//! Es también el punto más delicado del proyecto en términos de seguridad
//! (ver `SECURITY.md`): sin escapar, el contenido de un documento puede
//! inyectar código Typst arbitrario, que luego se compila.
//!
//! # Qué se escapa y qué no
//!
//! La regla es: **se escapa lo que cambia la estructura del documento o
//! puede inyectar código; se deja pasar la tipografía fina.**
//!
//! Se escapan siempre:
//!
//! | Carácter | Qué haría sin escapar |
//! |---|---|
//! | `\` | inicia una secuencia de escape o un salto de línea |
//! | `#` | inicia una expresión de código |
//! | `*` | negrita; y `/*` abre un comentario de bloque |
//! | `_` | cursiva |
//! | `$` | abre modo matemático |
//! | `@` | referencia, como `@intro` |
//! | `` ` `` | texto literal monoespaciado |
//! | `<` `>` | etiqueta, como `<intro>` |
//! | `[` `]` | bloque de contenido |
//! | `/` | `//` abre un comentario de línea y se come el resto; además rompe el autoenlace de `https://` |
//! | `~` | espacio duro: el carácter que escribió la persona desaparece |
//!
//! Se escapan **solo al principio de línea**, que es donde Typst los lee
//! como marcadores de bloque:
//!
//! | Carácter | Qué haría sin escapar |
//! |---|---|
//! | `=` | encabezado, como `= Título` |
//! | `-` | viñeta de lista |
//! | `+` | elemento de lista numerada |
//! | `.` tras dígitos | lista numerada, como `1. uno` |
//!
//! **No** se escapan las comillas, los guiones dobles ni los puntos
//! suspensivos. Typst los convierte en comillas tipográficas, rayas y `…`,
//! y eso es tipografía fina, no un cambio de estructura: se ve igual en el
//! lienzo y en el PDF, que es lo único que este proyecto no puede permitirse
//! romper. Si algún día hace falta desactivarlo, se hace con un ajuste del
//! documento, no escapando cada carácter.
//!
//! # Por qué carácter a carácter
//!
//! La forma ingenua de escapar es encadenar reemplazos de cadena, y tiene un
//! fallo clásico: si se reemplaza `#` antes que `\`, las barras invertidas
//! que acaba de meter el primer reemplazo se vuelven a escapar. Aquí se
//! recorre el texto una sola vez, decidiendo por carácter, así que el
//! problema no puede darse: lo que se emite nunca se vuelve a mirar.
//!
//! # Pendiente de comprobar contra el compilador
//!
//! Esta función está escrita contra la documentación de Typst. La
//! comprobación empírica —compilar de verdad y mirar el PDF— llega con
//! F0-12, y las instantáneas que la congelan, con F0-15.

/// Caracteres que se escapan siempre, aparezcan donde aparezcan.
///
/// El orden no importa: se consulta carácter a carácter, no en cadena.
pub const ALWAYS_ESCAPED: &[char] = &[
    '\\', '#', '*', '_', '$', '@', '`', '<', '>', '[', ']', '/', '~',
];

/// Caracteres que solo son marcado cuando abren una línea.
pub const LINE_START_ESCAPED: &[char] = &['=', '-', '+'];

/// Qué se lleva visto de la línea actual.
///
/// Sirve para distinguir `= Título` (un encabezado) de `a = b` (texto), y
/// `1. uno` (una lista numerada) de `versión 1. la primera` (texto).
#[derive(Clone, Copy, PartialEq, Eq)]
enum LineState {
    /// Nada salvo espacios desde el último salto de línea.
    Leading,
    /// Espacios y después dígitos, y nada más.
    LeadingDigits,
    /// Ya ha empezado el contenido de la línea.
    Body,
}

/// Escapa un texto del usuario para poder insertarlo en marcado de Typst.
///
/// El resultado se renderiza exactamente como el texto de entrada: ningún
/// carácter se interpreta como marcado ni como código.
///
/// # Ejemplos
///
/// ```
/// use galera_core::codegen::escape::escape;
///
/// // Lo que parece código se queda en texto.
/// assert_eq!(escape("#let x = 1"), "\\#let x = 1");
///
/// // Los acentos y los emojis no se tocan.
/// assert_eq!(escape("Cooperativa Agrícola 🌾"), "Cooperativa Agrícola 🌾");
/// ```
pub fn escape(text: &str) -> String {
    // Casi ningún texto necesita escape, y los que lo necesitan rara vez
    // pasan de unos pocos caracteres: reservar un octavo de más evita la
    // mayoría de las reasignaciones sin desperdiciar memoria.
    let mut out = String::with_capacity(text.len() + text.len() / 8);
    escape_into(text, &mut out);
    out
}

/// Igual que [`escape`], pero escribiendo al final de una cadena existente.
///
/// Lo usa el generador de código para ir construyendo el archivo `.typ` sin
/// crear una cadena intermedia por cada tramo de texto.
pub fn escape_into(text: &str, out: &mut String) {
    let mut line = LineState::Leading;

    for character in text.chars() {
        match character {
            '\n' => {
                out.push(character);
                line = LineState::Leading;
            }

            // El retorno de carro no cambia el estado: en `\r\n` es el salto
            // de línea el que abre la línea nueva.
            '\r' => out.push(character),

            _ if ALWAYS_ESCAPED.contains(&character) => {
                out.push('\\');
                out.push(character);
                line = LineState::Body;
            }

            _ if line == LineState::Leading && LINE_START_ESCAPED.contains(&character) => {
                out.push('\\');
                out.push(character);
                line = LineState::Body;
            }

            // El punto de `1. uno`, solo si lo único que hay antes en la
            // línea son dígitos.
            '.' if line == LineState::LeadingDigits => {
                out.push('\\');
                out.push(character);
                line = LineState::Body;
            }

            _ => {
                out.push(character);
                line = next_line_state(line, character);
            }
        }
    }
}

/// Avanza el estado de la línea con un carácter que no se ha escapado.
fn next_line_state(line: LineState, character: char) -> LineState {
    match character {
        // La sangría no empieza el contenido de la línea, pero sí corta una
        // posible numeración: `1 . uno` no es una lista.
        ' ' | '\t' => match line {
            LineState::Leading => LineState::Leading,
            LineState::LeadingDigits | LineState::Body => LineState::Body,
        },
        digit if digit.is_ascii_digit() => match line {
            LineState::Leading | LineState::LeadingDigits => LineState::LeadingDigits,
            LineState::Body => LineState::Body,
        },
        _ => LineState::Body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_every_always_escaped_character_on_its_own() {
        for &character in ALWAYS_ESCAPED {
            let input = character.to_string();
            let expected = format!("\\{character}");
            assert_eq!(
                escape(&input),
                expected,
                "{character:?} debe escaparse aparezca donde aparezca"
            );
        }
    }

    #[test]
    fn escapes_every_always_escaped_character_inside_a_sentence() {
        for &character in ALWAYS_ESCAPED {
            let input = format!("antes {character} después");
            let expected = format!("antes \\{character} después");
            assert_eq!(escape(&input), expected, "fallo con {character:?}");
        }
    }

    #[test]
    fn escapes_all_the_special_characters_at_once() {
        assert_eq!(escape(r"#*_$@`<>[]/~\"), r"\#\*\_\$\@\`\<\>\[\]\/\~\\");
    }

    #[test]
    fn code_like_text_stays_literal() {
        assert_eq!(escape("#let x = 1"), r"\#let x = 1");
        assert_eq!(
            escape("#table(columns: 2)[A][B]"),
            r"\#table(columns: 2)\[A\]\[B\]"
        );
        assert_eq!(escape("#import \"foo.typ\""), "\\#import \"foo.typ\"");
    }

    /// El fallo clásico de encadenar reemplazos: escapar `#` y después `\`
    /// vuelve a escapar las barras que acaba de meter el primer reemplazo.
    /// Aquí se recorre una sola vez, así que no puede pasar.
    #[test]
    fn a_backslash_is_escaped_exactly_once() {
        assert_eq!(escape(r"\"), r"\\");
        assert_eq!(escape(r"\#"), r"\\\#");
        assert_eq!(escape(r"C:\Users\ana"), r"C:\\Users\\ana");
        // Texto que ya venía escapado: se escapa otra vez, entero, sin
        // mezclarse con lo anterior.
        assert_eq!(escape(r"\\"), r"\\\\");
    }

    #[test]
    fn letters_with_accents_emojis_and_cjk_are_left_alone() {
        for input in [
            "Cooperativa Agrícola del Este",
            "ñandú, cigüeña, Mañana",
            "Informe anual 2026 🌾📊",
            "日本語のテキスト",
            "Ελληνικά και кириллица",
            "👩‍👩‍👧‍👦 familia con modificadores",
        ] {
            assert_eq!(escape(input), input, "no hay nada que escapar en {input:?}");
        }
    }

    #[test]
    fn block_markers_are_escaped_only_when_they_open_a_line() {
        assert_eq!(escape("= Título"), r"\= Título");
        assert_eq!(escape("- viñeta"), r"\- viñeta");
        assert_eq!(escape("+ elemento"), r"\+ elemento");

        // A media línea son texto corriente.
        assert_eq!(escape("a = b"), "a = b");
        assert_eq!(escape("saldo - gastos"), "saldo - gastos");
        assert_eq!(escape("2 + 2"), "2 + 2");
    }

    #[test]
    fn block_markers_are_escaped_after_indentation_too() {
        assert_eq!(escape("   = Título"), r"   \= Título");
        assert_eq!(escape("\t- viñeta"), "\t\\- viñeta");
    }

    #[test]
    fn block_markers_are_escaped_on_every_line_not_just_the_first() {
        assert_eq!(
            escape("primera\n= Segunda\n- tercera"),
            "primera\n\\= Segunda\n\\- tercera"
        );
        assert_eq!(escape("primera\r\n= Segunda"), "primera\r\n\\= Segunda");
    }

    #[test]
    fn a_numbered_list_marker_is_escaped_only_right_after_leading_digits() {
        assert_eq!(escape("1. uno"), r"1\. uno");
        assert_eq!(escape("42. cuarenta y dos"), r"42\. cuarenta y dos");
        assert_eq!(escape("  7. siete"), r"  7\. siete");

        // No son marcadores de lista.
        assert_eq!(escape("versión 1. la primera"), "versión 1. la primera");
        assert_eq!(escape("1 . uno"), "1 . uno");
        assert_eq!(escape("uno. dos"), "uno. dos");
        assert_eq!(escape("3.1416"), "3\\.1416");
    }

    /// `//` abre un comentario de línea en Typst y se come el resto de la
    /// línea, incluido el texto que venía detrás.
    #[test]
    fn a_double_slash_cannot_open_a_comment() {
        assert_eq!(escape("20//30"), r"20\/\/30");
        assert_eq!(
            escape("nota // esto no debe desaparecer"),
            r"nota \/\/ esto no debe desaparecer"
        );
        assert_eq!(escape("/* bloque */"), r"\/\* bloque \*\/");
    }

    /// Un `https://` suelto en el texto se convierte solo en un enlace, lo
    /// que contradice al modelo: ese tramo no lleva enlace ninguno.
    #[test]
    fn a_bare_url_does_not_become_a_link() {
        assert_eq!(
            escape("visita https://typst.app hoy"),
            r"visita https:\/\/typst.app hoy"
        );
    }

    #[test]
    fn a_tilde_survives_as_a_tilde() {
        // Sin escapar sería un espacio duro y el carácter desaparecería.
        assert_eq!(escape("~5 kg"), r"\~5 kg");
    }

    /// Las comillas, las rayas y los puntos suspensivos se dejan pasar a
    /// propósito: Typst los compone y se ven igual en el lienzo y en el PDF.
    #[test]
    fn smart_typography_is_left_untouched() {
        assert_eq!(escape(r#"dijo "hola""#), r#"dijo "hola""#);
        assert_eq!(escape("páginas 10--20"), "páginas 10--20");
        assert_eq!(escape("y entonces..."), "y entonces...");
        assert_eq!(escape("l'été"), "l'été");
    }

    #[test]
    fn newlines_and_paragraph_breaks_are_preserved() {
        assert_eq!(escape("uno\ndos"), "uno\ndos");
        assert_eq!(escape("párrafo\n\notro párrafo"), "párrafo\n\notro párrafo");
    }

    #[test]
    fn empty_and_whitespace_only_text_survive() {
        assert_eq!(escape(""), "");
        assert_eq!(escape("   "), "   ");
        assert_eq!(escape("\n\n"), "\n\n");
    }

    #[test]
    fn escape_into_appends_instead_of_replacing() {
        let mut out = String::from("ya estaba: ");
        escape_into("#hola", &mut out);
        assert_eq!(out, r"ya estaba: \#hola");
    }

    /// El estado de línea es de `escape_into`, no del texto acumulado: lo
    /// que ya hubiera en la cadena no decide si estamos al principio de una
    /// línea.
    #[test]
    fn escape_into_starts_each_call_at_the_beginning_of_a_line() {
        let mut out = String::from("texto previo ");
        escape_into("= Título", &mut out);
        assert_eq!(out, r"texto previo \= Título");
    }

    #[test]
    fn a_realistic_paragraph_is_escaped_where_it_must_and_nowhere_else() {
        let input =
            "Informe 2026: el 50% del *total*.\n- Ventas: 1.200 €\nVer https://ejemplo.es/informe";
        let expected = "Informe 2026: el 50% del \\*total\\*.\n\\- Ventas: 1.200 €\nVer https:\\/\\/ejemplo.es\\/informe";
        assert_eq!(escape(input), expected);
    }
}
