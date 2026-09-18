//! Abrir un proyecto.
//!
//! Son dos pasos, dos comandos:
//!
//! 1. [`choose_project_folder`] enseña el diálogo nativo para elegir una
//!    carpeta y devuelve la ruta elegida, o nada si se cancela.
//! 2. [`open_project`] abre esa ruta con [`galera_core::open()`], que lee
//!    `document.json`, lo valida y comprueba fuentes e imágenes, y la deja en
//!    el estado de la app.
//!
//! # Solo carpetas elegidas
//!
//! La interfaz **no tiene ningún permiso de sistema de archivos**: su única
//! capacidad es `core:default` (ver `capabilities/default.json`). Todo lo que
//! se lee del disco lo lee el backend, y lo lee así:
//!
//! - [`open_project`] solo abre una carpeta que quien usa la app haya
//!   elegido en el diálogo nativo. Una ruta cualquiera mandada desde la
//!   interfaz se rechaza con [`CommandError::FolderNotChosen`], aunque sea un
//!   proyecto válido.
//! - Dentro de esa carpeta, `Project` de `galera-core` no deja leer nada que
//!   esté fuera de ella.
//!
//! Así, aunque algo llegara a ejecutar código en el webview, no podría usar
//! la app para leer archivos que nadie ha elegido abrir.
//!
//! # Nota de Tauri
//!
//! Los dos comandos son `async`. Tauri ejecuta los comandos que no lo son en
//! el hilo principal, que es el que pinta la ventana: leer archivos y cargar
//! fuentes ahí la congelaría, y el diálogo, que también necesita el hilo
//! principal, no llegaría a abrirse nunca.

use std::path::{Path, PathBuf};

use galera_core::{Document, Opened};
use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// Un proyecto recién abierto, tal como lo ve la interfaz.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    /// La carpeta del proyecto, con su ruta real.
    pub root: PathBuf,
    /// El documento, ya validado.
    pub document: Document,
    /// La revisión con la que queda abierto. Los resultados de compilación
    /// de revisiones anteriores son de lo que había antes.
    pub revision: u64,
}

