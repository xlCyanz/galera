//! Cuerpo de los elementos geométricos: rectángulo, elipse y línea.
//!
//! Cada función escribe solo el cuerpo. La posición, la rotación y la
//! etiqueta las pone [`super::emit_element`], que es común a todos los tipos
//! de elemento.
//!
//! # Coordenadas de la línea
//!
//! Una línea se coloca en su primer extremo, así que dentro del `place` sus
//! coordenadas son relativas: empieza en `(0mm, 0mm)` y termina en la
//! diferencia hasta el segundo extremo. Si el segundo extremo está arriba o
//! a la izquierda del primero, esa diferencia es negativa, que es lo
//! correcto: el origen lo fija el `place`.

use crate::model::{ElementBox, Stroke};

use super::{CodegenError, color, millimeters};

/// Escribe un rectángulo.
pub(super) fn emit_rect(
    base: &ElementBox,
    fill: Option<&str>,
    stroke: Option<&Stroke>,
    radius: f64,
    out: &mut String,
) -> Result<(), CodegenError> {
    out.push_str("#rect(");
    emit_size(base, out);
    emit_fill(fill, out)?;
    emit_stroke(stroke, out)?;

    // El radio por defecto de Typst ya es cero: emitirlo en cada rectángulo
    // sería ruido en un archivo que también se lee desde el panel de código.
    if radius != 0.0 {
        out.push_str(&format!(", radius: {}", millimeters(radius)));
    }

    out.push(')');
    Ok(())
}

/// Escribe una elipse inscrita en la caja del elemento.
pub(super) fn emit_ellipse(
    base: &ElementBox,
    fill: Option<&str>,
    stroke: Option<&Stroke>,
    out: &mut String,
) -> Result<(), CodegenError> {
    out.push_str("#ellipse(");
    emit_size(base, out);
    emit_fill(fill, out)?;
    emit_stroke(stroke, out)?;
    out.push(')');
    Ok(())
}

/// Escribe un segmento entre dos puntos.
///
/// `x` e `y` son el primer extremo, que es donde el `place` ha puesto el
/// origen; `x2` e `y2`, el segundo, en coordenadas absolutas de página.
pub(super) fn emit_line(
    x: f64,
    y: f64,
    x2: f64,
    y2: f64,
    stroke: &Stroke,
    out: &mut String,
) -> Result<(), CodegenError> {
    out.push_str(&format!(
        "#line(start: (0mm, 0mm), end: ({}, {})",
        millimeters(x2 - x),
        millimeters(y2 - y),
    ));
    emit_stroke(Some(stroke), out)?;
    out.push(')');
    Ok(())
}

/// Escribe `width` y `height`.
///
/// El alto se omite cuando el modelo dice `null`, que es como se pide a
/// Typst que lo mida él (principio 3).
fn emit_size(base: &ElementBox, out: &mut String) {
    out.push_str(&format!("width: {}", millimeters(base.w)));

    if let Some(height) = base.h {
        out.push_str(&format!(", height: {}", millimeters(height)));
    }
}

/// Escribe el relleno, o `none` si el modelo no quiere ninguno.
fn emit_fill(fill: Option<&str>, out: &mut String) -> Result<(), CodegenError> {
    match fill {
        Some(value) => out.push_str(&format!(", fill: {}", color(value)?)),
        None => out.push_str(", fill: none"),
    }
    Ok(())
}

