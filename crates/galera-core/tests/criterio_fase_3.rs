//! El documento de ejemplo se construye entero **sin escribir JSON**.
//!
//! Es el criterio de salida de la Fase 3 ([#54]): partir de un proyecto
//! vacío y llegar al documento de la sección 4 de `guide.md`
//! —`fixtures/informe.json`— solo con lo que la interfaz sabe hacer.
//!
//! # Qué prueba esto y qué no
//!
//! La interfaz **no cambia el documento por su cuenta**: cada gesto manda un
//! comando al núcleo (principio 1), y el documento que se guarda es el que
//! devuelven esos comandos. Así que si la misma secuencia de comandos que
//! emiten los paneles y el lienzo llega al documento de referencia, es que
//! desde la aplicación se puede construir: no queda nada que solo se pueda
//! poner editando el archivo a mano.
//!
//! Lo que esto no sustituye es la **sesión a mano**: que los gestos que
//! mandan esos comandos existan, se encuentren y se entiendan. Eso se mira
//! con la app abierta y se anota en `docs/criterio-fase-3.md`.
//!
//! Cada paso de aquí dice con qué se hace en la aplicación.
//!
//! [#54]: https://github.com/xlCyanz/galera/issues/54

use std::fs;
use std::path::{Path, PathBuf};

use galera_core::model::text::Format;
use galera_core::{
    Document, Op, Project, Property, Run, TextStyle, Variable, VariableKind, compile, create,
    import_font, import_image,
};

/// El título con el que nace un proyecto nuevo, como en `commands::project`.
const NEW_TITLE: &str = "Sin título";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

/// Aplica un comando de los que manda la interfaz y se queda con el
/// documento que devuelve.
fn apply(document: &Document, op: Op) -> Document {
    op.apply(document)
        .unwrap_or_else(|error| panic!("{}: {error}", op.describe()))
        .document
}

#[test]
fn the_example_document_can_be_built_without_writing_any_json() {
    let dir = tempfile::tempdir().expect("carpeta temporal");
    let root = dir.path().join("Informe");

    // 1. «Nuevo proyecto…»: nace con una página A4 vacía y sin fuentes.
    create(&root, &Document::new(NEW_TITLE)).expect("se crea el proyecto");
    let project = Project::open(&root).expect("y se abre");
    let mut document = Document::new(NEW_TITLE);
    assert_eq!(document.pages.len(), 1);
    assert!(document.pages[0].elements.is_empty());

    // 2. Panel de fuentes → «Añadir…»: copia el archivo al proyecto y lo
    //    declara.
    for family in ["Inter-Regular.ttf", "Inter-Bold.ttf"] {
        let imported =
            import_font(&project, &fixtures().join("fonts").join(family)).expect("es una fuente");
        document = apply(
            &document,
            Op::AddFont {
                path: imported.path,
                index: None,
            },
        );
    }

    // 3. Campo «Título» del inspector, sin nada seleccionado.
    document = apply(
        &document,
        Op::SetTitle {
            title: "Informe anual 2026".to_owned(),
        },
    );

    // 4. Pestaña «Variables» → «Añadir».
    document = apply(
        &document,
        Op::SetVariable {
            name: "nombre".to_owned(),
            variable: Variable {
                kind: VariableKind::Text,
                value: "Cooperativa Agrícola del Este".to_owned(),
            },
        },
    );

    // 5. Herramienta R: el lienzo crea el rectángulo donde se arrastró, con
    //    un id automático, y el inspector lo coloca y lo pinta.
    document = apply(
        &document,
        Op::Create {
            page: "p1".to_owned(),
            index: None,
            element: rect("rect-1"),
        },
    );
    document = apply(
        &document,
        Op::Resize {
            id: "rect-1".to_owned(),
            x: 0.0,
            y: 0.0,
            w: 210.0,
            h: Some(15.0),
        },
    );
    document = apply(
        &document,
        Op::SetProperty {
            id: "rect-1".to_owned(),
            property: Property::Fill(Some("#1e40af".to_owned())),
        },
    );
    document = apply(
        &document,
        Op::SetProperty {
            id: "rect-1".to_owned(),
            property: Property::Stroke(None),
        },
    );

    // 6. Herramienta T, escribir el titular y ponerlo en negrita (⌘B), con
    //    su estilo en el inspector de texto.
    document = apply(
        &document,
        Op::Create {
            page: "p1".to_owned(),
            index: None,
            element: text("text-1"),
        },
    );
    document = apply(
        &document,
        Op::Resize {
            id: "text-1".to_owned(),
            x: 20.0,
            y: 30.0,
            w: 170.0,
            h: None,
        },
    );
    document = apply(
        &document,
        Op::InsertText {
            id: "text-1".to_owned(),
            at: 0,
            text: "Informe anual".to_owned(),
        },
    );
    document = apply(
        &document,
        Op::FormatText {
            id: "text-1".to_owned(),
            from: 0,
            to: "Informe anual".chars().count(),
            format: Format {
                bold: Some(true),
                ..Default::default()
            },
        },
    );
    document = apply(
        &document,
        Op::SetProperty {
            id: "text-1".to_owned(),
            property: Property::Style(TextStyle {
                font: "Inter".to_owned(),
                size: 28.0,
                color: "#1F2733".to_owned(),
                align: galera_core::Align::Left,
                leading: 0.65,
                spacing: None,
            }),
        },
    );

    // 7. Soltar el logotipo en el lienzo: se copia a `assets/`, se registra
    //    con su clave y queda puesto donde se soltó.
    let logo = import_image(&project, &document, &fixtures().join("assets/logo.png"))
        .expect("es una imagen");
    document = apply(
        &document,
        Op::AddAsset {
            key: logo.key.clone(),
            path: logo.path,
        },
    );
    document = apply(
        &document,
        Op::Create {
            page: "p1".to_owned(),
            index: None,
            element: image("image-1", &logo.key),
        },
    );
    document = apply(
        &document,
        Op::Resize {
            id: "image-1".to_owned(),
            x: 20.0,
            y: 60.0,
            w: 80.0,
            h: None,
        },
    );

    // 8. Herramienta C y campo «Código Typst» del inspector.
    document = apply(
        &document,
        Op::Create {
            page: "p1".to_owned(),
            index: None,
            element: code("code-1"),
        },
    );
    document = apply(
        &document,
        Op::Resize {
            id: "code-1".to_owned(),
            x: 20.0,
            y: 200.0,
            w: 170.0,
            h: Some(40.0),
        },
    );
    document = apply(
        &document,
        Op::SetProperty {
            id: "code-1".to_owned(),
            property: Property::Source("#table(columns: 2)[A][B]".to_owned()),
        },
    );

    // 9. Doble clic en el id, en el inspector: los ids cortos del ejemplo.
    for (from, to) in [
        ("rect-1", "r1"),
        ("text-1", "t1"),
        ("image-1", "i1"),
        ("code-1", "c1"),
    ] {
        document = apply(
            &document,
            Op::Rename {
                id: from.to_owned(),
                to: to.to_owned(),
            },
        );
    }

    // Y lo que sale es el documento de referencia, elemento a elemento.
    let expected = reference();
    assert_eq!(document.meta, expected.meta);
    assert_eq!(document.fonts, expected.fonts);
    assert_eq!(document.assets, expected.assets);
    assert_eq!(document.variables, expected.variables);
    assert_eq!(document.pages, expected.pages, "las páginas no coinciden");
    assert_eq!(document, expected);

    // 10. ⌘S: lo que se guarda es lo que se ve, y se vuelve a abrir igual.
    fs::write(
        root.join(galera_core::DOCUMENT_FILE),
        document.to_json_string().expect("se serializa"),
    )
    .expect("se guarda");
    let reopened = galera_core::open(&root).expect("se vuelve a abrir");
    assert_eq!(reopened.document, expected);

    // Y compone: el proyecto se lleva sus fuentes y su imagen.
    let compiled = compile(&reopened.document, &reopened.project).expect("compila");
    assert_eq!(compiled.page_count(), 1);
    assert!(compiled.warnings().is_empty(), "{:?}", compiled.warnings());
}

