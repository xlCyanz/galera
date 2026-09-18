//! Las fuentes del proyecto abierto: con qué estilo nace un texto y añadir
//! una fuente nueva.
//!
//! Las dos decisiones son del núcleo (`galera_core::fonts`); aquí solo se
//! sacan las familias del documento abierto y se abre el diálogo nativo.

use std::path::Path;

use galera_core::{GaleraError, GaleraWorld, TextStyle, default_text_style, import_font};
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::commands::ops::AppliedOp;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// El estilo con el que nace un texto nuevo en el documento abierto, o
/// `null` si el proyecto no tiene ninguna fuente (y no se puede crear).
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si sus fuentes no se pueden cargar.
#[tauri::command]
pub async fn text_defaults(state: State<'_, AppState>) -> Result<Option<TextStyle>, CommandError> {
    text_style_in(&state)
}

fn text_style_in(state: &AppState) -> Result<Option<TextStyle>, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let world =
        GaleraWorld::new(project, &document.fonts, String::new()).map_err(GaleraError::from)?;
    Ok(default_text_style(&document, &world.font_families()))
}

/// Pide un archivo de fuente con el diálogo nativo, lo copia en la carpeta
/// `fonts/` del proyecto y lo añade a las fuentes del documento. Devuelve
/// el documento nuevo, o `null` si se cancela el diálogo.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o
/// [`CommandError::Font`] si el archivo no es una fuente o no se puede
/// copiar.
#[tauri::command]
pub async fn add_font(
    window: Window,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    // Antes de abrir el diálogo: sin proyecto no hay dónde copiarla.
    state.open_document().ok_or(CommandError::NothingOpen)?;
    let Some(chosen) = window
        .dialog()
        .file()
        .set_title("Añadir una fuente al proyecto")
        .add_filter("Fuentes", &["ttf", "otf", "ttc", "otc"])
        .set_parent(&window)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;
    let added = add_font_in(&state, &source)?;
    queue.request();
    Ok(Some(added))
}

/// La parte de [`add_font`] que no depende de Tauri, para poder probarla.
fn add_font_in(state: &AppState, source: &Path) -> Result<AppliedOp, CommandError> {
    let (project, _) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let imported = import_font(&project, source)?;
    Ok(state
        .add_font(&imported.path)
        .ok_or(CommandError::NothingOpen)?
        .into())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use galera_core::{Document, Project};
    use tempfile::TempDir;

    use super::*;

    fn fixture_font(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/fonts")
            .join(name)
    }

    /// Un proyecto sin fuentes, con un documento vacío.
    fn without_fonts() -> (TempDir, AppState) {
        let dir = TempDir::new().expect("carpeta temporal");
        let project = Project::open(dir.path()).expect("es un proyecto");
        let document = Document::from_json_str(
            r#"{ "version": 1, "meta": { "title": "x" }, "pages": [{ "id": "p1",
                 "size": { "width": 100, "height": 100, "unit": "mm" }, "elements": [] }] }"#,
        )
        .expect("es un documento");
        let state = AppState::default();
        state.open(project, document);
        (dir, state)
    }

    #[test]
    fn without_fonts_there_is_no_text_style_until_one_is_added() {
        let (dir, state) = without_fonts();
        assert_eq!(text_style_in(&state).expect("abierto"), None);

        let added = add_font_in(&state, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        assert_eq!(added.revision, 2);
        assert_eq!(
            added.document.fonts,
            vec!["fonts/Inter-Regular.ttf".to_owned()]
        );
        assert!(dir.path().join("fonts/Inter-Regular.ttf").is_file());

        let style = text_style_in(&state)
            .expect("abierto")
            .expect("ya hay fuente");
        assert_eq!(style.font, "Inter");
        assert_eq!(style.size, 12.0);

        // Añadirla otra vez no la duplica ni cambia la revisión.
        let again = add_font_in(&state, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        assert_eq!(again.revision, 2);
        assert_eq!(again.document.fonts.len(), 1);
    }

    #[test]
    fn a_file_that_is_not_a_font_is_a_font_error() {
        let (dir, state) = without_fonts();
        let fake = dir.path().join("falsa.otf");
        fs::write(&fake, b"nada").expect("escribir");
        let error = add_font_in(&state, &fake).expect_err("no es una fuente");
        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "font");
        assert_eq!(state.summary().revision, 1, "no cambia nada");
    }

    #[test]
    fn without_a_document_there_is_nothing_to_do() {
        let state = AppState::default();
        assert!(matches!(
            text_style_in(&state),
            Err(CommandError::NothingOpen)
        ));
        assert!(matches!(
            add_font_in(&state, &fixture_font("Inter-Regular.ttf")),
            Err(CommandError::NothingOpen)
        ));
    }
}
