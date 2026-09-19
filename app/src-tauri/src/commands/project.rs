//! Abrir y guardar un proyecto, como carpeta o como archivo `.galera`.
//!
//! Los dos formatos llevan lo mismo (`galera_core::archive`): abrir un
//! `.galera` lo extrae en una carpeta de trabajo temporal y guardar lo
//! vuelve a empaquetar encima, así que se edita igual en los dos casos.
//!
//! Abrir son dos pasos, dos comandos:
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
use std::time::{SystemTime, UNIX_EPOCH};

use galera_core::{
    ARCHIVE_EXTENSION, Document, Opened, Project, ProjectFormat, pack, save_as_folder,
    save_document, unpack,
};
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
    /// El `.galera` del que sale y al que se guarda, o `null` si es una
    /// carpeta.
    pub archive: Option<PathBuf>,
}

/// Un proyecto recién guardado.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedProject {
    /// Dónde se ha guardado: la carpeta o el `.galera`.
    pub path: PathBuf,
    /// La carpeta de trabajo del proyecto.
    pub root: PathBuf,
    /// El `.galera` al que se guarda de ahora en adelante, si lo hay.
    pub archive: Option<PathBuf>,
    /// La revisión guardada: a partir de ella se sabe si hay cambios.
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

/// Enseña el diálogo nativo para elegir un archivo `.galera`.
///
/// Devuelve el elegido, o `None` si se cancela. Queda anotado como
/// ofrecido, igual que las carpetas: a partir de ahí [`open_project`] lo
/// puede abrir.
#[tauri::command]
pub async fn choose_project_file(
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<PathBuf>, CommandError> {
    let chosen = window
        .dialog()
        .file()
        .set_title("Abrir un proyecto .galera")
        .add_filter("Proyectos de Galera", &[ARCHIVE_EXTENSION])
        .set_parent(&window)
        .blocking_pick_file();

    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let file = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;
    state.offer_files(std::slice::from_ref(&file));
    Ok(Some(file))
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
///
/// Con un `.galera`, lo extrae antes en una carpeta de trabajo.
fn open_chosen(state: &AppState, path: &Path) -> Result<OpenedProject, CommandError> {
    let (folder, archive) = match ProjectFormat::of(path) {
        ProjectFormat::Folder => {
            if !state.was_chosen(path) {
                return Err(CommandError::FolderNotChosen {
                    path: path.to_owned(),
                });
            }
            (path.to_owned(), None)
        }
        ProjectFormat::Archive => {
            if !state.was_offered(path) {
                return Err(CommandError::FolderNotChosen {
                    path: path.to_owned(),
                });
            }
            let work = work_folder(path);
            unpack(path, &work)?;
            (work, Some(path.to_owned()))
        }
    };

    let Opened { project, document } = galera_core::open(&folder)?;
    let root = project.root().to_owned();
    let revision = state.open_from(project, document.clone(), archive.clone());
    Ok(OpenedProject {
        root,
        document,
        revision,
        archive,
    })
}

/// Dónde se extrae un `.galera` para trabajar con él: una carpeta nueva en
/// la temporal del sistema, con el nombre del archivo.
fn work_folder(archive: &Path) -> PathBuf {
    let name = archive
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "proyecto".to_owned());
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir()
        .join("galera")
        .join(format!("{name}-{unique}"))
}

/// Guarda el proyecto abierto donde ya estaba: el `document.json` de su
/// carpeta y, si vino de un `.galera`, también el archivo.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay proyecto, o el error de escribir.
#[tauri::command]
pub async fn save_project(state: State<'_, AppState>) -> Result<SavedProject, CommandError> {
    save_in(&state)
}

fn save_in(state: &AppState) -> Result<SavedProject, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let archive = state.archive();
    save_document(project.root(), &document)?;
    if let Some(path) = &archive {
        pack(&project, &document, path)?;
    }
    let revision = state.mark_saved().ok_or(CommandError::NothingOpen)?;
    Ok(SavedProject {
        path: archive.clone().unwrap_or_else(|| project.root().to_owned()),
        root: project.root().to_owned(),
        archive,
        revision,
    })
}

