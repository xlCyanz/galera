//! Instantáneas del código Typst generado para cada fixture de `fixtures/`.
//!
//! Cada archivo `fixtures/*.json` tiene aquí su instantánea. Si un cambio en
//! el codegen altera el código de cualquiera de ellos, la prueba falla y el
//! diff queda a la vista para aprobarlo a mano con `cargo insta review`.
//! Ver `fixtures/README.md`.

use std::path::{Path, PathBuf};

use galera_core::{Document, Project, Severity, codegen, compile};

/// Los fixtures con instantánea. Si se añade un `.json` a `fixtures/` y no se
/// añade aquí, `every_fixture_has_a_snapshot` falla.
///
/// `document.json` no está: es una copia de `informe.json` para que
/// `fixtures/` se pueda abrir como proyecto, y
/// `document_json_is_a_copy_of_informe` comprueba que siguen iguales.
const FIXTURES: &[&str] = &[
    "capas",
    "codigo",
    "denso",
    "elipse",
    "escape",
    "formato",
    "grupos",
    "guionado",
    "imagen",
    "informe",
    "linea",
    "listas",
    "multipagina",
    "rectangulo",
    "texto",
    "variables",
];

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn load(name: &str) -> Document {
    let path = fixtures_dir().join(format!("{name}.json"));
    let json = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("no se puede leer {}: {error}", path.display()));
    Document::from_json_str(&json)
        .unwrap_or_else(|error| panic!("{} no es un documento válido: {error}", path.display()))
}

/// Una instantánea por fixture, con el nombre del fixture.
#[test]
fn generated_code_snapshots() {
    for name in FIXTURES {
        let code = codegen::generate(&load(name))
            .unwrap_or_else(|error| panic!("{name}.json debe generar código: {error}"));
        insta::assert_snapshot!(*name, code);
    }
}

/// Un fixture que existe pero no está en la lista no tendría instantánea, y
/// los cambios que le afecten pasarían sin que nadie los viera.
#[test]
fn every_fixture_has_a_snapshot() {
    let mut on_disk: Vec<String> = std::fs::read_dir(fixtures_dir())
        .expect("fixtures/ debe existir")
        .filter_map(|entry| {
            let path = entry.expect("entrada legible").path();
            (path.extension()? == "json")
                .then(|| path.file_stem()?.to_str().map(str::to_owned))
                .flatten()
        })
        .collect();
    on_disk.retain(|name| name != "document");
    on_disk.sort();

    let listed: Vec<String> = FIXTURES.iter().map(|name| (*name).to_owned()).collect();
    assert_eq!(
        on_disk, listed,
        "la lista FIXTURES de tests/fixtures.rs tiene que coincidir con los .json de fixtures/"
    );
}

/// El criterio de la tarea: `fixtures/informe.json` reproduce el ejemplo de la
/// sección 4 de `guide.md`. Se comprueba contra la propia guía, así que si una
/// de las dos cambia sin la otra, esta prueba lo dice.
#[test]
fn informe_matches_the_example_in_the_guide() {
    let guide =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../guide.md"))
            .expect("guide.md debe existir");

    let section = &guide[guide
        .find("## 4. Modelo de documento")
        .expect("guide.md tiene la sección 4")..];
    let start = section
        .find("```json\n")
        .expect("la sección 4 tiene un bloque JSON")
        + "```json\n".len();
    let end = start
        + section[start..]
            .find("```")
            .expect("el bloque JSON está cerrado");

    let from_guide: serde_json::Value =
        serde_json::from_str(&section[start..end]).expect("el JSON de la guía es válido");
    let fixture: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures_dir().join("informe.json")).expect("informe.json existe"),
    )
    .expect("informe.json es JSON válido");

    assert_eq!(fixture, from_guide);
}

/// `fixtures/` es también un proyecto que la app puede abrir, y su
/// `document.json` es el informe de la guía. Si alguien cambia uno sin el
/// otro, esta prueba lo dice.
#[test]
fn document_json_is_a_copy_of_informe() {
    let read = |name: &str| {
        std::fs::read_to_string(fixtures_dir().join(name))
            .unwrap_or_else(|error| panic!("no se puede leer {name}: {error}"))
    };
    assert_eq!(
        read("document.json"),
        read("informe.json"),
        "fixtures/document.json tiene que ser una copia exacta de fixtures/informe.json"
    );
}

/// Los fixtures de un tipo de elemento tienen que contener de verdad ese
/// tipo, y nada más: si alguien los edita, que no pierdan su propósito.
#[test]
fn element_fixtures_contain_only_their_element_type() {
    for (name, element_type) in [
        ("rectangulo", "rect"),
        ("elipse", "ellipse"),
        ("linea", "line"),
        ("texto", "text"),
        ("imagen", "image"),
        ("codigo", "code"),
    ] {
        let document = load(name);
        let types: Vec<&str> = document
            .pages
            .iter()
            .flat_map(|page| &page.elements)
            .map(|element| element.type_name())
            .collect();

        assert!(!types.is_empty(), "{name}.json no tiene elementos");
        assert!(
            types.iter().all(|found| *found == element_type),
            "{name}.json debería tener solo elementos {element_type}: {types:?}"
        );
    }
}

#[test]
fn the_multipage_fixture_has_several_page_sizes() {
    let document = load("multipagina");
    assert!(document.pages.len() >= 3, "tiene que tener varias páginas");

    let mut sizes: Vec<(f64, f64)> = document
        .pages
        .iter()
        .map(|page| {
            (
                page.size.unit.to_millimeters(page.size.width),
                page.size.unit.to_millimeters(page.size.height),
            )
        })
        .collect();
    sizes.dedup();
    assert!(sizes.len() >= 3, "y varios tamaños distintos: {sizes:?}");
}

/// Con las fuentes y las imágenes de `fixtures/`, todos los fixtures
/// compilan de verdad a PDF, no solo generan código.
///
/// Ninguno da errores ni avisos.
#[test]
fn every_fixture_compiles_to_pdf() {
    let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");

    for name in FIXTURES {
        let compiled = compile(&load(name), &project)
            .unwrap_or_else(|error| panic!("{name}.json debe compilar: {error}"));
        let pdf = compiled
            .to_pdf()
            .unwrap_or_else(|error| panic!("{name}.json debe exportarse: {error}"));
        assert!(pdf.starts_with(b"%PDF-"), "{name}.json");

        assert!(
            compiled
                .warnings()
                .iter()
                .all(|w| w.severity != Severity::Warning),
            "{name}.json no debería dar avisos: {:#?}",
            compiled.warnings()
        );
    }
}

/// Todos los fixtures son documentos válidos.
#[test]
fn every_fixture_is_valid() {
    for name in FIXTURES {
        if let Err(errors) = load(name).validate() {
            panic!("{name}.json no es válido: {errors}");
        }
    }
}
