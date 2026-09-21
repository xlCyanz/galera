//! Tablas: la rejilla, con la función `table` de Typst.
//!
//! El modelo dice qué columnas hay, qué celdas y qué lleva cada una
//! ([`crate::model::table`]); aquí se traduce a la función de Typst, que es
//! la que reparte el ancho, mide el alto de cada fila y parte el texto de
//! cada celda. Nada de eso se calcula aquí (principio 3).
//!
//! ```typst
//! #table(
//!   columns: (auto, 1fr, 20mm),
//!   inset: 1.5mm,
//!   stroke: 0.2mm + rgb("#94A3B8"),
//!   table.cell(colspan: 2, fill: rgb("#F1F5F9"))[Febrero], [34],
//! )
//! ```
//!
//! # El texto de una celda es texto
//!
//! Pasa por lo mismo que el de un bloque: se sustituyen sus fichas de
//! variable y **se escapa** (principio 6). Una celda que diga `#table(` se
//! compone como esas letras, no como una tabla dentro de otra.

use std::fmt::Write as _;

use crate::model::table::{ColumnWidth, TableCell, TableRow};
use crate::model::{Document, ElementBox, Stroke, TextStyle};

use super::text::{emit_run, horizontal_alignment, points};
use super::{CodegenError, color, millimeters, number, typst_string};

/// Escribe la tabla entera.
///
/// # Errores
///
/// Los de escribir un tramo de texto: un color o un enlace que no valen.
#[expect(clippy::too_many_arguments, reason = "son los campos de la tabla")]
pub(super) fn emit_table(
    base: &ElementBox,
    columns: &[ColumnWidth],
    rows: &[TableRow],
    style: &TextStyle,
    stroke: Option<&Stroke>,
    inset: f64,
    fill: Option<&str>,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    // El bloque de fuera lleva el tamaño del elemento; la tabla, la rejilla.
    let _ = write!(out, "#block(width: {}", millimeters(base.w));
    if let Some(height) = base.h {
        let _ = write!(out, ", height: {}", millimeters(height));
    }

    let _ = write!(
        out,
        ", {{ set text(font: {}, size: {}, fill: {}); set par(leading: {}em); table(columns: (",
        typst_string(&style.font),
        points(style.size),
        color(&style.color)?,
        number(style.leading),
    );

    for width in columns {
        out.push_str(&column(*width));
        out.push_str(", ");
    }

    let _ = write!(out, "), inset: {}", millimeters(inset));
    out.push_str(", stroke: ");
    match stroke {
        Some(stroke) => {
            let _ = write!(
                out,
                "{} + {}",
                millimeters(stroke.width),
                color(&stroke.color)?
            );
        }
        // Una tabla sin borde no dibuja líneas, pero sigue siendo una tabla.
        None => out.push_str("none"),
    }
    if let Some(fill) = fill {
        let _ = write!(out, ", fill: {}", color(fill)?);
    }
    let _ = write!(out, ", align: {}", horizontal_alignment(style.align));

    for row in rows {
        out.push_str(", ");
        emit_row(row, document, out)?;
    }

    out.push_str(") })");
    Ok(())
}

/// Cuánto mide una columna, como lo escribe Typst.
fn column(width: ColumnWidth) -> String {
    match width {
        ColumnWidth::Auto => "auto".to_owned(),
        ColumnWidth::Fixed { mm } => millimeters(mm),
        ColumnWidth::Fraction { fr } => format!("{}fr", number(fr)),
    }
}

/// Escribe las celdas de una fila.
fn emit_row(row: &TableRow, document: &Document, out: &mut String) -> Result<(), CodegenError> {
    for (index, cell) in row.cells.iter().enumerate() {
        if index > 0 {
            out.push_str(", ");
        }
        emit_cell(cell, row.fill.as_deref(), document, out)?;
    }
    Ok(())
}

/// Escribe una celda: lo que la distingue y su texto.
///
/// Una celda que no cambia nada se escribe como el contenido a secas,
/// `[…]`, que es como se lee una tabla normal en Typst.
fn emit_cell(
    cell: &TableCell,
    row_fill: Option<&str>,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    let fill = cell.fill.as_deref().or(row_fill);
    let plain = cell.colspan == 1 && cell.rowspan == 1 && fill.is_none() && cell.align.is_none();

    if !plain {
        out.push_str("table.cell(");
        let mut first = true;
        let mut comma = |out: &mut String| {
            if first {
                first = false;
            } else {
                out.push_str(", ");
            }
        };

        if cell.colspan != 1 {
            comma(out);
            let _ = write!(out, "colspan: {}", cell.colspan);
        }
        if cell.rowspan != 1 {
            comma(out);
            let _ = write!(out, "rowspan: {}", cell.rowspan);
        }
        if let Some(fill) = fill {
            comma(out);
            let _ = write!(out, "fill: {}", color(fill)?);
        }
        if let Some(align) = cell.align {
            comma(out);
            let _ = write!(out, "align: {}", horizontal_alignment(align));
        }
        out.push(')');
    }

    out.push('[');
    emit_content(&cell.content, document, out)?;
    out.push(']');
    Ok(())
}

