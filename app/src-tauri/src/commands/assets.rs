//! Añadir imágenes al proyecto abierto: soltándolas sobre la ventana o
//! eligiéndolas en el diálogo nativo.
//!
//! Cada imagen se copia en `assets/` del proyecto y se registra en el mapa
//! `assets` del documento (`galera_core::assets`). Crear los elementos es
//! cosa de la interfaz, con `Op::Create`, en el punto donde se soltaron.
//!
//! # Solo lo que se ofrece
//!
//! La interfaz no puede pedir que se copie cualquier archivo del disco:
//! solo los que se han soltado sobre la ventana (lo anota el propio backend
//! al recibir el evento, ver `lib.rs`) o se han elegido en el diálogo. Es la
//! misma idea que con las carpetas de `commands::project`.

use std::path::{Path, PathBuf};

use galera_core::import_image;
use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::commands::ops::AppliedOp;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// Una imagen ya en el proyecto.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
    /// Su clave en `assets`, para el elemento.
    pub key: String,
    /// Su ruta dentro del proyecto.
    pub path: String,
}

/// Un archivo que no se pudo añadir, y por qué.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedFile {
    /// El archivo, como se soltó o eligió.
    pub file: PathBuf,
    /// Por qué, para enseñarlo.
    pub message: String,
}

/// El resultado de añadir varias imágenes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedImages {
    /// El documento con las imágenes registradas, o `null` si no se añadió
    /// ninguna.
    pub applied: Option<AppliedOp>,
    /// Las imágenes añadidas, en el orden en que llegaron.
    pub images: Vec<ImageAsset>,
    /// Las que no, con su motivo.
    pub rejected: Vec<RejectedFile>,
}

/// Añade al proyecto las imágenes soltadas sobre la ventana.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento. Un archivo que no se
/// puede añadir no es un error del comando: va en `rejected`.
#[tauri::command]
pub async fn import_images(
    paths: Vec<PathBuf>,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<ImportedImages, CommandError> {
    let imported = import_in(&state, &paths)?;
    if imported.applied.is_some() {
        queue.request();
    }
    Ok(imported)
}

/// Pide imágenes con el diálogo nativo (se pueden elegir varias) y las
/// añade al proyecto. Si se cancela, no añade ninguna.
///
/// # Errores
///
/// Como [`import_images`].
#[tauri::command]
pub async fn choose_images(
    window: Window,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<ImportedImages, CommandError> {
    let root = state
        .open_document()
        .ok_or(CommandError::NothingOpen)?
        .0
        .root()
        .to_path_buf();
    let chosen = window
        .dialog()
        .file()
        .set_title("Insertar imágenes")
        .add_filter("Imágenes", &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .set_directory(root)
        .set_parent(&window)
        .blocking_pick_files()
        .unwrap_or_default();
    let paths: Vec<PathBuf> = chosen
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect();
    state.offer_files(&paths);
    import_images(paths, state, queue).await
}

/// La parte de [`import_images`] que no depende de Tauri, para poder
/// probarla.
fn import_in(state: &AppState, paths: &[PathBuf]) -> Result<ImportedImages, CommandError> {
    let (project, mut document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let mut images = Vec::new();
    let mut rejected = Vec::new();

    for path in paths {
        if !state.was_offered(path) {
            rejected.push(RejectedFile {
                file: path.clone(),
                message: format!(
                    "{} no se ha soltado sobre la ventana ni elegido en el diálogo",
                    shown(path)
                ),
            });
            continue;
        }
        match import_image(&project, &document, path) {
            Ok(image) => {
                // Las siguientes del mismo lote ya ven esta clave.
                document
                    .assets
                    .insert(image.key.clone(), image.path.clone());
                images.push(ImageAsset {
                    key: image.key,
                    path: image.path,
                });
            }
            Err(error) => rejected.push(RejectedFile {
                file: path.clone(),
                message: error.to_string(),
            }),
        }
    }

    let applied = if images.is_empty() {
        None
    } else {
        let assets: Vec<(String, String)> = images
            .iter()
            .map(|image| (image.key.clone(), image.path.clone()))
            .collect();
        Some(
            state
                .add_assets(&assets)
                .ok_or(CommandError::NothingOpen)?
                .into(),
        )
    };
    Ok(ImportedImages {
        applied,
        images,
        rejected,
    })
}

fn shown(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use galera_core::{Document, Project};
    use tempfile::TempDir;

    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/assets")
            .join(name)
    }

    fn opened() -> (TempDir, AppState) {
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
    fn several_offered_images_are_copied_and_registered_at_once() {
        let (dir, state) = opened();
        let files = [
            fixture("logo.png"),
            fixture("pixel.jpg"),
            fixture("pixel.svg"),
        ];
        state.offer_files(&files);

        let imported = import_in(&state, &files).expect("abierto");
        assert!(imported.rejected.is_empty(), "{:?}", imported.rejected);
        let keys: Vec<&str> = imported.images.iter().map(|i| i.key.as_str()).collect();
        assert_eq!(keys, ["logo", "pixel", "pixel-2"]);
        let applied = imported.applied.expect("hay imágenes");
        assert_eq!(applied.revision, 2, "un solo cambio para todas");
        assert_eq!(applied.document.assets.len(), 3);
        assert_eq!(applied.document.assets["pixel-2"], "assets/pixel.svg");
        assert!(dir.path().join("assets/pixel.svg").is_file());
    }

    #[test]
    fn a_file_that_was_not_offered_is_not_read() {
        let (dir, state) = opened();
        let imported = import_in(&state, &[fixture("logo.png")]).expect("abierto");
        assert!(imported.images.is_empty());
        assert!(imported.applied.is_none());
        assert!(imported.rejected[0].message.contains("no se ha soltado"));
        assert!(!dir.path().join("assets").exists());
        assert_eq!(state.summary().revision, 1);
    }

    #[test]
    fn an_unsupported_file_is_rejected_and_the_rest_are_added() {
        let (dir, state) = opened();
        let pdf = dir.path().join("informe.pdf");
        fs::write(&pdf, b"%PDF-1.7").expect("escribir");
        let files = [pdf, fixture("logo.png")];
        state.offer_files(&files);

        let imported = import_in(&state, &files).expect("abierto");
        assert_eq!(imported.images.len(), 1);
        assert_eq!(imported.rejected.len(), 1);
        assert!(
            imported.rejected[0]
                .message
                .starts_with("informe.pdf no es una imagen")
        );
    }

    #[test]
    fn without_a_document_there_is_nothing_to_do() {
        assert!(matches!(
            import_in(&AppState::default(), &[]),
            Err(CommandError::NothingOpen)
        ));
    }
}
