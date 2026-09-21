//! Tablas: filas, columnas y celdas.
//!
//! Una tabla es **una rejilla de celdas con texto**, no un dibujo de líneas:
//! el ancho de cada columna, el alto de cada fila y dónde parte cada celda
//! los decide Typst al componer (principio 3). Aquí solo está lo que hay que
//! componer.
//!
//! # La rejilla
//!
//! Las columnas dicen cuántas hay y cuánto miden ([`ColumnWidth`]); las
//! filas llevan sus celdas, en orden. Una celda puede ocupar varias columnas
//! o varias filas ([`TableCell::colspan`], [`TableCell::rowspan`]), y
//! entonces **las celdas que quedan tapadas no se escriben**: la fila de
//! debajo tiene una celda menos, igual que en HTML y que en Typst.
//!
//! ```text
//! columns: [auto, 1fr, 20mm]
//! ┌────────┬───────────────┬──────┐
//! │ Enero  │ Ventas        │  12  │   fila 0: tres celdas
//! ├────────┼───────┬───────┼──────┤
//! │ Febrero        │ Norte │  34  │   fila 1: la primera ocupa dos columnas
//! └────────────────┴───────┴──────┘
//! ```
//!
//! # Qué se hereda
//!
//! El estilo del texto, el relleno de las celdas y el borde son de la tabla;
//! una celda puede cambiar su fondo y su alineación, y una fila, el fondo de
//! todas las suyas. Lo que no se dice se hereda, para que una tabla normal
//! no tenga que repetir el estilo en cada celda.

use serde::{Deserialize, Serialize};

use super::{Align, Run};

/// Cuánto mide una columna.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "width", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "model.ts"))]
pub enum ColumnWidth {
    /// Lo que pida su contenido, medido por Typst.
    Auto,
    /// Un ancho fijo, en milímetros.
    Fixed {
        /// Cuánto, en milímetros.
        mm: f64,
    },
    /// Una parte de lo que sobre, repartido entre las que lo pidan: dos
    /// columnas de `1fr` se quedan con la mitad cada una.
    Fraction {
        /// Cuántas partes.
        fr: f64,
    },
}

/// Una fila de la tabla.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "model.ts"))]
pub struct TableRow {
    /// Sus celdas, de izquierda a derecha. Las que tape una celda combinada
    /// de más arriba o de más a la izquierda no se escriben.
    #[serde(default)]
    pub cells: Vec<TableCell>,
    /// Color de fondo de la fila, `#RRGGBB` o `#RRGGBBAA`. Sin él, el de la
    /// tabla.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub fill: Option<String>,
}

/// Una celda.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "model.ts"))]
pub struct TableCell {
    /// Su texto, partido en tramos con el mismo formato, como el de un
    /// bloque de texto.
    #[serde(default)]
    pub content: Vec<Run>,
    /// Cuántas columnas ocupa, contando la suya.
    #[serde(default = "one")]
    pub colspan: usize,
    /// Cuántas filas ocupa, contando la suya.
    #[serde(default = "one")]
    pub rowspan: usize,
    /// Color de fondo, `#RRGGBB` o `#RRGGBBAA`. Sin él, el de su fila.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub fill: Option<String>,
    /// Alineación del texto dentro de la celda. Sin ella, la de la tabla.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub align: Option<Align>,
}

/// Una celda ocupa una columna y una fila si no se dice otra cosa.
fn one() -> usize {
    1
}

impl TableCell {
    /// Una celda con ese texto, sin combinar ni cambiar nada más.
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            content: vec![Run::plain(text)],
            colspan: 1,
            rowspan: 1,
            fill: None,
            align: None,
        }
    }

    /// Su texto, con los tramos uno detrás de otro.
    pub fn text(&self) -> String {
        self.content.iter().map(|run| run.text.as_str()).collect()
    }
}

/// Qué le pasa a la rejilla de una tabla, si le pasa algo.
///
/// Se mira aquí y no al componer porque una tabla que no cuadra no es un
/// documento a medias: es un documento que no vale (ver
/// [`crate::Document::validate`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GridProblem {
    /// Una fila tiene más celdas de las que caben en las columnas.
    RowTooWide {
        /// Qué fila, contando desde 0.
        row: usize,
        /// Cuántas columnas ocuparían sus celdas.
        needed: usize,
        /// Cuántas hay.
        columns: usize,
    },
    /// Una celda dice ocupar menos de una columna o menos de una fila.
    EmptySpan {
        /// Qué fila, contando desde 0.
        row: usize,
        /// Qué celda de esa fila, contando desde 0.
        cell: usize,
    },
}

