//! Los comandos que cambian una tabla: su rejilla y el texto de sus celdas.
//!
//! Escribir en una celda es escribir en un texto: el reparto en tramos lo
//! hace [`crate::model::text`], igual que en un bloque o en un flujo. Lo que
//! añade este módulo es **encontrar la celda** —por su fila y su columna de
//! la rejilla, contando las que tapan las combinadas ([`grid`])— y mantener
//! la rejilla en pie al meter y quitar filas y columnas.
//!
//! # Quitar no es romper
//!
//! Una celda combinada que ocupa lo que se quita no desaparece: **se
//! encoge**. Al quitar una columna que cruza, pierde una de las suyas; al
//! quitar una fila que cruza, pierde una de las que ocupaba. Así la tabla
//! sigue cuadrando después del cambio, que es lo que comprueba
//! [`check_grid`](crate::model::table::check_grid).
//!
//! Deshacer es [`Op::Restore`](super::Op::Restore), como en cualquier otro
//! cambio de un elemento: guarda la tabla que había.

use super::OpError;
use crate::model::Element;
use crate::model::table::{ColumnWidth, TableCell, TableRow, cell_at, grid, occupancy};
use crate::model::text::{self, Format};

/// Mete una fila en `index`, o al final si no se dice.
pub(super) fn insert_row(
    element: &mut Element,
    id: &str,
    index: Option<usize>,
    row: &TableRow,
) -> Result<(), OpError> {
    let (_, rows) = table_of(element, id, "Añadir una fila")?;
    let at = index.unwrap_or(rows.len()).min(rows.len());
    rows.insert(at, row.clone());
    Ok(())
}

/// Quita una fila. Lo que la cruzaba desde más arriba se encoge.
pub(super) fn remove_row(element: &mut Element, id: &str, index: usize) -> Result<(), OpError> {
    let (_, rows) = table_of(element, id, "Quitar una fila")?;
    if index >= rows.len() {
        return Err(missing(id, format!("la fila {index}")));
    }

    // Antes de quitarla: las de más arriba que llegaban hasta aquí ocupan
    // una fila menos.
    for (number, row) in rows.iter_mut().enumerate().take(index) {
        for cell in &mut row.cells {
            if number + cell.rowspan > index {
                cell.rowspan -= 1;
            }
        }
    }

    rows.remove(index);
    Ok(())
}

/// Mete una columna en `index`, o al final si no se dice, con una celda
/// vacía en cada fila.
///
/// Una celda que cruza por donde entra la columna no se parte: se estira.
pub(super) fn insert_column(
    element: &mut Element,
    id: &str,
    index: Option<usize>,
    width: ColumnWidth,
) -> Result<(), OpError> {
    let (columns, rows) = table_of(element, id, "Añadir una columna")?;
    let at = index.unwrap_or(columns.len()).min(columns.len());
    let places = grid(columns.len(), rows);
    let busy = occupancy(columns.len(), rows);

    for (number, row) in rows.iter_mut().enumerate() {
        // Solo se estira lo que **cruza** por donde entra la columna: una
        // celda que ocupa la de antes y la de después. Lo demás se corre a
        // la derecha, y la fila gana una celda vacía.
        let crossing = (at > 0)
            .then(|| {
                let places = busy.get(number)?;
                let before = (*places.get(at - 1)?)?;
                let after = (*places.get(at)?)?;
                (before == after).then_some(before)
            })
            .flatten();

        match crossing {
            // La estira su propia fila, que es donde está escrita.
            Some((owner, _)) if owner != number => {}
            Some((_, cell)) => row.cells[cell].colspan += 1,
            None => {
                let cell = places
                    .get(number)
                    .and_then(|places| places.iter().position(|column| *column >= at))
                    .unwrap_or(row.cells.len());
                row.cells.insert(cell, TableCell::plain(""));
            }
        }
    }

    columns.insert(at, width);
    Ok(())
}

