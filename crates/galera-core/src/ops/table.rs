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
use crate::model::table::{ColumnWidth, TableCell, TableRow, cell_at, grid, occupancy};
use crate::model::text::{self, Format};
use crate::model::{Element, Run};

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
/// Combina las celdas de un rectángulo de la rejilla en una sola: la de
/// arriba a la izquierda, que pasa a ocupar el rectángulo entero.
///
/// El texto de las demás no se pierde: se añade al de la primera, separado
/// por un espacio, en el orden en que se leen (fila a fila). Solo se puede
/// si ninguna celda queda partida por el borde del rectángulo: combinar
/// media celda combinada no tiene sentido.
pub(super) fn merge_cells(
    element: &mut Element,
    id: &str,
    row: usize,
    column: usize,
    rows_taken: usize,
    columns_taken: usize,
) -> Result<(), OpError> {
    let (columns, rows) = table_of(element, id, "Combinar celdas")?;
    let cannot = |why: &str| OpError::CannotMerge {
        id: id.to_owned(),
        why: why.to_owned(),
    };
    if rows_taken == 0 || columns_taken == 0 || rows_taken * columns_taken < 2 {
        return Err(cannot("hacen falta al menos dos celdas"));
    }
    if row + rows_taken > rows.len() || column + columns_taken > columns.len() {
        return Err(missing(
            id,
            format!("{rows_taken} × {columns_taken} celdas desde la fila {row}, columna {column}"),
        ));
    }

    let map = occupancy(columns.len(), rows);
    let places = grid(columns.len(), rows);
    let inside = |r: usize, c: usize| {
        (row..row + rows_taken).contains(&r) && (column..column + columns_taken).contains(&c)
    };
    // Cada celda que asoma al rectángulo tiene que caber entera dentro.
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for line in map.iter().skip(row).take(rows_taken) {
        for owner in line.iter().skip(column).take(columns_taken) {
            let Some((owner_row, owner_index)) = *owner else {
                return Err(cannot("hay huecos sin celda"));
            };
            let start = places[owner_row][owner_index];
            let cell = &rows[owner_row].cells[owner_index];
            let last_row = owner_row + cell.rowspan.max(1) - 1;
            let last_column = start + cell.colspan.max(1) - 1;
            if !inside(owner_row, start) || !inside(last_row, last_column) {
                return Err(cannot("el borde parte una celda combinada"));
            }
            if !merged.contains(&(owner_row, owner_index)) {
                merged.push((owner_row, owner_index));
            }
        }
    }
    // Una combinada sola ya es una: no hay nada que juntar.
    if merged.len() < 2 {
        return Err(cannot("hacen falta al menos dos celdas"));
    }
    // La primera es la de arriba a la izquierda: la que empieza en la fila
    // y la columna pedidas.
    let Some(first) = cell_at(columns.len(), rows, row, column) else {
        return Err(cannot("hay huecos sin celda"));
    };
    merged.sort_unstable();

    // Juntar los textos, en orden de lectura.
    let mut content = Vec::new();
    for &(r, index) in &merged {
        let text = &rows[r].cells[index].content;
        if text.iter().all(|run| run.text.is_empty()) {
            continue;
        }
        if !content.is_empty() {
            content.push(Run::plain(" "));
        }
        content.extend(text.iter().cloned());
    }

    // Quitar las demás, de atrás adelante para no mover los índices.
    for &(r, index) in merged.iter().rev() {
        if (r, index) != (row, first) {
            rows[r].cells.remove(index);
        }
    }
    let cell = &mut rows[row].cells[first];
    cell.content = content;
    cell.rowspan = rows_taken;
    cell.colspan = columns_taken;
    Ok(())
}

