//! Fuentes del proyecto: el estilo con el que nace un texto y añadir una
//! fuente nueva a la carpeta del proyecto.
//!
//! Las fuentes viajan con el documento (principio 4): un texto solo puede
//! usar una familia que traiga alguna de las fuentes que declara `fonts`.
//! Por eso un texto nuevo no puede inventarse una tipografía: la saca del
//! propio documento, y si el proyecto no tiene ninguna, primero hay que
//! añadirla ([`import_font`]).

use std::fs;
use std::io;
use std::path::Path;

use crate::import::{CopyError, copy_into};
use crate::model::{Align, Document, Element, TextStyle};
use crate::project::Project;
use crate::world::families_in;

/// Carpeta del proyecto donde se copian las fuentes añadidas.
pub const FONTS_DIR: &str = "fonts";

/// Tamaño de un texto nuevo si el documento no tiene ninguno, en puntos.
pub const DEFAULT_TEXT_SIZE: f64 = 12.0;

/// Color de un texto nuevo si el documento no tiene ninguno.
pub const DEFAULT_TEXT_COLOR: &str = "#000000";

/// El estilo con el que nace un texto nuevo en este documento.
///
/// - Si el documento ya tiene textos, el del primero (en orden de páginas y
///   capas) cuya familia está entre `families`: así un texto nuevo se parece
///   a los que ya hay.
/// - Si no, la primera familia de `families`, a [`DEFAULT_TEXT_SIZE`]
///   puntos, en [`DEFAULT_TEXT_COLOR`], alineado a la izquierda.
/// - `None` si `families` está vacío: el proyecto no tiene fuentes y no se
///   puede crear ningún texto.
///
/// `families` son las familias de las fuentes que declara el documento
/// (`GaleraWorld::font_families`).
pub fn default_text_style(document: &Document, families: &[String]) -> Option<TextStyle> {
    let available = |family: &str| {
        families
            .iter()
            .any(|known| known.eq_ignore_ascii_case(family))
    };
    let existing = document
        .pages
        .iter()
        .flat_map(|page| &page.elements)
        .find_map(|element| match element {
            Element::Text { style, .. } if available(&style.font) => Some(style.clone()),
            _ => None,
        });
    existing.or_else(|| {
        families.first().map(|family| TextStyle {
            font: family.clone(),
            size: DEFAULT_TEXT_SIZE,
            color: DEFAULT_TEXT_COLOR.to_owned(),
            align: Align::Left,
            leading: 0.65,
        })
    })
}

/// Una fuente recién añadida a la carpeta del proyecto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedFont {
    /// Su ruta relativa a la raíz del proyecto, para `fonts` del documento.
    pub path: String,
    /// Las familias que trae.
    pub families: Vec<String>,
}

/// Por qué no se pudo añadir una fuente.
#[derive(Debug, thiserror::Error)]
pub enum ImportFontError {
    /// El archivo elegido no se puede leer.
    #[error("no se puede leer {path:?}: {source}")]
    Unreadable {
        /// El archivo elegido.
        path: String,
        /// Por qué.
        source: io::Error,
    },
    /// El archivo no es una fuente que Typst sepa leer.
    #[error("{path:?} no es una fuente que Galera sepa leer (TTF, OTF o una colección TTC)")]
    NotAFont {
        /// El archivo elegido.
        path: String,
    },
    /// La carpeta `fonts/` del proyecto apunta fuera del proyecto.
    #[error("la carpeta {FONTS_DIR}/ del proyecto apunta fuera de él")]
    OutsideProject,
    /// No se pudo copiar en la carpeta del proyecto.
    #[error("no se puede copiar la fuente en {path:?}: {source}")]
    Write {
        /// Dónde se intentó escribir.
        path: String,
        /// Por qué.
        source: io::Error,
    },
}

