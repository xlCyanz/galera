//! Dónde quedó cada celda de una tabla, según Typst.
//!
//! Para escribir dentro de una celda hay que saber dónde está: qué celda
//! cae bajo el ratón, hasta dónde llega su caja y por dónde pasa el borde de
//! una columna. Nada de eso se puede calcular en la interfaz —el ancho de
//! una columna `auto` y el alto de una fila los decide Typst al componer,
//! principio 3—, así que se lee de la composición, como las cajas de los
//! elementos ([`super`]) y los glifos de un texto ([`super::glyphs`]).
//!
//! # Cómo se encuentra una celda
//!
//! Typst no deja en el marco ni dónde empieza ni cuánto mide una celda: solo
//! dibuja lo que lleva dentro. Por eso el codegen mete en cada celda una
//! marca —`galera-cell(fila, columna)`, ver [`crate::codegen`]—: un bloque
//! **fuera de flujo**, del ancho de la celda, con un `metadata` dentro que
//! dice de qué celda es. Como `place` no ocupa sitio, la marca no cambia lo
//! que mide la tabla.
//!
//! ```text
//! Group  (77,4, 49,7)  87,6 × 6,6 mm      ← la celda
//!   Tag start "cell"
//!   Tag start "place"
//!   Group  (79,4, 51,7)  83,6 × …         ← la marca: la celda menos el margen
//!     Tag start "metadata"  (fila 3, columna 2)
//!   Tag start "par"
//!   Text  "Luis #Prado"
//! ```
//!
//! De la marca salen la izquierda, el ancho y la parte de arriba de la
//! celda, quitándole el margen (`inset`) que el codegen le puso a la tabla.
//! El alto, no: dentro de la celda la marca mide lo que queda de página,
//! porque el alto de la fila todavía no está decidido. El alto sale de las
//! **rayas** que separan las filas, que son las partes de arriba de las
//! celdas de cada fila, y de donde acaba la tabla: una celda va desde la
//! raya de su fila hasta la de la fila siguiente a las que ocupa.

use serde::Serialize;
use typst::foundations::Value;
use typst::introspection::{MetadataElem, Tag};
use typst::layout::{Frame, FrameItem, Point};

use super::element_id;
use crate::compile::Compiled;
use crate::model::table::cell_at as cell_of;
use crate::model::{Document, Element};

/// Dónde quedó una celda al componer el documento.
///
/// En milímetros, con el origen arriba a la izquierda de la página y **sin
/// girar**, igual que [`LayoutBox`](super::LayoutBox): la interfaz gira la
/// tabla entera, celdas incluidas.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "layout.ts"))]
pub struct CellBox {
    /// El id de la tabla.
    pub table: String,
    /// La página donde se dibujó, contando desde 0.
    pub page: usize,
    /// Su fila, contando desde 0.
    pub row: usize,
    /// Su columna **de la rejilla**, contando desde 0: la que cuenta las
    /// que tapan las celdas combinadas de más arriba, no la posición de la
    /// celda dentro de su fila.
    pub column: usize,
    /// Cuántas columnas ocupa, contando la suya.
    pub colspan: usize,
    /// Cuántas filas ocupa, contando la suya.
    pub rowspan: usize,
    /// Borde izquierdo, en mm desde el borde izquierdo de la página.
    pub x: f64,
    /// Borde superior, en mm desde el borde superior de la página.
    pub y: f64,
    /// Ancho, en mm.
    pub w: f64,
    /// Alto, en mm.
    pub h: f64,
}

impl Compiled {
    /// Dónde quedó cada celda de cada tabla del documento, en el orden en
    /// que se componen.
    ///
    /// `document` tiene que ser el documento con el que se compiló: de él
    /// salen el margen de cada tabla y cuántas filas ocupa cada celda.
    pub fn cells(&self, document: &Document) -> Vec<CellBox> {
        let mut found = Found::default();
        for (number, page) in self.paged().pages().iter().enumerate() {
            walk(number, &page.frame, Point::zero(), None, &mut found);
        }
        found.boxes(document)
    }
}

