//! Abrir un proyecto: su carpeta, su documento y sus recursos.
//!
//! Es lo que hace la app cuando alguien elige una carpeta. [`open`] junta en
//! un solo paso todo lo que tiene que estar bien para que el documento se
//! pueda editar y compilar, y lo comprueba **al abrir**, no a la primera
//! compilación:
//!
//! 1. la carpeta existe ([`Project::open`]);
//! 2. tiene un `document.json` que se puede leer y es un documento;
//! 3. el documento es válido ([`Document::validate`]);
//! 4. cada imagen declarada en `assets` es un archivo dentro del proyecto;
//! 5. cada fuente declarada en `fonts` se carga, y las familias que usa el
//!    texto están entre ellas ([`Document::validate_font_families`]).
//!
//! Si algo falla, se devuelve el error y no se abre nada: quien llama
//! conserva lo que tuviera abierto.
//!
//! Las fuentes se cargan para comprobarlas y se sueltan. Cada compilación las
//! vuelve a cargar; reutilizarlas entre compilaciones es F4-04.

use std::path::Path;

use crate::error::Result;
use crate::model::Document;
use crate::project::{AccessError, Project};
use crate::world::GaleraWorld;

/// El nombre del documento dentro de la carpeta del proyecto.
pub const DOCUMENT_FILE: &str = "document.json";

/// Un proyecto abierto, con su documento ya comprobado.
#[derive(Debug, Clone)]
pub struct Opened {
    /// La carpeta del proyecto.
    pub project: Project,
    /// El documento, válido y con sus recursos en su sitio.
    pub document: Document,
}