/// Separa una celda combinada: vuelve a ocupar un solo sitio, con su texto,
/// y el resto de lo que ocupaba vuelve a ser celdas vacías.
pub(super) fn split_cell(
    element: &mut Element,
    id: &str,
    row: usize,
    column: usize,
) -> Result<(), OpError> {
    let (columns, rows) = table_of(element, id, "Separar una celda")?;
    let places = grid(columns.len(), rows);
    let Some(index) = cell_at(columns.len(), rows, row, column) else {
        return Err(missing(
            id,
            format!("ninguna celda en la fila {row}, columna {column}"),
        ));
    };
    let cell = &rows[row].cells[index];
    let (rowspan, colspan) = (cell.rowspan.max(1), cell.colspan.max(1));
    if rowspan == 1 && colspan == 1 {
        return Err(OpError::CannotMerge {
            id: id.to_owned(),
            why: "esa celda no está combinada".to_owned(),
        });
    }
    let fresh = || TableCell {
        content: Vec::new(),
        colspan: 1,
        rowspan: 1,
        fill: None,
        align: None,
    };

    // Dónde entra cada celda nueva: detrás de las de su fila que caen más a
    // la izquierda en la rejilla de antes.
    for (r, line) in rows.iter_mut().enumerate().skip(row).take(rowspan) {
        let before: Vec<usize> = places.get(r).cloned().unwrap_or_default();
        let wanted: Vec<usize> = (column..column + colspan)
            .filter(|c| r != row || *c != column)
            .collect();
        // De derecha a izquierda, para que los índices de antes sigan valiendo.
        for c in wanted.into_iter().rev() {
            let at = before.iter().filter(|start| **start < c).count();
            line.cells.insert(at, fresh());
        }
    }
    let cell = &mut rows[row].cells[index];
    cell.rowspan = 1;
    cell.colspan = 1;
    Ok(())
}

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

    fn merge(row: usize, column: usize, rows: usize, columns: usize) -> Op {
        Op::MergeCells {
            id: "tb1".to_owned(),
            row,
            column,
            rows,
            columns,
        }
    }

    fn spans(document: &Document, row: usize) -> Vec<(usize, usize)> {
        table(document).1[row]
            .cells
            .iter()
            .map(|cell| (cell.rowspan, cell.colspan))
            .collect()
    }

    /// El criterio de la tarea: se combinan celdas de una fila, con sus
    /// textos, y se deshace.
    #[test]
    fn two_cells_of_a_row_become_one_with_both_texts() {
        let (merged, undo) = apply(&document(), merge(2, 1, 1, 2));
        assert_eq!(texts(&merged, 2), ["Marzo", "Sur 34"]);
        assert_eq!(spans(&merged, 2), [(1, 1), (1, 2)]);
        assert_eq!(
            undo.apply(&merged).expect("se deshace").document,
            document()
        );
    }

    /// Un rectángulo de dos por dos, que ya lleva una combinada dentro.
    #[test]
    fn a_block_with_a_merged_cell_inside_becomes_one() {
        let (merged, _) = apply(&document(), merge(1, 1, 2, 2));
        assert_eq!(texts(&merged, 1), ["Febrero Sur 34"]);
        assert_eq!(spans(&merged, 1), [(2, 2)]);
        assert_eq!(texts(&merged, 2), ["Marzo"]);
    }

    /// Lo que no se puede: partir una combinada con el borde, una sola
    /// celda, o salirse de la tabla.
    #[test]
    fn merging_has_to_leave_every_cell_whole() {
        for (op, why) in [
            (merge(0, 0, 1, 2), "Enero ocupa dos filas"),
            (merge(1, 1, 2, 1), "Febrero ocupa dos columnas"),
            (merge(0, 1, 1, 1), "una sola celda"),
            (merge(1, 1, 1, 2), "Febrero sola ya está combinada"),
        ] {
            let error = op.apply(&document()).expect_err(why);
            assert!(
                matches!(error, OpError::CannotMerge { .. }),
                "{why}: {error:?}"
            );
        }
        let error = merge(2, 1, 2, 2).apply(&document()).expect_err("se sale");
        assert!(
            matches!(error, OpError::TablePartNotFound { .. }),
            "{error:?}"
        );
    }

    /// Separar devuelve cada sitio a su celda, vacía, sin tocar el texto
    /// de la que se separa.
    #[test]
    fn a_merged_cell_splits_back_into_empty_ones() {
        let split = |row, column| Op::SplitCell {
            id: "tb1".to_owned(),
            row,
            column,
        };
        // «Enero» ocupaba dos filas: debajo vuelve una celda.
        let (down, undo) = apply(&document(), split(0, 0));
        assert_eq!(texts(&down, 0), ["Enero", "Norte", "12"]);
        assert_eq!(texts(&down, 1), ["", "Febrero"]);
        assert_eq!(undo.apply(&down).expect("se deshace").document, document());

        // «Febrero» ocupaba dos columnas: a su derecha vuelve una.
        let (across, _) = apply(&document(), split(1, 1));
        assert_eq!(texts(&across, 1), ["Febrero", ""]);
        assert_eq!(spans(&across, 1), [(1, 1), (1, 1)]);

        // Combinar y separar: vuelve la forma, con los textos juntos.
        let (merged, _) = apply(&document(), merge(1, 1, 2, 2));
        let (back, _) = apply(&merged, split(1, 1));
        assert_eq!(texts(&back, 1), ["Febrero Sur 34", ""]);
        assert_eq!(texts(&back, 2), ["Marzo", "", ""]);

        let error = split(2, 0)
            .apply(&document())
            .expect_err("no está combinada");
        assert!(matches!(error, OpError::CannotMerge { .. }), "{error:?}");
    }
}