/// Quita una columna y lo que hay en ella. Lo que la cruzaba se encoge.
pub(super) fn remove_column(element: &mut Element, id: &str, index: usize) -> Result<(), OpError> {
    let (columns, rows) = table_of(element, id, "Quitar una columna")?;
    if index >= columns.len() {
        return Err(missing(id, format!("la columna {index}")));
    }

    let busy = occupancy(columns.len(), rows);
    for (number, row) in rows.iter_mut().enumerate() {
        let Some((owner, cell)) = busy
            .get(number)
            .and_then(|places| places.get(index))
            .copied()
            .flatten()
        else {
            continue;
        };
        // Cada celda se encoge una vez, en su propia fila.
        if owner != number {
            continue;
        }

        if row.cells[cell].colspan > 1 {
            row.cells[cell].colspan -= 1;
        } else {
            row.cells.remove(cell);
        }
    }

    columns.remove(index);
    Ok(())
}

/// Cambia lo que mide una columna.
pub(super) fn set_column_width(
    element: &mut Element,
    id: &str,
    column: usize,
    width: ColumnWidth,
) -> Result<(), OpError> {
    let (columns, _) = table_of(element, id, "Cambiar el ancho de una columna")?;
    let Some(current) = columns.get_mut(column) else {
        return Err(missing(id, format!("la columna {column}")));
    };
    *current = width;
    Ok(())
}

/// Mete texto en la posición `at` del texto de una celda.
pub(super) fn insert_text(
    element: &mut Element,
    id: &str,
    row: usize,
    column: usize,
    at: usize,
    insertion: &str,
) -> Result<(), OpError> {
    let cell = cell_of(element, id, row, column, "Escribir")?;
    text::insert(&mut cell.content, at, insertion)?;
    Ok(())
}

/// Borra el tramo `[from, to)` del texto de una celda.
pub(super) fn delete_text(
    element: &mut Element,
    id: &str,
    row: usize,
    column: usize,
    from: usize,
    to: usize,
) -> Result<(), OpError> {
    let cell = cell_of(element, id, row, column, "Borrar texto")?;
    text::remove(&mut cell.content, from, to)?;
    Ok(())
}

/// Cambia el formato del tramo `[from, to)` del texto de una celda.
pub(super) fn format_text(
    element: &mut Element,
    id: &str,
    row: usize,
    column: usize,
    from: usize,
    to: usize,
    format: &Format,
) -> Result<(), OpError> {
    let cell = cell_of(element, id, row, column, "Dar formato")?;
    text::format(&mut cell.content, from, to, format)?;
    Ok(())
}

/// Las columnas y las filas del elemento, si es una tabla.
fn table_of<'a>(
    element: &'a mut Element,
    id: &str,
    what: &str,
) -> Result<(&'a mut Vec<ColumnWidth>, &'a mut Vec<TableRow>), OpError> {
    let kind = element.type_name();
    match element {
        Element::Table { columns, rows, .. } => Ok((columns, rows)),
        _ => Err(OpError::NotApplicable {
            id: id.to_owned(),
            kind,
            what: what.to_owned(),
        }),
    }
}

/// La celda que ocupa esa columna de esa fila.
fn cell_of<'a>(
    element: &'a mut Element,
    id: &str,
    row: usize,
    column: usize,
    what: &str,
) -> Result<&'a mut TableCell, OpError> {
    let (columns, rows) = table_of(element, id, what)?;
    let Some(index) = cell_at(columns.len(), rows, row, column) else {
        return Err(missing(
            id,
            format!("ninguna celda en la fila {row}, columna {column}"),
        ));
    };
    rows.get_mut(row)
        .and_then(|row| row.cells.get_mut(index))
        .ok_or_else(|| missing(id, format!("la fila {row}")))
}

fn missing(id: &str, what: String) -> OpError {
    OpError::TablePartNotFound {
        id: id.to_owned(),
        what,
    }
}

#[cfg(test)]
mod tests {
    use crate::model::table::{ColumnWidth, TableCell, TableRow, check_grid};
    use crate::model::{Document, Element};
    use crate::ops::{Op, OpError};

