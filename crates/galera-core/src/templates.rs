//! Plantillas: documentos de los que se parte para hacer uno nuevo.
//!
//! Una plantilla **es un proyecto de Galera**, ni más ni menos: una carpeta
//! con su `document.json`, sus fuentes y sus recursos. Lo único que añade es
//! un `template.json` al lado con cómo se llama y de qué es, para poder
//! enseñarla en la galería.
//!
//! ```text
//! plantillas/
//!   factura/
//!     template.json     ← nombre, descripción, de qué va
//!     document.json     ← el documento, con sus variables declaradas
//!     fonts/  assets/   ← lo que necesite para componerse
//! ```
//!
//! # Empezar un documento desde una plantilla
//!
//! Se **copia entera** a donde diga quien la usa, con sus fuentes y sus
//! recursos ([`create_from`]), y a partir de ahí es un proyecto normal: no
//! queda enlazado a la plantilla ni recuerda de cuál salió, así que cambiar
//! la plantilla más tarde no toca lo que ya se hizo con ella.
//!
//! Lo único que cambia de la copia es el **título**, que pasa a ser el de la
//! carpeta o el archivo nuevo: un documento que se llame «Factura
//! (plantilla)» no es lo que nadie quiere ver en su PDF.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archive::{self, ArchiveError, ProjectFormat};
use crate::model::Document;
use crate::open::{self, DOCUMENT_FILE};
use crate::project::Project;

/// El archivo que hace de una carpeta de proyecto una plantilla.
pub const TEMPLATE_FILE: &str = "template.json";

/// Lo que se sabe de una plantilla sin abrirla.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "templates.ts"))]
pub struct TemplateMeta {
    /// Cómo se llama, para la galería: «Factura».
    pub name: String,
    /// Una línea de qué es y para qué sirve.
    #[serde(default)]
    pub description: String,
    /// De qué grupo es, para ordenarlas: «negocio», «personal».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

/// Una plantilla encontrada en una carpeta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Template {
    /// Su carpeta, dentro de las plantillas: `factura`.
    pub id: String,
    /// Dónde está.
    pub path: PathBuf,
    /// Cómo se llama y de qué es.
    pub meta: TemplateMeta,
}

/// Las plantillas que hay en `dir`, por orden de nombre.
///
/// Una carpeta es una plantilla si tiene `template.json` y `document.json`.
/// Lo que no lo sea se salta sin ruido: la carpeta de plantillas puede
/// llevar otras cosas.
pub fn list(dir: &Path) -> Vec<Template> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<Template> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_name()?.to_str()?.to_owned();
            Some(Template {
                id,
                meta: meta_of(&path)?,
                path,
            })
        })
        .collect();
    found.sort_by(|one, another| one.meta.name.cmp(&another.meta.name));
    found
}

/// La plantilla que está en `path`, o `None` si ahí no hay una.
pub fn meta_of(path: &Path) -> Option<TemplateMeta> {
    if !path.join(DOCUMENT_FILE).is_file() {
        return None;
    }
    let json = fs::read_to_string(path.join(TEMPLATE_FILE)).ok()?;
    serde_json::from_str(&json).ok()
}

/// Abre una plantilla como proyecto, para componerla y enseñar su aspecto.
///
/// # Errores
///
/// Los de [`open`](crate::open): ahí no hay una plantilla, o su documento no
/// vale.
pub fn open(path: &Path) -> Result<(Project, Document), crate::GaleraError> {
    let opened = open::open(path)?;
    Ok((opened.project, opened.document))
}

/// Copia la plantilla a `dest` y devuelve el documento que queda.
///
/// `dest` puede ser una carpeta nueva o un `.galera`, como cualquier
/// proyecto. El título del documento pasa a ser el nombre de `dest`.
///
/// # Errores
///
/// - [`TemplateError::Open`] si la plantilla no se puede abrir.
/// - [`TemplateError::Copy`] si no se puede escribir donde se pide, o si ya
///   hay algo ahí.
pub fn create_from(template: &Path, dest: &Path) -> Result<Document, TemplateError> {
    let (project, mut document) = open(template).map_err(TemplateError::Open)?;

    document.meta.title = dest
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or_else(|| document.meta.title.clone());

    match ProjectFormat::of(dest) {
        ProjectFormat::Folder => {
            if dest.exists() && fs::read_dir(dest).is_ok_and(|mut entries| entries.next().is_some())
            {
                return Err(TemplateError::Copy(ArchiveError::AlreadyThere {
                    path: dest.to_owned(),
                }));
            }
            archive::save_as_folder(&project, &document, dest).map_err(TemplateError::Copy)?;
        }
        ProjectFormat::Archive => {
            if dest.exists() {
                return Err(TemplateError::Copy(ArchiveError::AlreadyThere {
                    path: dest.to_owned(),
                }));
            }
            archive::pack(&project, &document, dest).map_err(TemplateError::Copy)?;
        }
    }

    Ok(document)
}