/// Comprueba que las celdas caben en la rejilla.
///
/// Se cuenta como Typst: una celda combinada tapa las que quedan debajo y a
/// su derecha, y esas no se escriben. Así, una fila «se pasa» solo si lo que
/// escribe, más lo que le llega tapado de arriba, no cabe en las columnas.
pub fn check_grid(columns: usize, rows: &[TableRow]) -> Vec<GridProblem> {
    let mut problems = Vec::new();
    // Cuántas filas más tapa cada columna, de las celdas de más arriba.
    let mut covered = vec![0usize; columns];

    for (number, row) in rows.iter().enumerate() {
        let mut at = 0;
        let mut needed = 0;

        for (index, cell) in row.cells.iter().enumerate() {
            if cell.colspan == 0 || cell.rowspan == 0 {
                problems.push(GridProblem::EmptySpan {
                    row: number,
                    cell: index,
                });
                continue;
            }

            // Se salta lo que ya tapa una celda de más arriba.
            while at < columns && covered[at] > 0 {
                at += 1;
            }
            needed = at + cell.colspan;
            let last = (at + cell.colspan).min(columns);
            for column in &mut covered[at.min(columns)..last] {
                *column = cell.rowspan;
            }
            at += cell.colspan;
        }

        if needed > columns {
            problems.push(GridProblem::RowTooWide {
                row: number,
                needed,
                columns,
            });
        }

        for column in &mut covered {
            *column = column.saturating_sub(1);
        }
    }

    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(cells: &[TableCell]) -> TableRow {
        TableRow {
            cells: cells.to_vec(),
            fill: None,
        }
    }

    #[test]
    fn a_table_that_fits_has_nothing_to_say() {
        let rows = vec![
            row(&[
                TableCell::plain("Enero"),
                TableCell::plain("Ventas"),
                TableCell::plain("12"),
            ]),
            row(&[
                TableCell::plain("Febrero"),
                TableCell::plain("Norte"),
                TableCell::plain("34"),
            ]),
        ];
        assert!(check_grid(3, &rows).is_empty());
    }

    /// El criterio de la tarea: celdas combinadas. Una que ocupa dos
    /// columnas deja una celda menos en su fila.
    #[test]
    fn a_cell_that_spans_columns_takes_the_place_of_the_next() {
        let wide = TableCell {
            colspan: 2,
            ..TableCell::plain("Febrero")
        };
        let rows = vec![row(&[wide, TableCell::plain("34")])];
        assert!(check_grid(3, &rows).is_empty());
    }

    /// Y una que ocupa dos filas deja una celda menos en la de debajo.
    #[test]
    fn a_cell_that_spans_rows_covers_the_one_below() {
        let tall = TableCell {
            rowspan: 2,
            ..TableCell::plain("Trimestre")
        };
        let rows = vec![
            row(&[tall, TableCell::plain("Enero"), TableCell::plain("12")]),
            row(&[TableCell::plain("Febrero"), TableCell::plain("34")]),
        ];
        assert!(
            check_grid(3, &rows).is_empty(),
            "{:?}",
            check_grid(3, &rows)
        );
    }

    #[test]
    fn a_row_that_does_not_fit_says_so() {
        let rows = vec![row(&[
            TableCell::plain("a"),
            TableCell::plain("b"),
            TableCell::plain("c"),
        ])];
        assert_eq!(
            check_grid(2, &rows),
            vec![GridProblem::RowTooWide {
                row: 0,
                needed: 3,
                columns: 2
            }]
        );
    }

    #[test]
    fn a_cell_that_occupies_nothing_says_so() {
        let empty = TableCell {
            colspan: 0,
            ..TableCell::plain("x")
        };
        assert_eq!(
            check_grid(2, &[row(&[empty])]),
            vec![GridProblem::EmptySpan { row: 0, cell: 0 }]
        );
    }
}
