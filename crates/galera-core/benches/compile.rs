//! Cuánto cuesta una tecla.
//!
//! Mide el camino entero que recorre la app en cada cambio del documento:
//! generar el código, compilarlo y dibujar las páginas. Dos veces: **desde
//! cero**, como se hacía antes de `compile::cache`, y **con el compilador
//! guardado**, como se hace ahora.
//!
//! ```bash
//! cargo bench -p galera-core
//! ```
//!
//! No usa ninguna biblioteca de bancos de pruebas: imprime la mediana de
//! unas cuantas repeticiones, que es lo que hace falta para decidir y para
//! anotar en `docs/decisiones/compilacion-incremental.md`. La prueba que
//! falla si se pasa del presupuesto está en `compile::cache`, con el resto
//! de las pruebas.

use std::path::Path;
use std::time::{Duration, Instant};

use galera_core::{Compiler, Document, Element, Project, compile};

/// Cuántas teclas se miden por caso.
const KEYS: usize = 9;

fn main() {
    let project = Project::open(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures"))
        .expect("fixtures/ es un proyecto");

    println!("teclas medidas: {KEYS} · mediana");
    println!(
        "{:>8}  {:>12}  {:>12}  {:>8}",
        "páginas", "desde cero", "con caché", "mejora"
    );

    for pages in [1, 5, 10] {
        let document = document(pages);

        let fresh = median(measure(KEYS, document.clone(), |document| {
            let compiled = compile(document, &project).expect("compila");
            for page in 0..compiled.page_count() {
                compiled.to_svg(page).expect("svg");
            }
        }));

        let mut compiler = Compiler::new(project.clone());
        let warm = compiler.compile(&document).expect("compila");
        compiler.page_svgs(&warm);
        let cached = median(measure(KEYS, document.clone(), |document| {
            let compiled = compiler.compile(document).expect("compila");
            compiler.page_svgs(&compiled);
        }));

        println!(
            "{pages:>8}  {:>12}  {:>12}  {:>7.0}%",
            millis(fresh),
            millis(cached),
            100.0 - cached.as_secs_f64() / fresh.as_secs_f64() * 100.0
        );
    }
}

/// Escribe `keys` letras al final de la última página, midiendo cada una.
fn measure(
    keys: usize,
    mut document: Document,
    mut compile: impl FnMut(&Document),
) -> Vec<Duration> {
    ('a'..)
        .take(keys)
        .map(|letter| {
            if let Some(page) = document.pages.last_mut()
                && let Some(Element::Text { content, .. }) = page.elements.first_mut()
            {
                content[0].text.push(letter);
            }
            let started = Instant::now();
            compile(&document);
            started.elapsed()
        })
        .collect()
}

/// Un documento de `pages` páginas con un párrafo largo en cada una.
fn document(pages: usize) -> Document {
    let paragraph = "Cooperativa agrícola del este ".repeat(120);
    let page = |number: usize| {
        format!(
            r##"{{ "id": "p{number}", "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                   "elements": [
                     {{ "id": "t{number}", "type": "text", "x": 20, "y": 20, "w": 170, "h": null,
                        "content": [{{ "text": "{paragraph}" }}],
                        "style": {{ "font": "Inter", "size": 11, "color": "#1F2733",
                                   "align": "justify", "leading": 0.65 }} }}
                   ] }}"##
        )
    };
    let pages: Vec<String> = (1..=pages).map(page).collect();
    Document::from_json_str(&format!(
        r##"{{
          "version": 1,
          "meta": {{ "title": "Banco de pruebas" }},
          "fonts": ["fonts/Inter-Regular.ttf"],
          "pages": [{}]
        }}"##,
        pages.join(",")
    ))
    .expect("es un documento")
}

fn median(mut times: Vec<Duration>) -> Duration {
    times.sort_unstable();
    times[times.len() / 2]
}

fn millis(time: Duration) -> String {
    format!("{:.1} ms", time.as_secs_f64() * 1000.0)
}