/// Algo del proyecto impide abrirlo, además de lo que ya dicen
/// [`ProjectError`](crate::ProjectError), la validación y
/// [`WorldError`](crate::WorldError).
#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    /// La carpeta no tiene `document.json`.
    #[error("la carpeta no tiene {DOCUMENT_FILE}: no parece un proyecto de Galera")]
    MissingDocument,

    /// `document.json` existe pero no se puede leer.
    #[error("no se puede leer {DOCUMENT_FILE}: {0}")]
    UnreadableDocument(#[source] AccessError),

    /// `document.json` no es un documento: JSON mal formado, un campo que
    /// falta o una versión del formato que este núcleo no entiende.
    #[error("{DOCUMENT_FILE} no es un documento de Galera: {0}")]
    MalformedDocument(#[source] serde_json::Error),

    /// Una imagen declarada no se puede usar.
    #[error("la imagen {key:?} apunta a {path:?}, que no se puede usar: {source}")]
    Asset {
        /// La clave de la imagen en `assets`.
        key: String,
        /// La ruta tal como la declara el documento.
        path: String,
        /// Por qué no se puede usar.
        source: AccessError,
    },
}

/// Abre la carpeta de un proyecto y comprueba su documento y sus recursos.
/// Ver el módulo.
///
/// # Errores
///
/// - [`GaleraError::Project`](crate::GaleraError::Project) si la carpeta no
///   existe o no es una carpeta.
/// - [`GaleraError::Open`](crate::GaleraError::Open) si falta
///   `document.json`, no se puede leer, no es un documento o una imagen no
///   está.
/// - [`GaleraError::Invalid`](crate::GaleraError::Invalid) si el documento no
///   pasa la validación, incluida la de familias tipográficas.
/// - [`GaleraError::World`](crate::GaleraError::World) si una fuente no está
///   o no es una fuente.
pub fn open(root: &Path) -> Result<Opened> {
    let project = Project::open(root)?;

    let json = project.read(DOCUMENT_FILE).map_err(|error| match error {
        AccessError::NotFound => OpenError::MissingDocument,
        other => OpenError::UnreadableDocument(other),
    })?;
    let document: Document = serde_json::from_slice(&json).map_err(OpenError::MalformedDocument)?;

    document.validate()?;

    for (key, path) in &document.assets {
        project.file(path).map_err(|source| OpenError::Asset {
            key: key.clone(),
            path: path.clone(),
            source,
        })?;
    }

    // Sin código que compilar: solo interesan las fuentes.
    let world = GaleraWorld::new(project.clone(), &document.fonts, String::new())?;
    document.validate_font_families(&world.font_families())?;

    Ok(Opened { project, document })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::*;
    use crate::error::GaleraError;
    use crate::model::Problem;
    use crate::world::WorldError;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// Un proyecto temporal con ese `document.json`.
    fn project_with(document: &str) -> TempDir {
        let dir = TempDir::new().expect("carpeta temporal");
        fs::write(dir.path().join(DOCUMENT_FILE), document).expect("escribir");
        dir
    }

    /// Un documento de una página con un rectángulo: sin fuentes ni imágenes.
    fn document_json(extra: &str, w: f64) -> String {
        format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Prueba" }},
              {extra}
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": {w}, "h": 10,
                                "fill": "#000000", "stroke": null }}]
              }}]
            }}"##
        )
    }

    /// `fixtures/` es un proyecto de verdad, con fuentes e imágenes.
    #[test]
    fn it_opens_the_fixtures_folder() {
        let opened = open(&fixtures_dir()).expect("fixtures/ debe abrirse");
        assert_eq!(opened.document.meta.title, "Informe anual 2026");
        assert!(!opened.document.fonts.is_empty());
        assert!(!opened.document.assets.is_empty());
        assert_eq!(
            opened.project.root(),
            fixtures_dir().canonicalize().expect("existe")
        );
    }

    #[test]
    fn a_minimal_project_opens() {
        let dir = project_with(&document_json("", 10.0));
        let opened = open(dir.path()).expect("debe abrirse");
        assert_eq!(opened.document.pages.len(), 1);
    }

    #[test]
    fn a_missing_folder_is_a_project_error() {
        assert!(matches!(
            open(Path::new("/no/existe/este/proyecto")),
            Err(GaleraError::Project(_))
        ));
    }

    #[test]
    fn a_folder_without_document_json_is_not_a_project() {
        let dir = TempDir::new().expect("carpeta temporal");
        let error = open(dir.path()).expect_err("no es un proyecto");
        assert!(
            matches!(error, GaleraError::Open(OpenError::MissingDocument)),
            "{error:?}"
        );
        assert_eq!(
            error.to_string(),
            "la carpeta no tiene document.json: no parece un proyecto de Galera"
        );
    }

    #[test]
    fn a_document_json_that_is_a_folder_is_unreadable() {
        let dir = TempDir::new().expect("carpeta temporal");
        fs::create_dir(dir.path().join(DOCUMENT_FILE)).expect("carpeta");
        assert!(matches!(
            open(dir.path()),
            Err(GaleraError::Open(OpenError::UnreadableDocument(
                AccessError::IsDirectory
            )))
        ));
    }

    /// El mensaje dice dónde está el fallo del JSON.
    #[test]
    fn malformed_json_says_where() {
        let dir = project_with("{\n  \"version\": 1,\n  \"meta\": \n}");
        let error = open(dir.path()).expect_err("JSON mal formado");
        assert!(
            matches!(error, GaleraError::Open(OpenError::MalformedDocument(_))),
            "{error:?}"
        );
        assert!(error.to_string().contains("line 4"), "{error}");
    }

    #[test]
    fn an_unknown_format_version_is_malformed() {
        let dir =
            project_with(&document_json("", 10.0).replace("\"version\": 1", "\"version\": 99"));
        assert!(matches!(
            open(dir.path()),
            Err(GaleraError::Open(OpenError::MalformedDocument(_)))
        ));
    }

    /// El criterio de F1-03: un documento inválido devuelve el error de
    /// validación de F0-03, con sus problemas.
    #[test]
    fn an_invalid_document_returns_the_validation_error() {
        let dir = project_with(&document_json("", -3.0));
        match open(dir.path()) {
            Err(GaleraError::Invalid(errors)) => {
                assert!(matches!(
                    errors.0.as_slice(),
                    [error] if matches!(error.problem, Problem::NotPositive { field: "w", .. })
                ));
            }
            other => panic!("se esperaba un error de validación: {other:?}"),
        }
    }

    #[test]
    fn a_missing_image_is_an_error_on_open() {
        let dir = project_with(&document_json(
            r#""assets": { "logo": "assets/logo.png" },"#,
            10.0,
        ));
        let error = open(dir.path()).expect_err("falta la imagen");
        assert!(
            matches!(
                &error,
                GaleraError::Open(OpenError::Asset { key, source: AccessError::NotFound, .. })
                    if key == "logo"
            ),
            "{error:?}"
        );
        assert_eq!(
            error.to_string(),
            "la imagen \"logo\" apunta a \"assets/logo.png\", que no se puede usar: no hay ningún archivo en esa ruta"
        );
    }

    #[test]
    fn an_image_outside_the_project_is_an_error_on_open() {
        let dir = project_with(&document_json(
            r#""assets": { "secreto": "../../etc/passwd" },"#,
            10.0,
        ));
        assert!(matches!(
            open(dir.path()),
            Err(GaleraError::Open(OpenError::Asset {
                source: AccessError::Outside,
                ..
            }))
        ));
    }

    #[test]
    fn a_present_image_is_accepted() {
        let dir = project_with(&document_json(
            r#""assets": { "logo": "assets/logo.png" },"#,
            10.0,
        ));
        fs::create_dir(dir.path().join("assets")).expect("assets/");
        fs::write(
            dir.path().join("assets/logo.png"),
            b"no hace falta que sea PNG",
        )
        .expect("escribir");
        assert!(open(dir.path()).is_ok());
    }

    #[test]
    fn a_missing_font_is_an_error_on_open() {
        let dir = project_with(&document_json(
            r#""fonts": ["fonts/Inter-Regular.ttf"],"#,
            10.0,
        ));
        assert!(matches!(
            open(dir.path()),
            Err(GaleraError::World(WorldError::FontNotFound { .. }))
        ));
    }

    /// Una familia que no traen las fuentes del proyecto también se detecta
    /// al abrir, no al compilar.
    #[test]
    fn an_unknown_font_family_is_an_error_on_open() {
        let json = r##"{
          "version": 1,
          "meta": { "title": "Prueba" },
          "pages": [{
            "id": "p1",
            "size": { "width": 210, "height": 297, "unit": "mm" },
            "elements": [{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 50,
                           "content": [{ "text": "Hola" }],
                           "style": { "font": "Comic Sans", "size": 12, "color": "#000000" } }]
          }]
        }"##;
        let dir = project_with(json);
        match open(dir.path()) {
            Err(GaleraError::Invalid(errors)) => assert!(
                errors
                    .0
                    .iter()
                    .any(|error| matches!(&error.problem, Problem::UnknownFontFamily { family } if family == "Comic Sans")),
                "{errors}"
            ),
            other => panic!("se esperaba un error de familia: {other:?}"),
        }
    }
}
