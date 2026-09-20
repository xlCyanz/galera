//! El texto de un bloque: sus tramos y lo que se puede hacer con ellos.
//!
//! El contenido de un bloque de texto es una lista de [`Run`], cada uno con
//! su formato. Escribir, borrar y dar formato cambian esa lista, y este
//! módulo es el único sitio donde se hace: los comandos de `ops::text` se
//! apoyan en él, y la interfaz no reparte tramos por su cuenta
//! (principio 5).
//!
//! # Las posiciones se cuentan en clústeres de grafemas
//!
//! Ni en bytes ni en puntos de código: en lo que una persona ve como un
//! carácter. `é` escrito como `e` + tilde combinante son dos puntos de
//! código y un solo carácter; `👩‍🌾` son cuatro puntos de código y once
//! bytes, y también un solo carácter. Contar de otra forma parte los
//! emojis por la mitad y deja acentos sueltos.
//!
//! Las posiciones van sobre el **texto entero** del bloque, no sobre cada
//! tramo: los límites de los clústeres se miran en el texto ya junto, así
//! que una tilde combinante al principio de un tramo sigue pegada a su
//! letra aunque esté en el tramo de antes.
//!
//! # Normalizado
//!
//! Después de cada cambio, la lista queda **normalizada**: sin tramos
//! vacíos y sin dos seguidos con el mismo formato ([`normalize`]). Así el
//! mismo texto con el mismo formato se guarda siempre igual, que es lo que
//! hace comparables el JSON y las instantáneas de las pruebas.

use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

use super::Run;

/// No se puede tocar ese trozo de texto.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TextError {
    /// La posición está más allá del final del texto.
    #[error("el texto tiene {length} caracteres y se pidió la posición {at}")]
    OutOfRange {
        /// La posición que se pidió.
        at: usize,
        /// Lo que mide el texto, en caracteres.
        length: usize,
    },
    /// El tramo empieza después de donde acaba.
    #[error("el tramo va de {from} a {to}, al revés")]
    Backwards {
        /// Donde empieza.
        from: usize,
        /// Donde acaba.
        to: usize,
    },
}

/// Qué formato se cambia en un tramo. Lo que va a `None` se queda como
/// estaba: poner en negrita una selección no toca su cursiva.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "ops.ts"))]
pub struct Format {
    /// Negrita.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    /// Cursiva.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Subrayado.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    /// Color del tramo. Ponerlo a nulo lo quita, y el texto vuelve al
    /// color del bloque.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Option<String>>,
}

impl Format {
    /// Aplica el cambio a un tramo.
    fn apply(&self, run: &mut Run) {
        if let Some(bold) = self.bold {
            run.bold = bold;
        }
        if let Some(italic) = self.italic {
            run.italic = italic;
        }
        if let Some(underline) = self.underline {
            run.underline = underline;
        }
        if let Some(color) = &self.color {
            run.color.clone_from(color);
        }
    }