/// La celda que hay en un punto de una página, o `None` si ahí no hay
/// ninguna. La última gana: es la que se dibujó encima.
pub fn cell_at(cells: &[CellBox], page: usize, x: f64, y: f64) -> Option<&CellBox> {
    cells.iter().rev().find(|cell| {
        cell.page == page
            && x >= cell.x
            && x <= cell.x + cell.w
            && y >= cell.y
            && y <= cell.y + cell.h
    })
}

/// Por dónde pasan los bordes de las columnas de una tabla, de izquierda a
/// derecha: uno más que columnas, contando los dos extremos.
///
/// Sale de las celdas que no están combinadas: una que ocupa dos columnas no
/// dice dónde acaba la primera. Si alguna columna no tiene ninguna celda sin
/// combinar, ese borde no se puede saber y no sale en la lista, así que hay
/// que mirar cuántos hay antes de usarlos por su número.
pub fn column_edges(cells: &[CellBox], table: &str, columns: usize) -> Vec<Option<f64>> {
    let mut edges = vec![None; columns + 1];

    for cell in cells.iter().filter(|cell| cell.table == table) {
        if cell.colspan != 1 {
            continue;
        }
        if let Some(edge) = edges.get_mut(cell.column) {
            *edge = Some(cell.x);
        }
        if let Some(edge) = edges.get_mut(cell.column + 1) {
            *edge = Some(cell.x + cell.w);
        }
    }

    edges
}

/// Una marca de celda, tal como está en el marco: sin quitarle el margen y
/// sin alto.
#[derive(Debug)]
struct Mark {
    table: String,
    page: usize,
    row: usize,
    column: usize,
    x: f64,
    y: f64,
    w: f64,
}

/// Lo que se va encontrando al recorrer las páginas.
#[derive(Default)]
struct Found {
    marks: Vec<Mark>,
    /// Por cada tabla, dónde acaba lo que dibujó: el alto de la última fila
    /// llega hasta ahí.
    bottoms: Vec<(String, f64)>,
}

impl Found {
    /// Dónde acaba una tabla, si se vio su marco.
    fn bottom_of(&self, table: &str) -> Option<f64> {
        self.bottoms
            .iter()
            .find(|(id, _)| id == table)
            .map(|(_, bottom)| *bottom)
    }

    /// Las cajas, ya con el margen quitado y con el alto puesto.
    fn boxes(&self, document: &Document) -> Vec<CellBox> {
        let mut boxes = Vec::with_capacity(self.marks.len());
        // Las rayas son de la tabla entera: se cuentan una vez, no una por
        // celda.
        let mut ruled: Vec<(&str, Vec<Option<f64>>)> = Vec::new();

        for mark in &self.marks {
            let Some(Element::Table {
                columns,
                rows,
                inset,
                ..
            }) = document.element(&mark.table)
            else {
                continue;
            };
            let Some(index) = cell_of(columns.len(), rows, mark.row, mark.column) else {
                continue;
            };
            let Some(cell) = rows.get(mark.row).and_then(|row| row.cells.get(index)) else {
                continue;
            };

            let y = mark.y - inset;
            if !ruled.iter().any(|(id, _)| *id == mark.table) {
                ruled.push((
                    &mark.table,
                    rules(&self.marks, &mark.table, rows.len(), *inset),
                ));
            }
            let rules = ruled
                .iter()
                .find(|(id, _)| *id == mark.table)
                .map_or(&[][..], |(_, rules)| rules.as_slice());
            let bottom = self.bottom_of(&mark.table).unwrap_or(y);
            let end = rule(rules, mark.row + cell.rowspan.max(1), bottom);

            boxes.push(CellBox {
                table: mark.table.clone(),
                page: mark.page,
                row: mark.row,
                column: mark.column,
                colspan: cell.colspan,
                rowspan: cell.rowspan,
                x: mark.x - inset,
                y,
                w: mark.w + 2.0 * inset,
                h: (end - y).max(0.0),
            });
        }

        boxes
    }
}

/// Por dónde pasa la raya de arriba de cada fila: la parte de arriba de sus
/// celdas. Una fila que esté tapada entera por celdas combinadas no tiene
/// ninguna, y se queda sin raya.
fn rules(marks: &[Mark], table: &str, rows: usize, inset: f64) -> Vec<Option<f64>> {
    let mut rules = vec![None; rows];

    for mark in marks.iter().filter(|mark| mark.table == table) {
        if let Some(rule) = rules.get_mut(mark.row) {
            let top = mark.y - inset;
            *rule = Some(rule.map_or(top, |had: f64| had.min(top)));
        }
    }

    rules
}

