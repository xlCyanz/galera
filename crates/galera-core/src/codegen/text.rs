//! Cuerpo de los bloques de texto.
//!
//! Es la primera pieza del codegen por la que entra texto escrito por una
//! persona, así que es donde el principio 6 del README deja de ser teoría:
//! **todo** el contenido pasa por [`escape_into`] antes de escribirse.
//!
//! # Forma del cuerpo
//!
//! ```typst
//! #block(width: 170mm, { set text(font: "Inter", size: 28pt, fill: rgb("#1F2733")); set par(leading: 0.65em); align(left)[Informe anual] })
//! ```
//!
//! - **`block`, no `box`.** `box` es un elemento en línea y no admite
//!   párrafos; un bloque de texto de Galera es un marco que puede tener
//!   varios.
//! - **Las reglas `set` van dentro de un bloque de código**, separadas por
//!   `;`. Así el estilo solo afecta a este elemento y el cuerpo entero cabe
//!   en una línea, que es como el resto del archivo generado.
//! - **Con alto fijo, el texto puede desbordarse.** `block` no recorta por
//!   defecto. Avisar de ello es la tarea F4-10.
//!
//! # Saltos de línea
//!
//! En el marcado de Typst un salto de línea suelto no rompe la línea: es un
//! espacio. Solo una línea en blanco separa párrafos. En Galera, en cambio,
//! lo que la persona escribe es lo que se ve, así que:
//!
//! - un salto de línea se emite como `#linebreak();`;
//! - dos o más seguidos, como `#parbreak();`.
//!
//! El `;` no es decoración. Una expresión incrustada con `#` sigue
//! consumiendo todo lo que pueda continuarla: si la línea siguiente empieza
//! por `(`, `#linebreak()(dos)` sería una llamada sobre el resultado de
//! `linebreak()`, y si empieza por `.`, un acceso a un campo. El `;` la
//! cierra y devuelve el control al marcado.
//!
//! Cada línea se escapa por separado, y eso es justo lo correcto: cada una
//! empieza de verdad al principio de línea, donde `= Título` o `- viñeta`
//! serían marcado si no se escaparan.
//!
//! # Formato por tramos
//!
//! Cada tramo se envuelve en el marcado que le toca, de dentro afuera:
//! `emph` para la cursiva, `strong` para la negrita, `underline` para el
//! subrayado y `text(fill: …)` para el color. Un tramo sin formato se
//! escribe tal cual, sin envoltorio.
//!
//! ```typst
//! Informe #strong[anual] de #text(fill: rgb("#B4161B"))[#emph[2026]]
//! ```
//!
//! Los saltos de línea se quedan **fuera** de los envoltorios: un
//! `#parbreak();` dentro de un `#strong[…]` abriría los párrafos dentro de
//! la negrita, y lo que se quiere es lo contrario. Por eso cada tramo se
//! parte por sus saltos y se envuelve cada trozo.
//!
//! El texto sigue pasando por `escape_into` tramo a trozo: el formato no es
//! una vía para colar marcado (principio 6).

use crate::model::{Align, ElementBox, Run, TextStyle};

use super::{CodegenError, color, escape_into, millimeters, number, typst_string};

/// Escribe un bloque de texto.
pub(super) fn emit_text(
    base: &ElementBox,
    content: &[Run],
    style: &TextStyle,
    out: &mut String,
) -> Result<(), CodegenError> {
    out.push_str(&format!("#block(width: {}", millimeters(base.w)));

    // Sin alto, lo mide Typst (principio 3). Con alto, el texto que no quepa
    // se sale del marco en vez de recortarse.
    if let Some(height) = base.h {
        out.push_str(&format!(", height: {}", millimeters(height)));
    }

    out.push_str(&format!(
        ", {{ set text(font: {}, size: {}, fill: {}); set par(leading: {}em",
        typst_string(&style.font),
        points(style.size),
        color(&style.color)?,
        number(style.leading),
    ));

    if let Some(spacing) = style.spacing {
        out.push_str(&format!(", spacing: {}em", number(spacing)));
    }

    // Typst no justifica con `align`: la justificación es del párrafo.
    if style.align == Align::Justify {
        out.push_str(", justify: true");
    }

    out.push_str(&format!("); align({})[", horizontal_alignment(style.align)));

    emit_content(content, out)?;

    out.push_str("] })");
    Ok(())
}