    /// Una tabla de tres columnas y tres filas, con una celda que ocupa dos
    /// columnas y otra que ocupa dos filas.
    ///
    /// ```text
    /// ┌───────┬───────┬───────┐
    /// │ Enero │ Norte │  12   │
    /// ├───────┼───────┴───────┤
    /// │       │ Febrero       │   «Enero» ocupa dos filas
    /// ├───────┼───────┬───────┤
    /// │ Marzo │ Sur   │  34   │
    /// └───────┴───────┴───────┘
    /// ```
    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Tabla" },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "tb1", "type": "table", "x": 10, "y": 10, "w": 100, "h": null,
                      "columns": [{ "width": "auto" }, { "width": "auto" }, { "width": "auto" }],
                      "rows": [
                        { "cells": [{ "content": [{ "text": "Enero" }], "rowspan": 2 },
                                    { "content": [{ "text": "Norte" }] },
                                    { "content": [{ "text": "12" }] }] },
                        { "cells": [{ "content": [{ "text": "Febrero" }], "colspan": 2 }] },
                        { "cells": [{ "content": [{ "text": "Marzo" }] },
                                    { "content": [{ "text": "Sur" }] },
                                    { "content": [{ "text": "34" }] }] }
                      ],
                      "style": { "font": "Inter", "size": 10, "color": "#000000" } }
                  ] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    fn table(document: &Document) -> (&[ColumnWidth], &[TableRow]) {
        match document.element("tb1").expect("está") {
            Element::Table { columns, rows, .. } => (columns, rows),
            other => panic!("no es una tabla: {other:?}"),
        }
    }

    /// Aplica un comando y comprueba que la rejilla sigue cuadrando.
    fn apply(document: &Document, op: Op) -> (Document, Op) {
        let applied = op.apply(document).expect("se aplica");
        let (columns, rows) = table(&applied.document);
        assert!(
            check_grid(columns.len(), rows).is_empty(),
            "la rejilla no cuadra: {:?}",
            check_grid(columns.len(), rows)
        );
        (applied.document, applied.undo)
    }

    fn texts(document: &Document, row: usize) -> Vec<String> {
        table(document).1[row]
            .cells
            .iter()
            .map(TableCell::text)
            .collect()
    }

    /// El criterio de la tarea: se añaden y se quitan filas.
    #[test]
    fn a_row_goes_in_where_it_is_asked_and_comes_out_again() {
        let document = document();
        let row = TableRow {
            cells: vec![
                TableCell::plain("a"),
                TableCell::plain("b"),
                TableCell::plain("c"),
            ],
            fill: None,
        };

        let (with, undo) = apply(
            &document,
            Op::InsertTableRow {
                id: "tb1".to_owned(),
                index: Some(0),
                row,
            },
        );
        assert_eq!(table(&with).1.len(), 4);
        assert_eq!(texts(&with, 0), ["a", "b", "c"]);

        // Y deshacer la deja como estaba.
        let back = undo.apply(&with).expect("se deshace").document;
        assert_eq!(back, document);
    }

    /// Quitar una fila encoge lo que la cruzaba desde más arriba: si no, la
    /// tabla se quedaría diciendo que ocupa filas que ya no están.
    #[test]
    fn removing_a_row_shrinks_what_crossed_it() {
        let document = document();
        let (without, undo) = apply(
            &document,
            Op::RemoveTableRow {
                id: "tb1".to_owned(),
                index: 1,
            },
        );

        let (_, rows) = table(&without);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].cells[0].rowspan, 1, "«Enero» ya no cruza nada");
        assert_eq!(texts(&without, 1), ["Marzo", "Sur", "34"]);

        assert_eq!(undo.apply(&without).expect("se deshace").document, document);
    }

    /// El criterio de la tarea: se añaden y se quitan columnas.
    #[test]
    fn a_column_brings_an_empty_cell_to_every_row() {
        let document = document();
        let (with, undo) = apply(
            &document,
            Op::InsertTableColumn {
                id: "tb1".to_owned(),
                index: Some(0),
                width: ColumnWidth::Fixed { mm: 20.0 },
            },
        );

        let (columns, rows) = table(&with);
        assert_eq!(columns.len(), 4);
        assert_eq!(columns[0], ColumnWidth::Fixed { mm: 20.0 });
        assert_eq!(texts(&with, 0), ["", "Enero", "Norte", "12"]);
        // La fila de en medio la tapa «Enero», así que solo gana la nueva.
        assert_eq!(texts(&with, 1), ["", "Febrero"]);
        assert_eq!(rows[1].cells[1].colspan, 2, "«Febrero» sigue ocupando dos");

        assert_eq!(undo.apply(&with).expect("se deshace").document, document);
    }

    /// Una columna que entra por en medio de una celda combinada la estira,
    /// no la parte.
    #[test]
    fn a_column_through_a_merged_cell_stretches_it() {
        let document = document();
        let (with, _) = apply(
            &document,
            Op::InsertTableColumn {
                id: "tb1".to_owned(),
                index: Some(2),
                width: ColumnWidth::Auto,
            },
        );

        let (_, rows) = table(&with);
        assert_eq!(rows[1].cells[0].colspan, 3, "«Febrero» ocupa una más");
        assert_eq!(texts(&with, 1), ["Febrero"], "y no hay celda nueva");
        assert_eq!(texts(&with, 0), ["Enero", "Norte", "", "12"]);
    }

    #[test]
    fn removing_a_column_takes_its_cells_and_shrinks_the_rest() {
        let document = document();
        let (without, undo) = apply(
            &document,
            Op::RemoveTableColumn {
                id: "tb1".to_owned(),
                index: 1,
            },
        );

        let (columns, rows) = table(&without);
        assert_eq!(columns.len(), 2);
        assert_eq!(texts(&without, 0), ["Enero", "12"]);
        assert_eq!(rows[1].cells[0].colspan, 1, "«Febrero» ocupa una menos");
        assert_eq!(texts(&without, 1), ["Febrero"]);

        assert_eq!(undo.apply(&without).expect("se deshace").document, document);
    }

    /// El criterio de la tarea: se cambia el ancho de una columna.
    #[test]
    fn a_column_measures_what_it_is_told() {
        let document = document();
        let (wider, undo) = apply(
            &document,
            Op::SetColumnWidth {
                id: "tb1".to_owned(),
                column: 2,
                width: ColumnWidth::Fraction { fr: 2.0 },
            },
        );

        assert_eq!(table(&wider).0[2], ColumnWidth::Fraction { fr: 2.0 });
        assert_eq!(undo.apply(&wider).expect("se deshace").document, document);
    }

    /// El criterio de la tarea: se escribe dentro de una celda, y se
    /// deshace.
    #[test]
    fn writing_in_a_cell_changes_that_cell_and_nothing_else() {
        let document = document();
        let (written, undo) = apply(
            &document,
            Op::InsertCellText {
                id: "tb1".to_owned(),
                row: 0,
                column: 1,
                at: 5,
                text: " frío".to_owned(),
            },
        );

        assert_eq!(texts(&written, 0), ["Enero", "Norte frío", "12"]);
        assert_eq!(undo.apply(&written).expect("se deshace").document, document);
    }

    #[test]
    fn a_cell_loses_the_text_that_is_deleted_and_keeps_the_format_given() {
        let document = document();
        let (shorter, _) = apply(
            &document,
            Op::DeleteCellText {
                id: "tb1".to_owned(),
                row: 2,
                column: 0,
                from: 0,
                to: 2,
            },
        );
        assert_eq!(texts(&shorter, 2)[0], "rzo");

        let (bold, undo) = apply(
            &document,
            Op::FormatCellText {
                id: "tb1".to_owned(),
                row: 2,
                column: 0,
                from: 0,
                to: 5,
                format: crate::model::text::Format {
                    bold: Some(true),
                    ..Default::default()
                },
            },
        );
        let (_, rows) = table(&bold);
        assert!(rows[2].cells[0].content.iter().all(|run| run.bold));
        assert_eq!(undo.apply(&bold).expect("se deshace").document, document);
    }

    /// La celda se dice por su sitio en la rejilla: el de una celda tapada
    /// no es el de ninguna.
    #[test]
    fn a_cell_that_is_not_there_says_so() {
        let document = document();
        let error = Op::InsertCellText {
            id: "tb1".to_owned(),
            row: 1,
            column: 0,
            at: 0,
            text: "x".to_owned(),
        }
        .apply(&document)
        .expect_err("esa columna la tapa «Enero»");

        assert!(
            matches!(error, OpError::TablePartNotFound { .. }),
            "{error:?}"
        );
    }

    #[test]
    fn what_is_not_a_table_does_not_take_these_commands() {
        let document = Document::from_json_str(
            r##"{ "version": 1, "meta": { "title": "x" },
                  "pages": [{ "id": "p1", "size": { "width": 100, "height": 100 },
                    "elements": [{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10 }] }] }"##,
        )
        .expect("es un documento");

        let error = Op::RemoveTableRow {
            id: "r1".to_owned(),
            index: 0,
        }
        .apply(&document)
        .expect_err("un rectángulo no tiene filas");
        assert!(
            matches!(error, OpError::NotApplicable { kind: "rect", .. }),
            "{error:?}"
        );
    }
}
