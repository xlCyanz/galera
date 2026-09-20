//! Cuánto cuesta una tecla.
//!
//! Mide el camino entero que recorre la app cada vez que se escribe una
//! letra en un texto:
//!
//! 1. el comando de texto (`Op::InsertText`), que es lo que manda la
//!    interfaz;
//! 2. generar el código Typst y compilarlo;
//! 3. dibujar las páginas a SVG, sacar las cajas del layout y las
//!    posiciones de los glifos, que es lo que necesita el lienzo para
//!    enseñar el resultado con su cursor.
//!
//! Se mide dos veces: **desde cero**, como se hacía antes de
//! `compile::cache`, y **con el compilador guardado**, que es como funciona
//! la app.
//!
//! ```bash
//! cargo bench -p galera-core
//! ```
//!
//! No usa ninguna biblioteca de bancos de pruebas: imprime la mediana, el
//! percentil 95 y el peor caso, que es lo que hace falta para decidir y
//! para anotar en `docs/rendimiento.md`. El presupuesto de la fase —menos
//! de 50 ms entre tecla y render— lo vigila además una prueba
//! (`compile::cache`), que corre con el resto.

use std::path::Path;
use std::time::{Duration, Instant};

use galera_core::{Compiler, Document, Op, Project, compile};

/// Cuántas teclas se miden por caso. Bastantes para que el percentil 95
/// signifique algo sin que el banco tarde un minuto.
const KEYS: usize = 40;

/// El presupuesto de la fase: lo que puede tardar una tecla.
const BUDGET: Duration = Duration::from_millis(50);

fn main() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    let project = Project::open(&fixtures).expect("fixtures/ es un proyecto");
    let document = Document::from_json_str(
        &std::fs::read_to_string(fixtures.join("denso.json")).expect("fixtures/denso.json"),
    )
    .expect("es un documento");

    println!(
        "documento: fixtures/denso.json · {} páginas",
        document.pages.len()
    );
    println!("teclas medidas: {KEYS} por caso");
    println!();
    println!(
        "{:<22}  {:>9}  {:>9}  {:>9}  {:>9}",
        "caso", "mediana", "p95", "peor", "presupuesto"
    );

    let fresh = measure(&document, |document| {
        let compiled = compile(document, &project).expect("compila");
        for page in 0..compiled.page_count() {
            compiled.to_svg(page).expect("svg");
        }
        compiled.layout();
        compiled.glyphs(document, "cuerpo-5");
    });
    report("desde cero", &fresh);

    let mut compiler = Compiler::new(project.clone());
    let warm = compiler.compile(&document).expect("compila");
    compiler.page_svgs(&warm);
    let cached = measure(&document, |document| {
        let compiled = compiler.compile(document).expect("compila");
        compiler.page_svgs(&compiled);
        compiled.layout();
        compiled.glyphs(document, "cuerpo-5");
    });
    report("con caché", &cached);

    println!();
    let p95 = percentile(&cached, 95);
    println!(
        "{} el percentil 95 con caché es {} y el presupuesto son {}",
        if p95 <= BUDGET { "✓" } else { "✗" },
        millis(p95),
        millis(BUDGET)
    );
}

/// Escribe `KEYS` letras al final del último texto, una a una, midiendo el
/// camino entero de cada una.
fn measure(document: &Document, mut cycle: impl FnMut(&Document)) -> Vec<Duration> {
    let mut document = document.clone();
    let mut at = characters(&document);

    ('a'..)
        .take(KEYS)
        .map(|letter| {
            let started = Instant::now();
            // Lo que manda la interfaz al escribir una letra.
            document = Op::InsertText {
                id: "cuerpo-5".to_owned(),
                at,
                text: letter.to_string(),
            }
            .apply(&document)
            .expect("se aplica")
            .document;
            cycle(&document);
            at += 1;
            started.elapsed()
        })
        .collect()
}

/// Cuántos caracteres tiene el texto al que se escribe.
fn characters(document: &Document) -> usize {
    match document.element("cuerpo-5") {
        Some(galera_core::Element::Text { content, .. }) => {
            galera_core::model::text::length(content)
        }
        _ => panic!("fixtures/denso.json tiene un texto «cuerpo-5»"),
    }
}

fn report(name: &str, times: &[Duration]) {
    println!(
        "{name:<22}  {:>9}  {:>9}  {:>9}  {:>9}",
        millis(percentile(times, 50)),
        millis(percentile(times, 95)),
        millis(times.iter().copied().max().unwrap_or_default()),
        millis(BUDGET)
    );
}

fn percentile(times: &[Duration], percent: usize) -> Duration {
    let mut sorted = times.to_vec();
    sorted.sort_unstable();
    let at = (sorted.len() * percent).div_ceil(100).saturating_sub(1);
    sorted.get(at).copied().unwrap_or_default()
}

fn millis(time: Duration) -> String {
    format!("{:.1} ms", time.as_secs_f64() * 1000.0)
}