/// Escribe el contenido: cada tramo escapado, con su formato, y los saltos
/// de línea del documento como saltos explícitos de Typst.
fn emit_content(content: &[Run], out: &mut String) -> Result<(), CodegenError> {
    // Cuántos saltos de línea hay pendientes de escribir. Se cuentan sin
    // escribirlos todavía porque dos seguidos no son lo mismo que uno, y
    // pueden quedar repartidos entre dos tramos.
    let mut newlines = 0;

    for run in content {
        // Windows y el Mac clásico también escriben texto: los tres finales
        // de línea significan lo mismo.
        let text = run.text.replace("\r\n", "\n").replace('\r', "\n");

        for (at, piece) in text.split('\n').enumerate() {
            // Entre dos trozos de un mismo tramo hay siempre un salto.
            if at > 0 {
                newlines += 1;
            }
            if piece.is_empty() {
                continue;
            }
            emit_break(&mut newlines, out);
            emit_run(piece, run, out)?;
        }
    }

    emit_break(&mut newlines, out);
    Ok(())
}

/// Escribe los saltos de línea que hubiera pendientes.
///
/// El `;` cierra la expresión: sin él, un `(` o un `.` al principio de la
/// línea siguiente se leería como parte de la llamada.
fn emit_break(newlines: &mut usize, out: &mut String) {
    if *newlines == 0 {
        return;
    }
    out.push_str(if *newlines >= 2 {
        "#parbreak();"
    } else {
        "#linebreak();"
    });
    *newlines = 0;
}

/// Escribe un trozo de tramo, escapado y con el formato de su tramo.
fn emit_run(piece: &str, run: &Run, out: &mut String) -> Result<(), CodegenError> {
    let mut wrapped = String::with_capacity(piece.len() + 16);
    escape_into(piece, &mut wrapped);

    // De dentro afuera: la cursiva pegada al texto, el color por fuera.
    for (applies, markup) in [
        (run.italic, "emph"),
        (run.bold, "strong"),
        (run.underline, "underline"),
    ] {
        if applies {
            wrapped = format!("#{markup}[{wrapped}]");
        }
    }
    if let Some(value) = &run.color {
        wrapped = format!("#text(fill: {})[{wrapped}]", color(value)?);
    }

    out.push_str(&wrapped);
    Ok(())
}

/// La alineación horizontal de Typst que corresponde a la del modelo.
///
/// La justificada se alinea a la izquierda: la última línea de un párrafo
/// justificado queda así, y el resto lo reparte `par(justify: true)`.
fn horizontal_alignment(align: Align) -> &'static str {
    match align {
        Align::Left | Align::Justify => "left",
        Align::Center => "center",
        Align::Right => "right",
    }
}