/// Escribe el borde, o `none` si el modelo no quiere ninguno.
///
/// Se usa la forma de diccionario en vez de `0.5mm + rgb(...)` porque deja
/// sitio para el guionado y los extremos sin cambiar la forma de la llamada.
fn emit_stroke(stroke: Option<&Stroke>, out: &mut String) -> Result<(), CodegenError> {
    match stroke {
        Some(stroke) => out.push_str(&format!(
            ", stroke: (paint: {}, thickness: {})",
            color(&stroke.color)?,
            millimeters(stroke.width),
        )),
        None => out.push_str(", stroke: none"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::codegen::{CodegenError, generate};
    use crate::model::Document;

    /// Genera el código de un documento de una página con los elementos que
    /// se le pasen, ya escritos como JSON.
    fn generate_with(elements: &str) -> String {
        let document = document_with(elements);
        generate(&document).expect("el documento debe generar código")
    }

    fn document_with(elements: &str) -> Document {
        let json = format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Formas" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{elements}]
              }}]
            }}"##
        );
        Document::from_json_str(&json).expect("el documento debe deserializar")
    }

    const RECT: &str = r##"{ "id": "r1", "type": "rect", "x": 10, "y": 20, "w": 100, "h": 50,
        "fill": "#1e40af", "stroke": { "color": "#000000", "width": 0.5 }, "radius": 3 }"##;

    const ELLIPSE: &str = r##"{ "id": "e1", "type": "ellipse", "x": 10, "y": 20, "w": 40, "h": 40,
        "fill": "#ff0000", "stroke": null }"##;

    const LINE: &str = r##"{ "id": "l1", "type": "line", "x": 10, "y": 20, "x2": 100, "y2": 20,
        "stroke": { "color": "#000000", "width": 0.5 } }"##;

    #[test]
    fn a_rect_keeps_its_size_fill_stroke_and_radius() {
        let typst = generate_with(RECT);
        assert!(
            typst.contains(
                r##"#rect(width: 100mm, height: 50mm, fill: rgb("#1e40af"), stroke: (paint: rgb("#000000"), thickness: 0.5mm), radius: 3mm)"##
            ),
            "{typst}"
        );
    }

    #[test]
    fn an_ellipse_keeps_its_size_and_fill() {
        let typst = generate_with(ELLIPSE);
        assert!(
            typst.contains(
                r##"#ellipse(width: 40mm, height: 40mm, fill: rgb("#ff0000"), stroke: none)"##
            ),
            "{typst}"
        );
    }

    #[test]
    fn a_line_runs_between_its_two_endpoints() {
        let typst = generate_with(LINE);
        assert!(
            typst.contains(
                r##"#line(start: (0mm, 0mm), end: (90mm, 0mm), stroke: (paint: rgb("#000000"), thickness: 0.5mm))"##
            ),
            "{typst}"
        );
        // Y el `place` la ha puesto en su primer extremo.
        assert!(
            typst.contains("#place(top + left, dx: 10mm, dy: 20mm)"),
            "{typst}"
        );
    }

    /// El segundo extremo puede estar arriba o a la izquierda del primero.
    #[test]
    fn a_line_that_goes_backwards_gets_negative_deltas() {
        let typst = generate_with(
            r##"{ "id": "l1", "type": "line", "x": 100, "y": 200, "x2": 10, "y2": 20,
                 "stroke": { "color": "#000000", "width": 0.5 } }"##,
        );
        assert!(
            typst.contains("#line(start: (0mm, 0mm), end: (-90mm, -180mm)"),
            "{typst}"
        );
    }

    /// El criterio de la tarea: no querer relleno o no querer borde es una
    /// respuesta válida del modelo, no un error.
    #[test]
    fn a_shape_without_fill_or_stroke_is_not_an_error() {
        let typst = generate_with(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                 "fill": null, "stroke": null }"##,
        );
        assert!(typst.contains("fill: none"), "{typst}");
        assert!(typst.contains("stroke: none"), "{typst}");
    }

    #[test]
    fn an_automatic_height_is_left_for_typst_to_measure() {
        let typst = generate_with(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": null,
                 "fill": null, "stroke": null }"##,
        );
        // El alto de la página sí aparece en la cabecera; el del rectángulo no.
        assert!(
            typst.contains("#rect(width: 10mm, fill: none, stroke: none)"),
            "{typst}"
        );
        assert!(!typst.contains("#rect(width: 10mm, height:"), "{typst}");
    }

    /// Un radio de cero es el valor por defecto de Typst: emitirlo en cada
    /// rectángulo solo ensucia el archivo generado.
    #[test]
    fn a_zero_radius_is_not_written_out() {
        let typst = generate_with(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                 "fill": null, "stroke": null, "radius": 0 }"##,
        );
        assert!(!typst.contains("radius"), "{typst}");
    }

    #[test]
    fn every_hex_colour_shape_typst_understands_is_accepted() {
        for value in ["#abc", "#abcd", "#1e40af", "#1e40afcc", "#ABCDEF"] {
            let typst = generate_with(&format!(
                r##"{{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                      "fill": "{value}", "stroke": null }}"##
            ));
            assert!(
                typst.contains(&format!(r##"fill: rgb("{value}")"##)),
                "{value} debería valer: {typst}"
            );
        }
    }

    /// El color va dentro de una cadena de Typst. Si se aceptara cualquier
    /// texto, un documento ajeno podría cerrarla y escribir código detrás.
    #[test]
    fn anything_that_is_not_a_hex_colour_is_rejected() {
        for value in [
            "rojo",
            "#12345",
            "#",
            "",
            "#1e40aff",
            "#zzzzzz",
            r##"#000") #import "evil.typ" #rgb(""##,
        ] {
            let json = serde_json::to_string(value).expect("un str siempre serializa");
            let document = document_with(&format!(
                r##"{{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                      "fill": {json}, "stroke": null }}"##
            ));
            assert_eq!(
                generate(&document),
                Err(CodegenError::InvalidColor {
                    value: value.to_owned()
                }),
                "el color {value:?} debe rechazarse"
            );
        }
    }

    #[test]
    fn a_rotated_shape_is_wrapped_in_rotate() {
        let typst = generate_with(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                 "rotation": 15, "fill": null, "stroke": null }"##,
        );
        assert!(
            typst.contains("#rotate(15deg, origin: center + horizon)[#rect("),
            "{typst}"
        );
    }

    #[test]
    fn a_shape_without_rotation_is_not_wrapped() {
        let typst = generate_with(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                 "rotation": 0, "fill": null, "stroke": null }"##,
        );
        assert!(!typst.contains("#rotate("), "{typst}");
    }

    #[test]
    fn a_negative_rotation_survives() {
        let typst = generate_with(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                 "rotation": -7.5, "fill": null, "stroke": null }"##,
        );
        assert!(typst.contains("#rotate(-7.5deg"), "{typst}");
    }

    #[test]
    fn rect_snapshot() {
        insta::assert_snapshot!(generate_with(RECT));
    }

    #[test]
    fn ellipse_snapshot() {
        insta::assert_snapshot!(generate_with(ELLIPSE));
    }

    #[test]
    fn line_snapshot() {
        insta::assert_snapshot!(generate_with(LINE));
    }
}