    /// Si no cambia nada.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// El texto del bloque: sus tramos, uno detrás de otro.
pub fn text(runs: &[Run]) -> String {
    runs.iter().map(|run| run.text.as_str()).collect()
}

/// Lo que mide el texto, en caracteres (clústeres de grafemas).
pub fn length(runs: &[Run]) -> usize {
    text(runs).graphemes(true).count()
}

/// Mete `insertion` en la posición `at`.
///
/// El texto nuevo se queda con el formato del tramo que tiene a la
/// izquierda, que es lo que espera quien escribe: seguir una palabra en
/// negrita sale en negrita. Al principio del todo, con el del primer tramo.
///
/// # Errores
///
/// [`TextError::OutOfRange`] si `at` pasa del final del texto.
pub fn insert(runs: &mut Vec<Run>, at: usize, insertion: &str) -> Result<(), TextError> {
    let byte = byte_at(&text(runs), at)?;
    if insertion.is_empty() {
        return Ok(());
    }
    match run_at(runs, byte) {
        Some((index, offset)) => runs[index].text.insert_str(offset, insertion),
        // Sin tramos, o pegado al final del último.
        None => match runs.last_mut() {
            Some(last) => last.text.push_str(insertion),
            None => runs.push(Run::plain(insertion)),
        },
    }
    normalize(runs);
    Ok(())
}

/// Borra el tramo `[from, to)`.
///
/// # Errores
///
/// [`TextError::OutOfRange`] si alguna posición pasa del final, y
/// [`TextError::Backwards`] si el tramo va al revés.
pub fn remove(runs: &mut Vec<Run>, from: usize, to: usize) -> Result<(), TextError> {
    let whole = text(runs);
    let (start, end) = range(&whole, from, to)?;
    if start == end {
        return Ok(());
    }

    let mut at = 0;
    for run in runs.iter_mut() {
        let first = at;
        at += run.text.len();
        // Lo que este tramo tiene fuera del trozo que se borra.
        let head = &run.text[..run.text.len().min(start.saturating_sub(first))];
        let tail = if end > first {
            &run.text[run.text.len().min(end - first)..]
        } else {
            run.text.as_str()
        };
        run.text = format!("{head}{tail}");
    }
    normalize(runs);
    Ok(())
}

/// Cambia el formato del tramo `[from, to)`, partiendo solo los tramos que
/// toca.
///
/// # Errores
///
/// Los de [`remove`].
pub fn format(
    runs: &mut Vec<Run>,
    from: usize,
    to: usize,
    change: &Format,
) -> Result<(), TextError> {
    let whole = text(runs);
    let (start, end) = range(&whole, from, to)?;
    if start == end || change.is_empty() {
        return Ok(());
    }

    let mut out: Vec<Run> = Vec::with_capacity(runs.len() + 2);
    let mut at = 0;
    for run in runs.iter() {
        let first = at;
        let last = first + run.text.len();
        at = last;

        // Los tres trozos del tramo: antes, dentro y después del cambio.
        for (piece, inside) in [
            (&run.text[..clamp(start, first, last)], false),
            (
                &run.text[clamp(start, first, last)..clamp(end, first, last)],
                true,
            ),
            (&run.text[clamp(end, first, last)..], false),
        ] {
            if piece.is_empty() {
                continue;
            }
            let mut piece_run = Run {
                text: piece.to_owned(),
                ..run.clone()
            };
            if inside {
                change.apply(&mut piece_run);
            }
            out.push(piece_run);
        }
    }

    *runs = out;
    normalize(runs);
    Ok(())
}

/// Quita los tramos vacíos y junta los seguidos que tienen el mismo
/// formato.
pub fn normalize(runs: &mut Vec<Run>) {
    runs.retain(|run| !run.text.is_empty());
    let mut merged: Vec<Run> = Vec::with_capacity(runs.len());
    for run in runs.drain(..) {
        match merged.last_mut() {
            Some(last) if same_format(last, &run) => last.text.push_str(&run.text),
            _ => merged.push(run),
        }
    }
    *runs = merged;
}

/// Si dos tramos solo se diferencian en el texto.
fn same_format(one: &Run, other: &Run) -> bool {
    one.bold == other.bold
        && one.italic == other.italic
        && one.underline == other.underline
        && one.color == other.color
}

/// El byte donde empieza el carácter número `at`; el final del texto si
/// `at` es justo su longitud.
fn byte_at(text: &str, at: usize) -> Result<usize, TextError> {
    if at == 0 {
        return Ok(0);
    }
    let mut count = 0;
    for (byte, cluster) in text.grapheme_indices(true) {
        count += 1;
        if count == at {
            return Ok(byte + cluster.len());
        }
    }
    Err(TextError::OutOfRange {
        at,
        length: text.graphemes(true).count(),
    })
}

/// Los dos extremos de un tramo, en bytes.
fn range(text: &str, from: usize, to: usize) -> Result<(usize, usize), TextError> {
    if from > to {
        return Err(TextError::Backwards { from, to });
    }
    Ok((byte_at(text, from)?, byte_at(text, to)?))
}

/// En qué tramo cae un byte del texto entero, y en qué posición dentro de
/// él. `None` si no hay tramos.
///
/// Justo en el límite entre dos tramos, el de la izquierda: lo que se
/// escriba ahí sigue el formato de lo que ya había delante.
fn run_at(runs: &[Run], byte: usize) -> Option<(usize, usize)> {
    if byte == 0 {
        return (!runs.is_empty()).then_some((0, 0));
    }
    let mut at = 0;
    for (index, run) in runs.iter().enumerate() {
        let next = at + run.text.len();
        if byte <= next {
            return Some((index, byte - at));
        }
        at = next;
    }
    None
}

/// Ajusta un byte del texto entero a los límites de un tramo, y lo pasa a
/// posición dentro de él.
fn clamp(byte: usize, first: usize, last: usize) -> usize {
    byte.clamp(first, last) - first
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un emoji de los que se escriben con varios puntos de código: mujer
    /// + unión + espiga.
    const FARMER: &str = "👩‍🌾";
    /// Una `é` escrita como `e` más tilde combinante.
    const COMBINED: &str = "e\u{301}";

    fn plain(text: &str) -> Run {
        Run::plain(text)
    }

    fn bold(text: &str) -> Run {
        Run {
            text: text.to_owned(),
            bold: true,
            italic: false,
            underline: false,
            color: None,
        }
    }

    /// Los tramos como `texto` o `texto*` si van en negrita.
    fn shown(runs: &[Run]) -> String {
        runs.iter()
            .map(|run| format!("{}{}", run.text, if run.bold { "*" } else { "" }))
            .collect::<Vec<String>>()
            .join("|")
    }

    #[test]
    fn the_text_is_measured_in_characters_not_in_bytes() {
        let runs = vec![plain("Hola "), bold(FARMER)];
        assert_eq!(text(&runs), format!("Hola {FARMER}"));
        // Cinco letras y un emoji, aunque el emoji ocupe once bytes.
        assert_eq!(length(&runs), 6);
        assert_eq!(text(&runs).len(), 16);

        // Una tilde combinante no cuenta aparte de su letra.
        assert_eq!(length(&[plain(COMBINED)]), 1);
        assert_eq!(length(&[plain("e"), plain("\u{301}")]), 1);
    }

    #[test]
    fn writing_follows_the_format_of_what_is_on_its_left() {
        let mut runs = vec![plain("Hola "), bold("mundo")];
        insert(&mut runs, 10, "s").expect("cabe");
        assert_eq!(shown(&runs), "Hola |mundos*");

        // En el límite entre dos tramos, el de la izquierda.
        insert(&mut runs, 5, "X").expect("cabe");
        assert_eq!(shown(&runs), "Hola X|mundos*");

        // Al principio del todo, el del primero.
        insert(&mut runs, 0, "¡").expect("cabe");
        assert_eq!(shown(&runs), "¡Hola X|mundos*");
    }

    #[test]
    fn writing_in_an_empty_text_starts_a_plain_run() {
        let mut runs = Vec::new();
        insert(&mut runs, 0, "Hola").expect("cabe");
        assert_eq!(runs, vec![plain("Hola")]);
    }

    #[test]
    fn writing_after_an_emoji_does_not_cut_it() {
        let mut runs = vec![plain(FARMER)];
        insert(&mut runs, 1, "!").expect("cabe");
        assert_eq!(text(&runs), format!("{FARMER}!"));

        // Y escribir delante tampoco.
        insert(&mut runs, 0, "¡").expect("cabe");
        assert_eq!(text(&runs), format!("¡{FARMER}!"));
    }

    #[test]
    fn deleting_takes_whole_characters() {
        let mut runs = vec![plain(format!("hola {FARMER}").as_str())];
        remove(&mut runs, 5, 6).expect("está");
        assert_eq!(text(&runs), "hola ");

        // Una letra con tilde combinante se borra entera.
        let mut combined = vec![plain(format!("caf{COMBINED}").as_str())];
        remove(&mut combined, 3, 4).expect("está");
        assert_eq!(text(&combined), "caf");
    }

    #[test]
    fn deleting_across_runs_keeps_what_is_left_of_each() {
        let mut runs = vec![plain("uno "), bold("dos"), plain(" tres")];
        remove(&mut runs, 2, 9).expect("está");
        // El tramo en negrita se va entero, y los dos trozos sin formato
        // que quedan pegados se juntan en uno.
        assert_eq!(shown(&runs), "unres");
        assert_eq!(runs.len(), 1);
    }

    #[test]
    fn deleting_a_whole_run_leaves_no_empty_run() {
        let mut runs = vec![plain("uno "), bold("dos"), plain(" tres")];
        remove(&mut runs, 4, 7).expect("está");
        // Los dos tramos sin formato que quedan pegados se juntan.
        assert_eq!(shown(&runs), "uno  tres");
        assert_eq!(runs.len(), 1);

        let whole = length(&runs);
        remove(&mut runs, 0, whole).expect("está");
        assert!(runs.is_empty());
        assert_eq!(text(&runs), "");
    }

    #[test]
    fn formatting_a_range_splits_only_the_runs_it_touches() {
        let mut runs = vec![plain("uno dos"), plain(" tres")];
        format(
            &mut runs,
            4,
            7,
            &Format {
                bold: Some(true),
                ..Format::default()
            },
        )
        .expect("está");
        assert_eq!(shown(&runs), "uno |dos*| tres");
    }

    /// El color se aplica al tramo y se quita volviendo al del bloque.
    #[test]
    fn the_colour_of_a_range_is_set_and_cleared() {
        let mut runs = vec![plain("uno dos")];
        format(
            &mut runs,
            4,
            7,
            &Format {
                color: Some(Some("#B4161B".to_owned())),
                ..Format::default()
            },
        )
        .expect("está");
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[1].color.as_deref(), Some("#B4161B"));

        format(
            &mut runs,
            0,
            7,
            &Format {
                color: Some(None),
                ..Format::default()
            },
        )
        .expect("está");
        // Sin color, los dos tramos vuelven a ser el mismo.
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].color, None);
    }

    #[test]
    fn formatting_leaves_the_other_attributes_alone() {
        let mut runs = vec![Run {
            text: "uno".to_owned(),
            bold: false,
            italic: true,
            underline: false,
            color: None,
        }];
        format(
            &mut runs,
            0,
            3,
            &Format {
                bold: Some(true),
                ..Format::default()
            },
        )
        .expect("está");
        assert!(runs[0].bold && runs[0].italic);
    }

    #[test]
    fn formatting_the_same_way_joins_the_runs_again() {
        let mut runs = vec![plain("uno "), bold("dos")];
        format(
            &mut runs,
            0,
            7,
            &Format {
                bold: Some(true),
                ..Format::default()
            },
        )
        .expect("está");
        assert_eq!(shown(&runs), "uno dos*");

        format(
            &mut runs,
            0,
            7,
            &Format {
                bold: Some(false),
                ..Format::default()
            },
        )
        .expect("está");
        assert_eq!(shown(&runs), "uno dos");
    }

    #[test]
    fn an_emoji_is_formatted_whole() {
        let mut runs = vec![plain(format!("a{FARMER}b").as_str())];
        format(
            &mut runs,
            1,
            2,
            &Format {
                bold: Some(true),
                ..Format::default()
            },
        )
        .expect("está");
        assert_eq!(shown(&runs), format!("a|{FARMER}*|b"));
    }

    #[test]
    fn normalizing_drops_the_empty_ones_and_joins_the_equal_ones() {
        let mut runs = vec![
            plain("uno"),
            plain(""),
            plain(" dos"),
            bold(""),
            bold("tres"),
        ];
        normalize(&mut runs);
        assert_eq!(shown(&runs), "uno dos|tres*");
    }

    #[test]
    fn a_position_beyond_the_end_is_an_error() {
        let mut runs = vec![plain("hola")];
        assert_eq!(
            insert(&mut runs, 5, "x"),
            Err(TextError::OutOfRange { at: 5, length: 4 })
        );
        assert_eq!(
            remove(&mut runs, 0, 9),
            Err(TextError::OutOfRange { at: 9, length: 4 })
        );
        assert_eq!(
            remove(&mut runs, 3, 1),
            Err(TextError::Backwards { from: 3, to: 1 })
        );
        // Justo al final sí vale: ahí se escribe.
        insert(&mut runs, 4, "!").expect("cabe");
        assert_eq!(text(&runs), "hola!");
    }

    #[test]
    fn nothing_to_do_changes_nothing() {
        let mut runs = vec![plain("uno "), bold("dos")];
        let before = runs.clone();
        insert(&mut runs, 2, "").expect("cabe");
        remove(&mut runs, 3, 3).expect("está");
        format(&mut runs, 0, 7, &Format::default()).expect("está");
        assert_eq!(runs, before);
    }
}