/// Enseña el diálogo nativo para elegir la carpeta de un proyecto.
///
/// Devuelve la carpeta elegida, o `None` si se cancela. La carpeta queda
/// anotada como elegida: a partir de ahí, [`open_project`] la puede abrir.
#[tauri::command]
pub async fn choose_project_folder(
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<PathBuf>, CommandError> {
    let chosen = window
        .dialog()
        .file()
        .set_title("Abrir proyecto")
        .set_parent(&window)
        .blocking_pick_folder();

    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let folder = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;

    state.choose_folder(&folder);
    Ok(Some(folder))
}

/// Abre la carpeta de un proyecto elegida antes en el diálogo.
///
/// Devuelve el documento validado y pide compilarlo en segundo plano: el
/// resultado llega con los eventos de [`crate::compile_worker`]. Si falla,
/// devuelve el error serializado y lo que hubiera abierto sigue abierto.
#[tauri::command]
pub async fn open_project(
    path: PathBuf,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<OpenedProject, CommandError> {
    let opened = open_chosen(&state, &path)?;
    queue.request();
    Ok(opened)
}

/// La parte de [`open_project`] que no depende de Tauri, para poder probarla.
fn open_chosen(state: &AppState, folder: &Path) -> Result<OpenedProject, CommandError> {
    if !state.was_chosen(folder) {
        return Err(CommandError::FolderNotChosen {
            path: folder.to_owned(),
        });
    }

    let Opened { project, document } = galera_core::open(folder)?;
    let root = project.root().to_owned();
    let revision = state.open(project, document.clone());
    Ok(OpenedProject {
        root,
        document,
        revision,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use galera_core::GaleraError;
    use serde_json::json;
    use tempfile::TempDir;

    use super::*;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// Un proyecto temporal con ese `document.json`, ya elegido.
    fn chosen_project(state: &AppState, document: &str) -> TempDir {
        let dir = TempDir::new().expect("carpeta temporal");
        fs::write(dir.path().join("document.json"), document).expect("escribir");
        state.choose_folder(dir.path());
        dir
    }

    /// Un documento de una página; con `w` negativo no es válido.
    fn document_json(w: f64) -> String {
        format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Temporal" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": {w}, "h": 10,
                                "fill": "#000000", "stroke": null }}]
              }}]
            }}"##
        )
    }

    /// El criterio de la tarea: abrir `fixtures/` devuelve el documento
    /// validado y lo deja en el estado.
    #[test]
    fn opening_the_fixtures_folder_returns_the_document_and_keeps_it() {
        let state = AppState::default();
        state.choose_folder(&fixtures_dir());

        let opened = open_chosen(&state, &fixtures_dir()).expect("fixtures/ se abre");
        assert_eq!(opened.document.meta.title, "Informe anual 2026");
        assert_eq!(opened.root, fixtures_dir().canonicalize().expect("existe"));

        let summary = state.summary();
        assert_eq!(summary.title.as_deref(), Some("Informe anual 2026"));
        assert_eq!(summary.page_count, opened.document.pages.len());
    }

    /// Una carpeta que no se ha elegido no se abre, aunque sea un proyecto
    /// válido.
    #[test]
    fn a_folder_that_was_not_chosen_is_refused() {
        let state = AppState::default();

        let error = open_chosen(&state, &fixtures_dir()).expect_err("no se ha elegido");
        assert!(
            matches!(error, CommandError::FolderNotChosen { .. }),
            "{error:?}"
        );
        assert_eq!(state.summary().title, None);
    }

    /// Elegir una carpeta no deja abrir otra que esté dentro.
    #[test]
    fn choosing_a_folder_does_not_allow_the_folders_inside() {
        let state = AppState::default();
        let dir = chosen_project(&state, &document_json(10.0));
        let inner = dir.path().join("dentro");
        fs::create_dir(&inner).expect("dentro/");
        fs::write(inner.join("document.json"), document_json(10.0)).expect("escribir");

        assert!(matches!(
            open_chosen(&state, &inner),
            Err(CommandError::FolderNotChosen { .. })
        ));
    }

    /// El criterio de la tarea: un `document.json` inválido devuelve el error
    /// de validación, serializado con sus problemas, y lo que estaba abierto
    /// sigue abierto.
    #[test]
    fn an_invalid_document_returns_the_validation_error_and_keeps_what_was_open() {
        let state = AppState::default();
        let valid = chosen_project(&state, &document_json(10.0));
        open_chosen(&state, valid.path()).expect("el válido se abre");

        let invalid = chosen_project(&state, &document_json(-3.0));
        let error = open_chosen(&state, invalid.path()).expect_err("no es válido");
        assert!(
            matches!(error, CommandError::Core(GaleraError::Invalid(_))),
            "{error:?}"
        );

        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "invalid");
        assert_eq!(json["problems"][0]["problem"]["kind"], "not_positive");

        assert_eq!(state.summary().title.as_deref(), Some("Temporal"));
        assert_eq!(state.summary().revision, 1);
    }

    #[test]
    fn a_chosen_folder_without_document_json_is_an_open_error() {
        let state = AppState::default();
        let dir = TempDir::new().expect("carpeta temporal");
        state.choose_folder(dir.path());

        let error = open_chosen(&state, dir.path()).expect_err("no es un proyecto");
        assert_eq!(
            serde_json::to_value(&error).expect("serializa")["kind"],
            "open"
        );
    }

    /// La interfaz lee `camelCase` y el documento con su forma canónica.
    #[test]
    fn an_opened_project_serializes_with_root_and_document() {
        let state = AppState::default();
        let dir = chosen_project(&state, &document_json(10.0));
        let opened = open_chosen(&state, dir.path()).expect("se abre");

        let json = serde_json::to_value(&opened).expect("serializa");
        assert_eq!(
            json["root"],
            json!(dir.path().canonicalize().expect("existe"))
        );
        assert_eq!(
            json["document"],
            serde_json::to_value(&opened.document).expect("serializa")
        );
        assert_eq!(json["revision"], 1);
        assert_eq!(json.as_object().map(|object| object.len()), Some(3));
    }
}
