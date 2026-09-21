//! Las plantillas que trae la aplicación se abren, se componen y no piden
//! nada de fuera.
//!
//! Una plantilla es lo primero que ve quien abre Galera sin tener nada, así
//! que tiene que estar entera: componerse sin un aviso, traerse sus fuentes
//! y enseñar en su sitio lo que cada variable vale de ejemplo. Un documento
//! que dependiera de una fuente del sistema se compondría distinto en otro
//! ordenador (principio 4), y una ficha sin valor saldría escrita como
//! `{{nombre}}` en el PDF.
//!
//! Lo que se comprueba, plantilla a plantilla:
//!
//! 1. Que está y se abre, con su `template.json` y su `document.json`.
//! 2. Que el documento vale: [`Document::validate`].
//! 3. Que se compone **sin un solo aviso**: ni de Typst, ni de contenido que
//!    se sale de su caja, ni de fichas sin valor, ni de texto que no cabe en
//!    la cadena de su flujo.
//! 4. Que sus fuentes están dentro de su carpeta y cubren las familias que
//!    usa: ninguna del sistema.
//! 5. Que cada variable que declara se usa en el documento y trae un valor
//!    de ejemplo.
//! 6. Que su PDF de referencia sigue en `fixtures/plantillas/`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use galera_core::{Document, Element, GaleraWorld, Template, compile, templates};

/// Las seis que trae la aplicación, con cuántas páginas compone cada una.
///
/// El número va aquí a propósito: una plantilla que de pronto componga una
/// página de más es un cambio que hay que ver, no que enterarse por el PDF.
const EXPECTED: [(&str, usize); 6] = [
    ("boletin", 2),
    ("carta", 1),
    ("certificado", 1),
    ("credencial", 1),
    ("factura", 1),
    ("informe", 1),
];

fn templates_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../templates")
}

fn references_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/plantillas")
}

fn all() -> Vec<Template> {
    templates::list(&templates_dir())
}