/// Un tamaño tipográfico en puntos, tal como lo entiende Typst.
fn points(value: f64) -> String {
    format!("{}pt", number(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::generate;
    use crate::model::Document;

    fn generate_with(element: &str) -> String {
        let json = format!(
            r#"{{
              "version": 1,
              "meta": {{ "title": "Texto" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{element}]
              }}]
            }}"#
        );
        let document = Document::from_json_str(&json).expect("el documento debe deserializar");
        generate(&document).expect("el documento debe generar código")
    }

    /// Un bloque de texto con el contenido y la alineación que se pidan.
    fn text_element(content: &str, align: &str, h: &str) -> String {
        let content = serde_json::to_string(content).expect("un str siempre serializa");
        format!(
            r##"{{ "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": {h},
                   "content": [{{ "text": {content} }}],
                   "style": {{ "font": "Inter", "size": 28, "color": "#1F2733",
                              "align": "{align}", "leading": 0.65 }} }}"##
        )
    }

    fn plain(content: &str) -> String {
        generate_with(&text_element(content, "left", "null"))
    }

    /// Un texto se puede quedar sin tramos: borrar todo lo que tenía
    /// (`ops::text`) deja el contenido vacío, y eso también tiene que
    /// generar código.
    #[test]
    fn a_text_without_runs_is_an_empty_block() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": null,
                  "content": [],
                  "style": { "font": "Inter", "size": 28, "color": "#1F2733",
                             "align": "left", "leading": 0.65 } }"##,
        );
        assert!(typst.contains("align(left)[]"), "{typst}");
    }

    #[test]
    fn the_block_takes_the_element_width_and_the_style() {
        let typst = plain("Informe anual");
        assert!(
            typst.contains(
                r##"#block(width: 170mm, { set text(font: "Inter", size: 28pt, fill: rgb("#1F2733")); set par(leading: 0.65em); align(left)[Informe anual] })"##
            ),
            "{typst}"
        );
    }

    #[test]
    fn a_null_height_is_left_for_typst_to_measure() {
        let typst = plain("x");
        assert!(typst.contains("#block(width: 170mm, {"), "{typst}");
        assert!(!typst.contains("#block(width: 170mm, height:"), "{typst}");
    }

    /// Con alto fijo el marco no recorta: el texto que no quepa se sale, y
    /// avisar de ello es cosa de F4-10.
    #[test]
    fn a_fixed_height_is_written_and_nothing_is_clipped() {
        let typst = generate_with(&text_element("x", "left", "40"));
        assert!(
            typst.contains("#block(width: 170mm, height: 40mm, {"),
            "{typst}"
        );
        assert!(!typst.contains("clip"), "{typst}");
    }

    #[test]
    fn every_alignment_is_honoured() {
        for (model, typst_align) in [("left", "left"), ("center", "center"), ("right", "right")] {
            let typst = generate_with(&text_element("x", model, "null"));
            assert!(
                typst.contains(&format!("align({typst_align})[x]")),
                "{model}: {typst}"
            );
            assert!(!typst.contains("justify"), "{model}: {typst}");
        }
    }

    #[test]
    fn justified_text_is_justified_by_the_paragraph() {
        let typst = generate_with(&text_element("x", "justify", "null"));
        assert!(
            typst.contains("set par(leading: 0.65em, justify: true); align(left)[x]"),
            "{typst}"
        );
    }

    /// El criterio central de la tarea: el texto pasa siempre por el escape.
    #[test]
    fn the_content_is_always_escaped() {
        let typst = plain("#let x = 1 y *negrita* con $dinero$ @ref <etiqueta> [a] // nota");
        assert!(
            typst.contains(
                r"align(left)[\#let x = 1 y \*negrita\* con \$dinero\$ \@ref \<etiqueta\> \[a\] \/\/ nota]"
            ),
            "{typst}"
        );
    }

    /// El contenido no puede cerrar el `[` del `align` ni la llave del
    /// bloque de código.
    #[test]
    fn content_cannot_break_out_of_the_block() {
        let typst = plain("] }) #import \"evil.typ\" #block({ [");
        assert!(
            typst.contains(r#"align(left)[\] }) \#import "evil.typ" \#block({ \[] })"#),
            "{typst}"
        );
    }

    #[test]
    fn a_single_newline_becomes_a_line_break() {
        let typst = plain("uno\ndos");
        assert!(typst.contains("[uno#linebreak();dos]"), "{typst}");
    }

    #[test]
    fn a_blank_line_becomes_a_paragraph_break() {
        assert!(plain("uno\n\ndos").contains("[uno#parbreak();dos]"));
        assert!(plain("uno\n\n\n\ndos").contains("[uno#parbreak();dos]"));
    }

    #[test]
    fn windows_and_classic_mac_line_endings_mean_the_same() {
        assert!(plain("uno\r\ndos").contains("[uno#linebreak();dos]"));
        assert!(plain("uno\rdos").contains("[uno#linebreak();dos]"));
        assert!(plain("uno\r\n\r\ndos").contains("[uno#parbreak();dos]"));
    }

    /// Sin el `;`, lo que empieza la línea siguiente se leería como parte de
    /// la llamada: `#linebreak()(dos)` llamaría al resultado de
    /// `linebreak()`, y `#linebreak().dos` accedería a un campo.
    #[test]
    fn a_break_cannot_swallow_the_start_of_the_next_line() {
        assert!(plain("uno\n(dos)").contains("[uno#linebreak();(dos)]"));
        assert!(plain("uno\n.dos").contains("[uno#linebreak();.dos]"));
        assert!(plain("uno\n\n(dos)").contains("[uno#parbreak();(dos)]"));
        assert!(plain("uno\n[dos]").contains(r"[uno#linebreak();\[dos\]]"));
    }

    /// Cada línea empieza de verdad al principio de línea, así que los
    /// marcadores de bloque se escapan en todas, no solo en la primera.
    #[test]
    fn block_markers_are_escaped_on_every_line() {
        let typst = plain("= Título\n- viñeta\n\n1. uno");
        assert!(
            typst.contains(r"[\= Título#linebreak();\- viñeta#parbreak();1\. uno]"),
            "{typst}"
        );
    }

    #[test]
    fn runs_are_joined_in_order_each_with_its_format() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [ { "text": "Informe " }, { "text": "anual", "bold": true } ],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(typst.contains("[Informe #strong[anual]]"), "{typst}");
    }

    /// El criterio de la tarea: cada tramo lleva su marcado, de dentro
    /// afuera, y un tramo sin formato no lleva envoltorio.
    #[test]
    fn every_kind_of_format_has_its_markup() {
        let run = |format: &str| {
            generate_with(&format!(
                r##"{{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                     "content": [ {{ "text": "texto"{format} }} ],
                     "style": {{ "font": "Inter", "size": 12, "color": "#000000" }} }}"##
            ))
        };

        assert!(run("").contains("align(left)[texto]"));
        assert!(run(r#", "bold": true"#).contains("[#strong[texto]]"));
        assert!(run(r#", "italic": true"#).contains("[#emph[texto]]"));
        assert!(run(r#", "underline": true"#).contains("[#underline[texto]]"));
        assert!(
            run(r##", "color": "#B4161B""##).contains(r##"[#text(fill: rgb("#B4161B"))[texto]]"##)
        );

        // Todo a la vez: la cursiva pegada al texto y el color por fuera.
        let all = run(r##", "bold": true, "italic": true, "underline": true, "color": "#B4161B""##);
        assert!(
            all.contains(r##"[#text(fill: rgb("#B4161B"))[#underline[#strong[#emph[texto]]]]]"##),
            "{all}"
        );
    }

    /// Los saltos de línea se quedan fuera del formato: un `parbreak` dentro
    /// de una negrita abriría los párrafos dentro de ella.
    #[test]
    fn line_breaks_stay_outside_the_format() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [ { "text": "uno\ndos\n\ntres", "bold": true } ],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(
            typst.contains("[#strong[uno]#linebreak();#strong[dos]#parbreak();#strong[tres]]"),
            "{typst}"
        );
    }

    /// Un salto repartido entre dos tramos sigue contando como uno solo.
    #[test]
    fn a_break_split_between_two_runs_is_still_one_break() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [ { "text": "uno\n" }, { "text": "\ndos", "bold": true } ],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(typst.contains("[uno#parbreak();#strong[dos]]"), "{typst}");
    }

    /// El formato no es una vía para colar marcado: el texto de cada tramo
    /// sigue pasando por el escape (principio 6).
    #[test]
    fn a_formatted_run_is_still_escaped() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [ { "text": "#let x = 1", "bold": true } ],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(typst.contains(r"[#strong[\#let x = 1]]"), "{typst}");
    }

    /// Un color que no es un color no se escribe: se rechaza el documento.
    #[test]
    fn a_run_with_an_impossible_color_is_refused() {
        let json = format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Texto" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{}]
              }}]
            }}"##,
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [ { "text": "texto", "color": "rojo" } ],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##
        );
        let document = Document::from_json_str(&json).expect("el documento debe deserializar");
        assert!(document.validate().is_err(), "un color inventado no vale");
    }

    #[test]
    fn empty_content_produces_an_empty_block() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(typst.contains("align(left)[] })"), "{typst}");
    }

    #[test]
    fn an_invalid_text_colour_is_rejected() {
        let json = r##"{
          "version": 1,
          "meta": { "title": "x" },
          "pages": [{
            "id": "p1",
            "size": { "width": 210, "height": 297, "unit": "mm" },
            "elements": [{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
              "content": [{ "text": "x" }],
              "style": { "font": "Inter", "size": 12, "color": "negro" } }]
          }]
        }"##;
        let document = Document::from_json_str(json).expect("debe deserializar");
        assert_eq!(
            generate(&document),
            Err(CodegenError::InvalidColor {
                value: "negro".to_owned()
            })
        );
    }

    /// El nombre de la fuente va en una cadena de Typst. Tercera puerta del
    /// mismo tipo, después de los ids y los colores: aquí basta con escapar,
    /// porque dentro de una cadena solo hay dos caracteres especiales y los
    /// nombres de fuente reales son demasiado variados para una lista blanca.
    #[test]
    fn a_font_name_cannot_break_out_of_its_string() {
        let font = serde_json::to_string(r#"Inter") #import "evil.typ" #text(""#)
            .expect("un str siempre serializa");
        let typst = generate_with(&format!(
            r##"{{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                   "content": [{{ "text": "x" }}],
                   "style": {{ "font": {font}, "size": 12, "color": "#000000" }} }}"##
        ));
        assert!(
            typst
                .contains(r#"set text(font: "Inter\") #import \"evil.typ\" #text(\"", size: 12pt"#),
            "{typst}"
        );
    }

    #[test]
    fn sizes_are_written_in_points() {
        assert_eq!(points(28.0), "28pt");
        assert_eq!(points(10.5), "10.5pt");
    }

    /// La instantánea que pide el criterio: texto con caracteres especiales,
    /// saltos de línea y marcadores de bloque al principio de línea.
    #[test]
    fn special_characters_snapshot() {
        insta::assert_snapshot!(plain(
            "= No es un título\nPrecio: 50$ *sin* IVA #descuento\n\n- tampoco es una lista\nhttps://ejemplo.es // sin comentario ~ con tilde"
        ));
    }

    /// El espacio entre párrafos va en `par` solo si el estilo lo fija; si
    /// no, se deja el de Typst y el código de siempre no cambia.
    #[test]
    fn paragraph_spacing_is_emitted_only_when_set() {
        let with = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 50, "h": null,
                 "content": [{ "text": "x" }],
                 "style": { "font": "Inter", "size": 12, "color": "#000000", "leading": 0.8, "spacing": 1.5 } }"##,
        );
        assert!(
            with.contains("set par(leading: 0.8em, spacing: 1.5em)"),
            "{with}"
        );

        let without = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 50, "h": null,
                 "content": [{ "text": "x" }],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(!without.contains("spacing"), "{without}");
    }
}
