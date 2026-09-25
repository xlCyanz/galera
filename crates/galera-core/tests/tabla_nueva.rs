//! La tabla que crea la herramienta «Tabla» de la interfaz compone.
//!
//! La interfaz la construye sola (`app/src/canvas/createGeometry.ts`): tres
//! filas y tres columnas iguales, con las celdas vacías, un borde fino y el
//! estilo de texto del documento. Aquí se comprueba que ese elemento, tal
//! cual, pasa la validación, compila sin avisos y deja sus nueve celdas en el
//! layout, que es lo que hace falta para escribir en ellas.

use std::path::Path;

use galera_core::{Document, Project, compile};

#[test]
fn the_table_the_tool_creates_compiles_with_its_nine_cells() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    let project = Project::open(&fixtures).expect("fixtures/ es un proyecto");
    let empty = r#"{ "content": [], "colspan": 1, "rowspan": 1 }"#;
    let row = format!(r#"{{ "cells": [{empty}, {empty}, {empty}] }}"#);
    let document = Document::from_json_str(&format!(
        r##"{{
          "version": 1,
          "meta": {{ "title": "Tabla nueva" }},
          "fonts": ["fonts/Inter-Regular.ttf"],
          "pages": [{{
            "id": "p1",
            "size": {{ "width": 210, "height": 297, "unit": "mm" }},
            "elements": [{{
              "type": "table", "id": "table-1", "x": 20, "y": 30, "w": 120, "h": null, "rotation": 0,
              "columns": [
                {{ "width": "fraction", "fr": 1 }},
                {{ "width": "fraction", "fr": 1 }},
                {{ "width": "fraction", "fr": 1 }}
              ],
              "rows": [{row}, {row}, {row}],
              "style": {{ "font": "Inter", "size": 12, "color": "#000000", "align": "left", "leading": 0.65 }},
              "stroke": {{ "color": "#94a3b8", "width": 0.2 }},
              "inset": 2
            }}]
          }}]
        }}"##
    ))
    .expect("es un documento válido");

    let compiled = compile(&document, &project).expect("compila");
    assert_eq!(compiled.warnings(), []);
    let cells = compiled.cells(&document);
    assert_eq!(cells.len(), 9, "una caja por celda, aunque estén vacías");
    // Las tres columnas se reparten el ancho por igual.
    let widths: Vec<f64> = cells.iter().take(3).map(|cell| cell.w).collect();
    assert!(
        widths.iter().all(|w| (w - 40.0).abs() < 0.5),
        "cada columna, un tercio de 120 mm: {widths:?}"
    );
}