/// El texto de una celda: sus tramos, con sus fichas puestas y escapado.
fn emit_content(
    content: &[crate::model::Run],
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    for run in content {
        emit_run(&run.text, run, &document.variables, out)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::codegen::generate;
    use crate::model::Document;

    fn document(table: &str) -> Document {
        Document::from_json_str(&format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Tabla" }},
              "variables": {{ "mes": {{ "kind": "text", "value": "Enero" }} }},
              "pages": [
                {{ "id": "p1", "size": {{ "width": 210, "height": 297 }},
                   "elements": [{table}] }}
              ]
            }}"##
        ))
        .expect("es un documento")
    }

    /// Una tabla de tres columnas y dos filas, con lo básico.
    fn simple() -> Document {
        document(
            r##"{ "id": "tb1", "type": "table", "x": 20, "y": 30, "w": 170, "h": null,
                  "columns": [{ "width": "auto" }, { "width": "fraction", "fr": 1 },
                              { "width": "fixed", "mm": 20 }],
                  "rows": [
                    { "cells": [{ "content": [{ "text": "{{mes}}" }] },
                                { "content": [{ "text": "Ventas" }] },
                                { "content": [{ "text": "12" }] }],
                      "fill": "#F1F5F9" },
                    { "cells": [{ "content": [{ "text": "Febrero" }], "colspan": 2 },
                                { "content": [{ "text": "34" }], "align": "right" }] }
                  ],
                  "style": { "font": "Inter", "size": 10, "color": "#1F2733" },
                  "stroke": { "color": "#94A3B8", "width": 0.2 },
                  "inset": 2 }"##,
        )
    }

    /// El criterio de la tarea: anchos fijos, automáticos y proporcionales.
    #[test]
    fn the_columns_say_what_they_measure() {
        let code = generate(&simple()).expect("se genera");
        assert!(
            code.contains("table(columns: (auto, 1fr, 20mm, )"),
            "{code}"
        );
    }

    /// El criterio de la tarea: bordes, relleno y fondo.
    #[test]
    fn the_border_the_inset_and_the_background_are_the_ones_of_the_model() {
        let code = generate(&simple()).expect("se genera");
        assert!(code.contains("inset: 2mm"), "{code}");
        assert!(
            code.contains(r##"stroke: 0.2mm + rgb("#94A3B8")"##),
            "{code}"
        );
        // El fondo de la fila llega a cada una de sus celdas.
        assert!(
            code.contains(r##"table.cell(fill: rgb("#F1F5F9"))[Enero]"##),
            "{code}"
        );
    }

    /// El criterio de la tarea: celdas combinadas.
    #[test]
    fn a_cell_can_take_several_columns() {
        let code = generate(&simple()).expect("se genera");
        assert!(code.contains("table.cell(colspan: 2)[Febrero]"), "{code}");
        assert!(code.contains("table.cell(align: right)[34]"), "{code}");
    }

    /// Una celda que no cambia nada se escribe a secas.
    #[test]
    fn a_plain_cell_is_just_its_content() {
        let code = generate(&document(
            r##"{ "id": "tb1", "type": "table", "x": 0, "y": 0, "w": 100, "h": null,
                  "columns": [{ "width": "auto" }],
                  "rows": [{ "cells": [{ "content": [{ "text": "Sola" }] }] }],
                  "style": { "font": "Inter", "size": 10, "color": "#000000" } }"##,
        ))
        .expect("se genera");

        assert!(code.contains(", [Sola])"), "{code}");
        // Sin borde declarado, la tabla no dibuja líneas.
        assert!(code.contains("stroke: none"), "{code}");
    }

    /// El criterio de la tarea: el contenido pasa por el escape.
    #[test]
    fn what_a_cell_says_is_text_and_not_markup() {
        let code = generate(&document(
            r##"{ "id": "tb1", "type": "table", "x": 0, "y": 0, "w": 100, "h": null,
                  "columns": [{ "width": "auto" }],
                  "rows": [{ "cells": [{ "content": [{ "text": "#table(columns: 9) *ojo*" }] }] }],
                  "style": { "font": "Inter", "size": 10, "color": "#000000" } }"##,
        ))
        .expect("se genera");

        assert!(code.contains(r"\#table"), "{code}");
        assert!(code.contains(r"\*ojo\*"), "{code}");
        // Y la tabla de verdad sigue siendo la de una columna.
        assert!(code.contains("table(columns: (auto, )"), "{code}");
    }

    /// Las fichas de variable se ponen antes de escapar, como en un texto.
    #[test]
    fn a_chip_in_a_cell_is_replaced_by_its_value() {
        let code = generate(&simple()).expect("se genera");
        assert!(code.contains("[Enero]"), "{code}");
        assert!(!code.contains("{{mes}}"), "{code}");
    }

    /// Y el formato de un tramo, también.
    #[test]
    fn a_run_keeps_its_format() {
        let code = generate(&document(
            r##"{ "id": "tb1", "type": "table", "x": 0, "y": 0, "w": 100, "h": null,
                  "columns": [{ "width": "auto" }],
                  "rows": [{ "cells": [{ "content": [{ "text": "Total", "bold": true }] }] }],
                  "style": { "font": "Inter", "size": 10, "color": "#000000" } }"##,
        ))
        .expect("se genera");

        assert!(code.contains("[#strong[Total]]"), "{code}");
    }
}
