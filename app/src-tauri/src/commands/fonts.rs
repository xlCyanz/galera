//! Las fuentes del proyecto abierto: con qué estilo nace un texto, cuáles
//! hay (para el panel de fuentes y el selector del inspector), su muestra,
//! añadir una nueva y quitar una que no necesita nadie.
//!
//! Las decisiones son del núcleo (`galera_core::fonts`); aquí solo se leen
//! las fuentes del documento abierto y se abre el diálogo nativo. Nunca se
//! listan las fuentes del sistema: las que valen son las que viajan con el
//! documento (principio 4).

use std::path::Path;

use galera_core::world::families_in;
use galera_core::{
    GaleraError, GaleraWorld, Op, TextStyle, compile_svg, default_text_style, font_users,
    import_font, sample_document,
};
use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::commands::ops::AppliedOp;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// Una fuente que declara el documento, para el panel de fuentes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInfo {
    /// Su ruta, tal como está en `fonts`.
    pub path: String,
    /// Las familias que trae; vacío si el archivo no está o no es una fuente.
    pub families: Vec<String>,
    /// Cuánto ocupa, en bytes, o `null` si no está.
    pub bytes: Option<u64>,
    /// Los textos que se quedarían sin tipografía si se quitara.
    pub users: Vec<String>,
}

/// Las fuentes que declara el documento abierto, en su orden.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn list_fonts(state: State<'_, AppState>) -> Result<Vec<FontInfo>, CommandError> {
    list_in(&state)
}

fn list_in(state: &AppState) -> Result<Vec<FontInfo>, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let read: Vec<(String, Option<Vec<u8>>)> = document
        .fonts
        .iter()
        .map(|path| (path.clone(), project.read(path).ok()))
        .collect();
    let families: Vec<Vec<String>> = read
        .iter()
        .map(|(_, data)| data.as_deref().map(families_in).unwrap_or_default())
        .collect();
    Ok(read
        .iter()
        .enumerate()
        .map(|(index, (path, data))| {
            let others: Vec<String> = families
                .iter()
                .enumerate()
                .filter(|(other, _)| *other != index)
                .flat_map(|(_, list)| list.iter().cloned())
                .collect();
            FontInfo {
                path: path.clone(),
                families: families[index].clone(),
                bytes: data.as_ref().map(|data| data.len() as u64),
                users: font_users(&document, &families[index], &others),
            }
        })
        .collect())
}

/// Las familias de las fuentes del documento abierto: las únicas que puede
/// usar un texto. Es lo que ofrece el selector del inspector.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si sus fuentes no se pueden cargar.
#[tauri::command]
pub async fn font_families(state: State<'_, AppState>) -> Result<Vec<String>, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let world =
        GaleraWorld::new(project, &document.fonts, String::new()).map_err(GaleraError::from)?;
    let mut families = world.font_families();
    families.sort_by_key(|family| family.to_lowercase());
    Ok(families)
}

/// Una muestra de la fuente `path`, en SVG, dibujada por Typst con ese
/// mismo archivo.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento; el error del núcleo
/// si no es una fuente o no compila.
#[tauri::command]
pub async fn font_sample(path: String, state: State<'_, AppState>) -> Result<String, CommandError> {
    sample_in(&state, &path)
}

fn sample_in(state: &AppState, path: &str) -> Result<String, CommandError> {
    let (project, _) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let family = project
        .read(path)
        .ok()
        .and_then(|data| families_in(&data).into_iter().next())
        .ok_or_else(|| {
            CommandError::Font(galera_core::ImportFontError::NotAFont {
                path: path.to_owned(),
            })
        })?;
    Ok(compile_svg(&sample_document(path, &family), &project, 0)?)
}

/// Deja de declarar la fuente `path`, si ningún texto la necesita. Es un
/// comando más: entra en el historial. El archivo se queda en el proyecto.
///
/// # Errores
///
/// [`CommandError::FontInUse`] con los textos que la usan, y entonces no
/// cambia nada; [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn remove_font(
    path: String,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<AppliedOp, CommandError> {
    let removed = remove_in(&state, &path)?;
    queue.request();
    Ok(removed)
}

fn remove_in(state: &AppState, path: &str) -> Result<AppliedOp, CommandError> {
    let listed = list_in(state)?;
    if let Some(font) = listed.iter().find(|font| font.path == path)
        && !font.users.is_empty()
    {
        return Err(CommandError::FontInUse {
            path: path.to_owned(),
            users: font.users.clone(),
        });
    }
    let op = Op::RemoveFont {
        path: path.to_owned(),
    };
    Ok(state
        .apply(&op, None)
        .ok_or(CommandError::NothingOpen)??
        .into())
}

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
    // La fuente acaba de aparecer en la carpeta: lo que el compilador
    // hubiera leído de ahí ya no vale.
    state.forget_project_files();
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

    /// Un proyecto con Inter declarada y un texto que la usa.
    fn with_inter() -> (TempDir, AppState) {
        let (dir, state) = without_fonts();
        add_font_in(&state, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        let (_, mut document) = state.open_document().expect("abierto");
        document.pages[0].elements.push(
            serde_json::from_value(serde_json::json!({
                "id": "t1", "type": "text", "x": 0, "y": 0, "w": 50, "h": null,
                "content": [], "style": { "font": "Inter", "size": 12, "color": "#000000" }
            }))
            .expect("es un elemento"),
        );
        let (project, _) = state.open_document().expect("abierto");
        state.open(project, document);
        (dir, state)
    }

    #[test]
    fn the_panel_lists_fonts_with_families_size_and_users() {
        let (_dir, state) = with_inter();
        let listed = list_in(&state).expect("abierto");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "fonts/Inter-Regular.ttf");
        assert_eq!(listed[0].families, ["Inter"]);
        assert!(listed[0].bytes.is_some_and(|bytes| bytes > 0));
        assert_eq!(listed[0].users, ["t1"]);
    }

    #[test]
    fn the_sample_is_an_svg_drawn_with_the_font() {
        let (_dir, state) = with_inter();
        let svg = sample_in(&state, "fonts/Inter-Regular.ttf").expect("compila");
        assert!(svg.starts_with("<svg"));
        assert!(matches!(
            sample_in(&state, "fonts/no-esta.ttf"),
            Err(CommandError::Font(_))
        ));
    }

    #[test]
    fn a_font_in_use_is_not_removed_and_says_who_uses_it() {
        let (_dir, state) = with_inter();
        let error = remove_in(&state, "fonts/Inter-Regular.ttf").expect_err("t1 la usa");
        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "font_in_use");
        assert_eq!(
            json["message"],
            "la fuente fonts/Inter-Regular.ttf la usa t1: cambia su tipografía antes de quitarla"
        );
        assert_eq!(state.open_document().expect("abierto").1.fonts.len(), 1);
    }

    #[test]
    fn an_unused_font_is_removed_and_the_removal_undoes() {
        let (_dir, state) = without_fonts();
        add_font_in(&state, &fixture_font("Inter-Regular.ttf")).expect("se añade");
        let removed = remove_in(&state, "fonts/Inter-Regular.ttf").expect("nadie la usa");
        assert!(removed.document.fonts.is_empty());
        assert_eq!(
            removed.undo.as_deref(),
            Some("Quitar la fuente Inter-Regular.ttf")
        );
        let undone = state
            .undo()
            .expect("abierto")
            .expect("hay")
            .expect("se aplica");
        assert_eq!(undone.document.fonts, ["fonts/Inter-Regular.ttf"]);
    }
}