/// Copia un archivo de fuente en la carpeta `fonts/` del proyecto.
///
/// Comprueba antes que es una fuente de verdad. Conserva el nombre del
/// archivo (con los caracteres raros cambiados por `_`); si ya hay uno con
/// ese nombre y el mismo contenido, lo reutiliza, y si el contenido es otro,
/// añade `-2`, `-3`… No toca el documento: añadir la ruta a `fonts` es cosa
/// de quien llama.
///
/// # Errores
///
/// [`ImportFontError`] si el archivo no se puede leer, no es una fuente o
/// no se puede copiar.
pub fn import_font(project: &Project, source: &Path) -> Result<ImportedFont, ImportFontError> {
    let shown = source.display().to_string();
    let data = fs::read(source).map_err(|error| ImportFontError::Unreadable {
        path: shown.clone(),
        source: error,
    })?;
    let families = families_in(&data);
    if families.is_empty() {
        return Err(ImportFontError::NotAFont { path: shown });
    }
    let path = copy_into(project, FONTS_DIR, source, &data).map_err(|error| match error {
        CopyError::OutsideProject => ImportFontError::OutsideProject,
        CopyError::Write { path, source } => ImportFontError::Write { path, source },
    })?;
    Ok(ImportedFont { path, families })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::*;

    fn fixture_font(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/fonts")
            .join(name)
    }

    fn document(elements: &str) -> Document {
        Document::from_json_str(&format!(
            r##"{{ "version": 1, "meta": {{ "title": "x" }}, "pages": [{{ "id": "p1",
                 "size": {{ "width": 100, "height": 100, "unit": "mm" }}, "elements": [{elements}] }}] }}"##
        ))
        .expect("es un documento")
    }

    fn project() -> (TempDir, Project) {
        let dir = TempDir::new().expect("carpeta temporal");
        let project = Project::open(dir.path()).expect("es un proyecto");
        (dir, project)
    }

    #[test]
    fn a_new_text_looks_like_the_first_one_already_there() {
        let document = document(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "fill": null, "stroke": null },
                { "id": "t1", "type": "text", "x": 0, "y": 0, "w": 50, "h": null, "content": [],
                  "style": { "font": "Inter", "size": 18, "color": "#336699", "align": "center", "leading": 0.8 } }"##,
        );
        let style = default_text_style(&document, &["Libertinus Serif".into(), "Inter".into()])
            .expect("hay fuentes");
        assert_eq!(style.font, "Inter");
        assert_eq!(style.size, 18.0);
        assert_eq!(style.color, "#336699");
        assert_eq!(style.align, Align::Center);
    }

    #[test]
    fn without_texts_it_uses_the_first_family_at_twelve_points() {
        let style = default_text_style(&document(""), &["Inter".into(), "Otra".into()])
            .expect("hay fuentes");
        assert_eq!(
            style,
            TextStyle {
                font: "Inter".into(),
                size: DEFAULT_TEXT_SIZE,
                color: DEFAULT_TEXT_COLOR.into(),
                align: Align::Left,
                leading: 0.65,
            }
        );
    }

    #[test]
    fn a_text_with_a_missing_family_is_not_copied() {
        let document = document(
            r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 50, "h": null, "content": [],
                  "style": { "font": "Comic Sans", "size": 30, "color": "#000000" } }"##,
        );
        let style = default_text_style(&document, &["Inter".into()]).expect("hay fuentes");
        assert_eq!(
            (style.font.as_str(), style.size),
            ("Inter", DEFAULT_TEXT_SIZE)
        );
    }

    #[test]
    fn without_fonts_there_is_no_text_style() {
        assert_eq!(default_text_style(&document(""), &[]), None);
    }

    #[test]
    fn a_font_is_copied_into_the_fonts_folder() {
        let (dir, project) = project();
        let imported = import_font(&project, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        assert_eq!(imported.path, "fonts/Inter-Regular.ttf");
        assert_eq!(imported.families, vec!["Inter".to_owned()]);
        assert_eq!(
            fs::read(dir.path().join("fonts/Inter-Regular.ttf")).expect("copiada"),
            fs::read(fixture_font("Inter-Regular.ttf")).expect("original")
        );
    }

    #[test]
    fn the_same_font_twice_is_reused_and_another_with_the_same_name_is_renamed() {
        let (dir, project) = project();
        let first = import_font(&project, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        let again = import_font(&project, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        assert_eq!(first, again);

        // Otra fuente con el mismo nombre de archivo.
        let other_dir = TempDir::new().expect("carpeta temporal");
        let other = other_dir.path().join("Inter-Regular.ttf");
        fs::copy(fixture_font("Inter-Bold.ttf"), &other).expect("copiar");
        let renamed = import_font(&project, &other).expect("se añade");
        assert_eq!(renamed.path, "fonts/Inter-Regular-2.ttf");
        assert!(dir.path().join("fonts/Inter-Regular-2.ttf").is_file());
    }

    #[test]
    fn a_file_that_is_not_a_font_is_rejected_and_nothing_is_copied() {
        let (dir, project) = project();
        let fake = dir.path().join("falsa.ttf");
        fs::write(&fake, b"no soy una fuente").expect("escribir");
        assert!(matches!(
            import_font(&project, &fake),
            Err(ImportFontError::NotAFont { .. })
        ));
        assert!(!dir.path().join("fonts").exists());
        assert!(matches!(
            import_font(&project, &dir.path().join("no-existe.ttf")),
            Err(ImportFontError::Unreadable { .. })
        ));
    }

    #[test]
    fn odd_characters_in_the_name_are_replaced() {
        let (_dir, project) = project();
        let other_dir = TempDir::new().expect("carpeta temporal");
        let odd = other_dir.path().join("Mi fuente (2).TTF");
        fs::copy(fixture_font("Inter-Regular.ttf"), &odd).expect("copiar");
        let imported = import_font(&project, &odd).expect("se añade");
        assert_eq!(imported.path, "fonts/Mi_fuente__2_.ttf");
    }
}
