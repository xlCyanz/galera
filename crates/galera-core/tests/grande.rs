//! El documento de 50 páginas (F8-04, #91).
//!
//! `fixtures/grande.json` es el banco de pruebas de los documentos grandes:
//! cincuenta páginas con texto justificado, fotos, tablas, cabecera y pie.
//! Lo que tarda y lo que ocupa lo mide `benches/grande.rs` —con el binario
//! optimizado— y queda anotado en `docs/rendimiento.md`. Aquí se comprueba lo
//! que no depende de la máquina: que el documento es lo que dice ser y que
//! escribir en él solo vuelve a dibujar la página que se toca.

use std::path::{Path, PathBuf};

use galera_core::{Compiler, Document, Element, Op, Project, compile, overflowing};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn load() -> (Project, Document) {
    let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
    let json = std::fs::read_to_string(fixtures_dir().join("grande.json")).expect("grande.json");
    let document = Document::from_json_str(&json).expect("es un documento");
    (project, document)
}

/// Cuántos elementos de cada tipo hay en el documento.
fn count(document: &Document, kind: fn(&Element) -> bool) -> usize {
    document
        .pages
        .iter()
        .flat_map(|page| &page.elements)
        .filter(|element| kind(element))
        .count()
}

/// El criterio de la tarea: un documento de 50 páginas con texto, imágenes
/// y tablas.
#[test]
fn it_has_fifty_pages_of_real_content() {
    let (project, document) = load();
    assert_eq!(document.pages.len(), 50);
    assert!(count(&document, |e| matches!(e, Element::Text { .. })) >= 200);
    assert!(count(&document, |e| matches!(e, Element::Image { .. })) >= 20);
    assert!(count(&document, |e| matches!(e, Element::Table { .. })) >= 20);

    // Y compone entero, sin avisos ni nada que se salga de su caja: un
    // banco de pruebas con errores mediría otra cosa.
    let compiled = compile(&document, &project).expect("compila");
    assert_eq!(compiled.page_count(), 50);
    assert_eq!(compiled.warnings(), []);
    assert_eq!(overflowing(&compiled.layout()), []);
}

/// El criterio de la tarea: al escribir se recompila solo la página
/// afectada.
///
/// Typst compone el documento entero —no se puede partir—, pero lo que no
/// cambia sale de su memoria. Lo que sí cuesta por página es dibujarla, y
/// eso se hace solo con la que cambió: las otras 49 se devuelven como
/// estaban.
#[test]
fn typing_in_the_middle_draws_only_that_page() {
    let (project, mut document) = load();
    let mut compiler = Compiler::new(project);

    let compiled = compiler.compile(&document).expect("compila");
    let before = compiler.page_svgs(&compiled);
    assert_eq!(compiler.pages_rendered(), 50, "la primera vez, todas");

    for (key, letter) in "abc".chars().enumerate() {
        document = Op::InsertText {
            id: "cuerpo-25".to_owned(),
            at: 0,
            text: letter.to_string(),
        }
        .apply(&document)
        .expect("se aplica")
        .document;
        let compiled = compiler.compile(&document).expect("compila");
        let after = compiler.page_svgs(&compiled);

        assert_eq!(compiler.pages_rendered(), 51 + key, "una página por tecla");
        assert_eq!(compiler.worlds_built(), 1, "el entorno no se rehace");
        let changed: Vec<usize> = (0..50)
            .filter(|&page| after[page] != before[page])
            .collect();
        assert_eq!(changed, [24], "solo cambia la página 25");
    }
}