/// Las fichas de variable que usa el documento entero: las de un bloque de
/// texto, las de una celda de una tabla y las del texto de un flujo.
fn used_variables(document: &Document) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut scan = |text: &str| {
        let mut at = 0;
        while at < text.len() {
            match galera_core::variables::reference_at(text, at) {
                Some((name, length)) => {
                    names.insert(name.to_owned());
                    at += length;
                }
                None => at += 1,
            }
        }
    };

    for element in document.elements() {
        match element {
            Element::Text { content, .. } => {
                for run in content {
                    scan(&run.text);
                }
            }
            Element::Table { rows, .. } => {
                for row in rows {
                    for cell in &row.cells {
                        for run in &cell.content {
                            scan(&run.text);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    for flow in document.flows.values() {
        for run in &flow.content {
            scan(&run.text);
        }
    }

    names
}

#[test]
fn the_six_templates_of_the_gallery_are_there() {
    let gallery = all();
    let found: Vec<&str> = gallery.iter().map(|one| one.id.as_str()).collect();
    let expected: Vec<&str> = EXPECTED.iter().map(|(id, _)| *id).collect();

    assert_eq!(found, expected, "la galería trae otras plantillas");
    for template in &gallery {
        assert!(!template.meta.name.trim().is_empty(), "{}", template.id);
        assert!(
            !template.meta.description.trim().is_empty(),
            "{} no dice de qué es",
            template.id
        );
    }
}

/// El criterio de la tarea: las seis abren y se componen sin errores.
#[test]
fn every_template_compiles_without_a_single_warning() {
    for (id, pages) in EXPECTED {
        let path = templates_dir().join(id);
        let (project, document) = templates::open(&path).unwrap_or_else(|error| {
            panic!("{id} no se abre: {error}");
        });

        document
            .validate()
            .unwrap_or_else(|errors| panic!("{id} no vale: {errors}"));

        let compiled = compile(&document, &project).unwrap_or_else(|error| {
            panic!("{id} no compila: {error}");
        });

        assert_eq!(
            compiled.page_count(),
            pages,
            "{id} compone otro número de páginas"
        );
        assert!(
            compiled.warnings().is_empty(),
            "{id} avisa: {:?}",
            compiled.warnings()
        );

        // Lo que se sale de su caja, lo que no cabe en la cadena de un flujo
        // y las fichas sin valor: avisos del editor, no de Typst.
        let boxes = compiled.layout();
        assert!(
            galera_core::overflowing(&boxes).is_empty(),
            "{id} se sale de su caja: {:?}",
            galera_core::overflowing(&boxes)
        );
        let ranges = compiled.flows();
        assert!(
            galera_core::layout::flows::overflowing(&document, &ranges).is_empty(),
            "{id} tiene texto que no cabe en su cadena"
        );
        assert!(
            galera_core::variables::missing(&document).is_empty(),
            "{id} tiene fichas sin valor: {:?}",
            galera_core::variables::missing(&document)
        );
    }
}

/// El criterio de la tarea: cada plantilla trae sus fuentes y ninguna
/// depende de las del sistema (principio 4).
#[test]
fn every_template_carries_its_own_fonts() {
    for (id, _) in EXPECTED {
        let path = templates_dir().join(id);
        let (project, document) = templates::open(&path).expect("se abre");

        assert!(!document.fonts.is_empty(), "{id} no declara ninguna fuente");
        for font in &document.fonts {
            assert!(
                path.join(font).is_file(),
                "{id} declara {font}, que no está en su carpeta"
            );
        }

        // Y las que declara cubren lo que usa: sin eso, Typst compondría con
        // lo primero que tuviera a mano.
        let world = GaleraWorld::new(project, &document.fonts, String::new())
            .unwrap_or_else(|error| panic!("{id}: {error}"));
        document
            .validate_font_families(&world.font_families())
            .unwrap_or_else(|errors| panic!("{id} pide una familia que no trae: {errors}"));
    }
}

/// El criterio de la tarea: cada una declara sus variables con valores de
/// ejemplo.
#[test]
fn every_template_declares_its_variables_with_an_example() {
    for (id, _) in EXPECTED {
        let (_, document) = templates::open(&templates_dir().join(id)).expect("se abre");

        assert!(
            !document.variables.is_empty(),
            "{id} no declara ninguna variable"
        );
        for (name, variable) in &document.variables {
            assert!(
                !variable.value.trim().is_empty(),
                "{id}: la variable {name} no trae valor de ejemplo"
            );
        }

        // Una variable que no se usa en ninguna ficha no se ve por ninguna
        // parte: o sobra, o falta ponerla.
        let used = used_variables(&document);
        for name in document.variables.keys() {
            assert!(used.contains(name), "{id}: la variable {name} no se usa");
        }
        // Y al revés: una ficha de algo que no se declara saldría escrita
        // tal cual.
        for name in &used {
            assert!(
                document.variables.contains_key(name),
                "{id}: se usa {name}, que no está declarada"
            );
        }
    }
}

/// El criterio de la tarea: el PDF de cada plantilla se guarda como
/// referencia.
///
/// Se guarda para mirarlo, no para compararlo byte a byte: dos compilaciones
/// de Typst no dan el mismo archivo. Lo que se comprueba aquí es que la
/// referencia sigue estando y que es un PDF; que lo que compone hoy es lo
/// que se espera lo dicen las otras pruebas.
#[test]
fn every_template_keeps_its_reference_pdf() {
    for (id, _) in EXPECTED {
        let path = references_dir().join(format!("{id}.pdf"));
        let pdf = std::fs::read(&path).unwrap_or_else(|error| {
            panic!("falta la referencia de {id} en fixtures/plantillas/: {error}");
        });

        assert!(pdf.starts_with(b"%PDF"), "{id} no es un PDF");
        assert!(pdf.len() > 1024, "la referencia de {id} está vacía");
    }
}

/// Empezar un documento desde una plantilla da un proyecto normal, con sus
/// fuentes al lado y sin rastro de la plantilla.
#[test]
fn starting_from_a_template_copies_everything_it_needs() {
    let dir = tempfile::tempdir().expect("carpeta temporal");
    let dest = dir.path().join("Mi factura");

    let document = templates::create_from(&templates_dir().join("factura"), &dest)
        .expect("se copia la plantilla");

    assert_eq!(document.meta.title, "Mi factura");
    assert!(
        !dest.join(templates::TEMPLATE_FILE).exists(),
        "ya no es una plantilla"
    );
    for font in &document.fonts {
        assert!(dest.join(font).is_file(), "falta {font} en la copia");
    }

    let (project, document) = templates::open(&dest).expect("la copia es un proyecto");
    compile(&document, &project).expect("y se compone");
}