/// Lo que puede fallar al empezar un documento desde una plantilla.
#[derive(Debug, thiserror::Error)]
pub enum TemplateError {
    /// La plantilla no se pudo abrir.
    #[error("la plantilla no se puede abrir: {0}")]
    Open(#[source] crate::GaleraError),
    /// No se pudo copiar a donde se pidió.
    #[error("no se puede crear el proyecto: {0}")]
    Copy(#[source] ArchiveError),
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Una carpeta de plantillas con una plantilla dentro y una carpeta que
    /// no lo es.
    fn templates() -> TempDir {
        let dir = TempDir::new().expect("carpeta temporal");
        let factura = dir.path().join("factura");
        fs::create_dir_all(factura.join("assets")).expect("assets/");
        fs::create_dir_all(factura.join("fonts")).expect("fonts/");
        fs::write(
            factura.join(TEMPLATE_FILE),
            r#"{ "name": "Factura", "description": "Una factura sencilla", "category": "negocio" }"#,
        )
        .expect("template.json");
        fs::write(
            factura.join(DOCUMENT_FILE),
            r##"{
              "version": 1,
              "meta": { "title": "Factura (plantilla)" },
              "variables": { "empresa": { "kind": "text", "value": "" } },
              "pages": [ { "id": "p1", "size": { "width": 210, "height": 297 }, "elements": [
                { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 210, "h": 15,
                  "fill": "#1F2733" }
              ] } ]
            }"##,
        )
        .expect("document.json");
        fs::write(factura.join("assets/logo.png"), b"no es un png de verdad").expect("un recurso");

        // Una carpeta que no es plantilla: no tiene `template.json`.
        let otra = dir.path().join("otra");
        fs::create_dir_all(&otra).expect("otra/");
        fs::write(otra.join(DOCUMENT_FILE), "{}").expect("document.json");

        dir
    }

    #[test]
    fn it_lists_the_folders_that_are_templates() {
        let dir = templates();
        let found = list(dir.path());

        assert_eq!(found.len(), 1, "{found:#?}");
        assert_eq!(found[0].id, "factura");
        assert_eq!(found[0].meta.name, "Factura");
        assert_eq!(found[0].meta.category.as_deref(), Some("negocio"));
    }

    #[test]
    fn a_folder_without_its_template_file_is_not_one() {
        let dir = templates();
        assert!(meta_of(&dir.path().join("otra")).is_none());
        assert!(meta_of(&dir.path().join("nada")).is_none());
        assert!(list(&dir.path().join("nada")).is_empty());
    }

    /// El criterio de la tarea: crear copia la plantilla entera.
    #[test]
    fn creating_copies_the_whole_template() {
        let dir = templates();
        let target = TempDir::new().expect("carpeta temporal");
        let dest = target.path().join("Mi factura");

        let document = create_from(&dir.path().join("factura"), &dest).expect("se copia");

        assert!(dest.join(DOCUMENT_FILE).is_file());
        assert!(dest.join("assets/logo.png").is_file(), "con sus recursos");
        // El título es el del proyecto nuevo, no el de la plantilla.
        assert_eq!(document.meta.title, "Mi factura");
        let copied = fs::read_to_string(dest.join(DOCUMENT_FILE)).expect("se lee");
        assert!(copied.contains(r#""title": "Mi factura""#), "{copied}");
        // Y nada dice de qué plantilla salió.
        assert!(!copied.contains("plantilla"), "{copied}");
        assert!(
            !dest.join(TEMPLATE_FILE).exists(),
            "la copia no es plantilla"
        );
    }

    #[test]
    fn creating_into_a_galera_file_packs_it() {
        let dir = templates();
        let target = TempDir::new().expect("carpeta temporal");
        let dest = target.path().join("Mi factura.galera");

        create_from(&dir.path().join("factura"), &dest).expect("se copia");
        assert!(dest.is_file());
        let bytes = fs::read(&dest).expect("se lee");
        assert!(bytes.starts_with(b"PK"), "es un zip");
    }

    #[test]
    fn creating_where_there_is_something_already_does_not_touch_it() {
        let dir = templates();
        let target = TempDir::new().expect("carpeta temporal");
        let dest = target.path().join("ocupada");
        fs::create_dir_all(&dest).expect("la carpeta");
        fs::write(dest.join("algo.txt"), "lo que había").expect("algo");

        let error = create_from(&dir.path().join("factura"), &dest).expect_err("ya hay algo");
        assert!(matches!(error, TemplateError::Copy(_)), "{error}");
        assert!(dest.join("algo.txt").is_file(), "sigue estando");
        assert!(!dest.join(DOCUMENT_FILE).exists());
    }

    #[test]
    fn creating_from_something_that_is_not_a_template_says_so() {
        let dir = templates();
        let target = TempDir::new().expect("carpeta temporal");
        let error = create_from(&dir.path().join("nada"), &target.path().join("x"))
            .expect_err("no hay plantilla");
        assert!(matches!(error, TemplateError::Open(_)), "{error}");
    }
}