/// Guarda el proyecto abierto en otro sitio, y a partir de ahí guarda ahí:
/// en una carpeta vacía (`archive: false`) o en un `.galera`
/// (`archive: true`), eligiéndolo en el diálogo nativo.
///
/// Devuelve `None` si se cancela el diálogo.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay proyecto; el error del núcleo si
/// la carpeta elegida tiene algo dentro o no se puede escribir.
#[tauri::command]
pub async fn save_project_as(
    archive: bool,
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<SavedProject>, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let title = document.meta.title.clone();
    let dialog = window.dialog().file().set_parent(&window);

    let chosen = if archive {
        dialog
            .set_title("Guardar como archivo .galera")
            .set_file_name(format!("{title}.{ARCHIVE_EXTENSION}"))
            .add_filter("Proyectos de Galera", &[ARCHIVE_EXTENSION])
            .blocking_save_file()
    } else {
        dialog
            .set_title("Guardar como carpeta")
            .blocking_pick_folder()
    };
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;

    if archive {
        pack(&project, &document, &path)?;
        let revision = state
            .save_to(project.clone(), Some(path.clone()))
            .ok_or(CommandError::NothingOpen)?;
        Ok(Some(SavedProject {
            path: path.clone(),
            root: project.root().to_owned(),
            archive: Some(path),
            revision,
        }))
    } else {
        save_as_folder(&project, &document, &path)?;
        let moved = Project::open(&path).map_err(galera_core::GaleraError::from)?;
        let root = moved.root().to_owned();
        let revision = state
            .save_to(moved, None)
            .ok_or(CommandError::NothingOpen)?;
        Ok(Some(SavedProject {
            path: root.clone(),
            root,
            archive: None,
            revision,
        }))
    }
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
        assert!(json["archive"].is_null(), "una carpeta no tiene archivo");
        assert_eq!(json.as_object().map(|object| object.len()), Some(4));
    }

    /// Un `.galera` se extrae, se abre y se vuelve a guardar encima.
    #[test]
    fn an_archive_is_opened_from_its_own_copy_and_saved_back_into_it() {
        let state = AppState::default();
        let dir = chosen_project(&state, &document_json(10.0));
        let opened = open_chosen(&state, dir.path()).expect("se abre");

        // Se guarda como `.galera` y se cierra.
        let archive = dir.path().join("informe.galera");
        galera_core::pack(
            &galera_core::Project::open(dir.path()).expect("es un proyecto"),
            &opened.document,
            &archive,
        )
        .expect("se empaqueta");
        state.close();

        // Sin haberlo elegido, no se abre.
        assert!(matches!(
            open_chosen(&state, &archive),
            Err(CommandError::FolderNotChosen { .. })
        ));

        state.offer_files(std::slice::from_ref(&archive));
        let from_archive = open_chosen(&state, &archive).expect("se abre");
        assert_eq!(from_archive.archive.as_deref(), Some(archive.as_path()));
        assert_eq!(from_archive.document, opened.document);
        assert_ne!(from_archive.root, dir.path(), "se trabaja en una copia");
        assert!(from_archive.root.join("document.json").is_file());

        // Un cambio y guardar: se reescribe el `.galera`, no el original.
        let before = fs::metadata(&archive).expect("existe").len();
        state
            .apply(
                &galera_core::Op::Move {
                    id: "r1".to_owned(),
                    dx: 5.0,
                    dy: 0.0,
                },
                None,
            )
            .expect("abierto")
            .expect("se aplica");
        assert!(state.summary().dirty);

        let saved = save_in(&state).expect("se guarda");
        assert_eq!(saved.path, archive);
        assert!(!state.summary().dirty);
        assert!(fs::metadata(&archive).expect("existe").len() > 0);
        assert!(before > 0);

        // Y lo guardado se vuelve a abrir con el cambio dentro.
        let work = from_archive.root.clone();
        state.close();
        state.offer_files(std::slice::from_ref(&archive));
        let again = open_chosen(&state, &archive).expect("se abre");
        assert_ne!(again.root, work, "cada apertura trabaja en su copia");
        let moved = again
            .document
            .element("r1")
            .and_then(|e| e.base())
            .expect("caja");
        assert_eq!(moved.x, 5.0);
    }

    #[test]
    fn a_damaged_archive_is_an_archive_error() {
        let state = AppState::default();
        let dir = TempDir::new().expect("carpeta temporal");
        let broken = dir.path().join("roto.galera");
        fs::write(&broken, b"esto no es un zip").expect("escribir");
        state.offer_files(std::slice::from_ref(&broken));

        let error = open_chosen(&state, &broken).expect_err("no es un zip");
        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "archive");
        assert!(state.summary().root.is_none(), "no abre nada");
    }

    #[test]
    fn saving_without_a_project_says_so() {
        assert!(matches!(
            save_in(&AppState::default()),
            Err(CommandError::NothingOpen)
        ));
    }
}