/// La raya número `row`, o la de la fila de más abajo que se sepa: una fila
/// sin raya no corta a la de arriba. Pasado el final, donde acaba la tabla.
fn rule(rules: &[Option<f64>], row: usize, bottom: f64) -> f64 {
    rules
        .iter()
        .skip(row)
        .find_map(|rule| *rule)
        .unwrap_or(bottom)
}

/// Recorre un marco buscando las marcas de las celdas.
///
/// `at` es dónde empieza este marco en la página, y `inside` la tabla cuya
/// etiqueta está abierta: el `metadata` de una marca no está al lado de la
/// etiqueta sino varios marcos más adentro, así que la tabla baja con la
/// recursión, igual que la zona de un flujo ([`super::flows`]).
fn walk(page: usize, frame: &Frame, at: Point, inside: Option<&str>, found: &mut Found) {
    let mut table: Option<String> = inside.map(str::to_owned);
    // Detrás de la marca de una tabla viene su marco, que es lo que dice
    // dónde acaba.
    let mut awaiting = false;

    for (position, item) in frame.items() {
        let position = at + *position;
        match item {
            FrameItem::Tag(Tag::Start(content, _)) => {
                if let Some(id) = element_id(content) {
                    table = Some(id);
                } else if content.func().name() == "table" {
                    awaiting = true;
                } else if let Some(metadata) = content.to_packed::<MetadataElem>()
                    && let Some(id) = &table
                    && let Some((row, column)) = cell_of_value(&metadata.value)
                {
                    found.marks.push(Mark {
                        table: id.clone(),
                        page,
                        row,
                        column,
                        x: at.x.to_mm(),
                        y: at.y.to_mm(),
                        w: frame.size().x.to_mm(),
                    });
                }
            }
            FrameItem::Group(group) => {
                if awaiting && let Some(id) = &table {
                    awaiting = false;
                    found
                        .bottoms
                        .push((id.clone(), (position.y + group.frame.size().y).to_mm()));
                }
                walk(page, &group.frame, position, table.as_deref(), found);
            }
            _ => {}
        }
    }
}

