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
//! Todavía no. Esta tarea emite el texto de todos los tramos seguido y con
//! el estilo del bloque; la negrita, la cursiva y el subrayado de cada tramo
//! llegan en F4-08. Hasta entonces, un tramo con `"bold": true` se compone
//! en redonda.

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

    let text: String = content.iter().map(|run| run.text.as_str()).collect();
    emit_content(&text, out);

    out.push_str("] })");
    Ok(())
}

/// Escribe el contenido escapado, convirtiendo los saltos de línea en
/// saltos explícitos de Typst.
fn emit_content(text: &str, out: &mut String) {
    // Windows y el Mac clásico también escriben texto: los tres finales de
    // línea significan lo mismo.
    let text = text.replace("\r\n", "\n").replace('\r', "\n");

    let mut rest = text.as_str();
    while let Some(index) = rest.find('\n') {
        escape_into(&rest[..index], out);

        let after = &rest[index..];
        let newlines = after.bytes().take_while(|&byte| byte == b'\n').count();
        // El `;` cierra la expresión: sin él, un `(` o un `.` al principio
        // de la línea siguiente se leería como parte de la llamada.
        out.push_str(if newlines >= 2 {
            "#parbreak();"
        } else {
            "#linebreak();"
        });

        rest = &after[newlines..];
    }

    escape_into(rest, out);
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
    fn runs_are_joined_in_order() {
        let typst = generate_with(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                 "content": [ { "text": "Informe " }, { "text": "anual", "bold": true } ],
                 "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        assert!(typst.contains("[Informe anual]"), "{typst}");
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