/// El documento de referencia: el ejemplo de `guide.md`.
fn reference() -> Document {
    let json = fs::read_to_string(fixtures().join("informe.json")).expect("está el fixture");
    Document::from_json_str(&json).expect("es un documento")
}

/// Los elementos tal como los crea el lienzo antes de tocar el inspector:
/// con el id que genera la interfaz y en el sitio donde se arrastró.
fn rect(id: &str) -> galera_core::Element {
    element(&format!(
        r##"{{ "id": "{id}", "type": "rect", "x": 40, "y": 40, "w": 60, "h": 30,
               "fill": "#94A3B8", "stroke": null }}"##
    ))
}

fn text(id: &str) -> galera_core::Element {
    element(&format!(
        r##"{{ "id": "{id}", "type": "text", "x": 40, "y": 40, "w": 60, "h": null,
               "content": [], "style": {{ "font": "Inter", "size": 12, "color": "#1F2733" }} }}"##
    ))
}

fn image(id: &str, asset: &str) -> galera_core::Element {
    element(&format!(
        r##"{{ "id": "{id}", "type": "image", "x": 40, "y": 40, "w": 60, "h": null,
               "asset": "{asset}" }}"##
    ))
}

fn code(id: &str) -> galera_core::Element {
    element(&format!(
        r##"{{ "id": "{id}", "type": "code", "x": 40, "y": 40, "w": 60, "h": 30,
               "source": "" }}"##
    ))
}

fn element(json: &str) -> galera_core::Element {
    serde_json::from_str(json).expect("es un elemento")
}

/// Un texto vacío se queda sin tramos; al escribir, el comando los crea.
#[test]
fn the_first_letter_of_a_text_creates_its_run() {
    let document = Document::new("x");
    let with_text = apply(
        &document,
        Op::Create {
            page: "p1".to_owned(),
            index: None,
            element: text("text-1"),
        },
    );
    let written = apply(
        &with_text,
        Op::InsertText {
            id: "text-1".to_owned(),
            at: 0,
            text: "a".to_owned(),
        },
    );

    match written.element("text-1") {
        Some(galera_core::Element::Text { content, .. }) => {
            assert_eq!(content, &vec![Run::plain("a")]);
        }
        other => panic!("no es un texto: {other:?}"),
    }
}