/// La fila y la columna de un valor `(row: N, column: M)` de Typst.
fn cell_of_value(value: &Value) -> Option<(usize, usize)> {
    let Value::Dict(dict) = value else {
        return None;
    };
    let number = |key| match dict.get(key) {
        Ok(Value::Int(value)) if *value >= 0 => usize::try_from(*value).ok(),
        _ => None,
    };
    Some((number("row")?, number("column")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{fixture, project};

    /// Una milésima de milímetro, como en el resto del layout.
    const TOLERANCE: f64 = 1e-3;

    fn cells_of(name: &str) -> (Document, Vec<CellBox>) {
        let document = fixture(name);
        let compiled = crate::compile(&document, &project()).expect("compila");
        let cells = compiled.cells(&document);
        (document, cells)
    }

    fn cell<'a>(cells: &'a [CellBox], table: &str, row: usize, column: usize) -> &'a CellBox {
        cells
            .iter()
            .find(|cell| cell.table == table && cell.row == row && cell.column == column)
            .unwrap_or_else(|| panic!("la celda ({row}, {column}) de {table} está: {cells:#?}"))
    }

    fn close(actual: f64, expected: f64, what: &str) {
        assert!(
            (actual - expected).abs() < TOLERANCE,
            "{what}: {actual} en vez de {expected}"
        );
    }

    /// El criterio de la tarea: para entrar en una celda hay que saber dónde
    /// está, y eso lo dice la composición.
    #[test]
    fn every_cell_of_the_table_has_its_box() {
        let (_, cells) = cells_of("tabla");

        // Las catorce de la primera tabla y las dos de la segunda.
        assert_eq!(cells.iter().filter(|cell| cell.table == "tb1").count(), 14);
        assert_eq!(cells.iter().filter(|cell| cell.table == "tb2").count(), 2);
        assert!(
            cells.iter().all(|cell| cell.w > 0.0 && cell.h > 0.0),
            "{cells:#?}"
        );
    }

    /// Las celdas de una fila van una detrás de otra y llenan la tabla: es
    /// lo que hace que un punto caiga siempre en una.
    #[test]
    fn the_cells_of_a_row_tile_the_table() {
        let (_, cells) = cells_of("tabla");
        let row: Vec<&CellBox> = (0..4)
            .map(|column| cell(&cells, "tb1", 1, column))
            .collect();

        close(row[0].x, 20.0, "la primera empieza donde la tabla");
        for pair in row.windows(2) {
            close(
                pair[1].x,
                pair[0].x + pair[0].w,
                "una celda empieza donde acaba la anterior",
            );
            close(
                pair[1].y,
                pair[0].y,
                "las de una fila están a la misma altura",
            );
            close(pair[1].h, pair[0].h, "y miden lo mismo de alto");
        }
        let last = row[3];
        close(last.x + last.w, 190.0, "la última acaba donde la tabla");
    }

    /// El criterio de la tarea: una celda combinada ocupa el sitio de las
    /// que tapa, a lo ancho y a lo alto.
    #[test]
    fn a_merged_cell_takes_the_place_of_the_ones_it_covers() {
        let (_, cells) = cells_of("tabla");

        // La primera fila es una sola celda de cuatro columnas.
        close(
            cell(&cells, "tb1", 0, 0).w,
            170.0,
            "ocupa las cuatro columnas",
        );

        // «Enero» ocupa dos filas: lo que miden las dos.
        let tall = cell(&cells, "tb1", 2, 0);
        let first = cell(&cells, "tb1", 2, 1);
        let second = cell(&cells, "tb1", 3, 1);
        close(tall.h, first.h + second.h, "ocupa las dos filas");
        close(tall.y, first.y, "empieza en la primera");
    }

    /// Una tabla sin borde y sin margen también deja sus marcas.
    #[test]
    fn a_table_without_a_border_still_says_where_its_cells_are() {
        let (_, cells) = cells_of("tabla");
        let first = cell(&cells, "tb2", 0, 0);
        let second = cell(&cells, "tb2", 0, 1);

        close(first.x, 20.0, "empieza donde la tabla");
        close(second.x, first.x + first.w, "y la otra, detrás");
        assert!(first.h > 0.0, "tiene alto: {first:?}");
    }

    #[test]
    fn a_point_falls_in_the_cell_that_is_drawn_there() {
        let (_, cells) = cells_of("tabla");
        let target = cell(&cells, "tb1", 2, 2);

        let found = cell_at(&cells, 0, target.x + 1.0, target.y + 1.0).expect("hay celda");
        assert_eq!((found.row, found.column), (2, 2));
        assert!(
            cell_at(&cells, 0, 5.0, 5.0).is_none(),
            "fuera de la tabla no hay celda"
        );
        assert!(
            cell_at(&cells, 1, target.x + 1.0, target.y + 1.0).is_none(),
            "ni en otra página"
        );
    }

    /// El criterio de la tarea: para arrastrar el borde de una columna hay
    /// que saber por dónde pasa.
    #[test]
    fn the_edges_of_the_columns_come_from_the_cells() {
        let (_, cells) = cells_of("tabla");
        let edges = column_edges(&cells, "tb1", 4);

        assert_eq!(edges.len(), 5);
        let found: Vec<f64> = edges.iter().flatten().copied().collect();
        assert_eq!(found.len(), 5, "las cuatro columnas tienen celdas sueltas");
        close(found[0], 20.0, "el borde de la izquierda");
        close(found[4], 190.0, "el de la derecha");
        for pair in found.windows(2) {
            assert!(pair[0] < pair[1], "van de izquierda a derecha: {found:?}");
        }
        // La última columna mide los 25 mm que pide el modelo.
        close(found[4] - found[3], 25.0, "la columna fija");
    }

    #[test]
    fn a_document_without_tables_has_no_cells() {
        let document = fixture("texto");
        let compiled = crate::compile(&document, &project()).expect("compila");
        assert!(compiled.cells(&document).is_empty());
    }
}
