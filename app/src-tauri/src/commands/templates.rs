//! Las plantillas que trae la aplicación, y empezar un documento con una.
//!
//! Una plantilla es un proyecto con un `template.json` al lado
//! (`galera_core::templates`). Las que vienen con la aplicación van en sus
//! recursos; en desarrollo, en la carpeta `templates/` del repositorio.
//!
//! La vista previa es **la primera página compuesta por Typst**, como todo
//! lo que se ve del documento (principio 2): no hay ninguna imagen guardada
//! que pueda quedarse vieja.

use std::path::PathBuf;

use galera_core::templates::{self, TemplateMeta};
use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::commands::project::OpenedProject;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// La carpeta de plantillas dentro de los recursos de la aplicación.
const TEMPLATES_DIR: &str = "templates";

/// Una plantilla, con lo que hace falta para enseñarla.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCard {
    /// Su carpeta: `informe`.
    pub id: String,
    /// Cómo se llama y de qué es.
    #[serde(flatten)]
    pub meta: TemplateMeta,
    /// Su primera página compuesta, o `null` si no se puede componer.
    pub preview: Option<String>,
    /// Las variables que declara, por su nombre y en orden.
    pub variables: Vec<String>,
}

/// Las plantillas que trae la aplicación, con su vista previa.
#[tauri::command]
pub async fn templates(app: AppHandle) -> Result<Vec<TemplateCard>, CommandError> {
    Ok(cards(&templates_dir(&app)))
}

/// Empieza un documento a partir de una plantilla.
///
/// Pregunta dónde guardarlo, copia la plantilla entera —fuentes y recursos
/// incluidos— y abre lo copiado. El documento nuevo **no queda enlazado** a
/// la plantilla.
///
/// Devuelve `null` si se cancela el diálogo.
///
/// # Errores
///
/// [`CommandError::Core`] si la plantilla no se puede abrir o no se puede
/// escribir donde se pidió.
#[tauri::command]
pub async fn new_from_template(
    id: String,
    archive: bool,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<OpenedProject>, CommandError> {
    let from = templates_dir(&app).join(&id);
    if templates::meta_of(&from).is_none() {
        return Err(CommandError::TemplateNotFound { id });
    }

    let dialog = window.dialog().file().set_parent(&window);
    let chosen = if archive {
        dialog
            .set_title("Nuevo documento desde una plantilla")
            .set_file_name(format!("{id}.{}", galera_core::ARCHIVE_EXTENSION))
            .add_filter("Proyectos de Galera", &[galera_core::ARCHIVE_EXTENSION])
            .blocking_save_file()
    } else {
        dialog
            .set_title("Dónde guardar el documento nuevo")
            .blocking_pick_folder()
    };
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let dest = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;

    let opened = create_in(&state, &from, &dest)?;
    queue.request();
    Ok(Some(opened))
}

/// La parte de [`new_from_template`] que no depende de Tauri.
pub(crate) fn create_in(
    state: &AppState,
    template: &std::path::Path,
    dest: &std::path::Path,
) -> Result<OpenedProject, CommandError> {
    templates::create_from(template, dest)?;
    // Lo acaba de crear quien usa la app: la ruta queda autorizada.
    match galera_core::ProjectFormat::of(dest) {
        galera_core::ProjectFormat::Folder => state.choose_folder(dest),
        galera_core::ProjectFormat::Archive => {
            state.offer_files(std::slice::from_ref(&dest.to_owned()));
        }
    }
    crate::commands::project::open_path(state, dest)
}

/// Dónde están las plantillas: en los recursos de la aplicación y, si no
/// están ahí (en desarrollo), en la carpeta del repositorio.
fn templates_dir(app: &AppHandle) -> PathBuf {
    let bundled = app
        .path()
        .resolve(TEMPLATES_DIR, BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir());
    bundled.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(TEMPLATES_DIR)
    })
}

/// Las plantillas de esa carpeta, con su vista previa compuesta.
fn cards(dir: &std::path::Path) -> Vec<TemplateCard> {
    templates::list(dir)
        .into_iter()
        .map(|template| {
            let opened = templates::open(&template.path).ok();
            let preview = opened.as_ref().and_then(|(project, document)| {
                galera_core::compile_svg(document, project, 0).ok()
            });
            let variables = opened
                .map(|(_, document)| document.variables.keys().cloned().collect())
                .unwrap_or_default();
            TemplateCard {
                id: template.id,
                meta: template.meta,
                preview,
                variables,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    /// La carpeta de plantillas del repositorio, que es la que se usa en
    /// desarrollo.
    fn repo_templates() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../templates")
    }

    /// El criterio de la tarea: la galería enseña la plantilla compuesta.
    #[test]
    fn the_bundled_templates_come_with_their_preview() {
        let found = cards(&repo_templates());

        assert!(!found.is_empty(), "alguna plantilla trae la aplicación");
        let informe = found
            .iter()
            .find(|card| card.id == "informe")
            .expect("la de informe");
        assert_eq!(informe.meta.name, "Informe sencillo");
        let preview = informe.preview.as_deref().expect("se compone");
        assert!(preview.starts_with("<svg"), "{preview:.40}");
        // Y sus variables, que es lo que habrá que rellenar.
        assert_eq!(informe.variables, vec!["asunto", "empresa", "fecha"]);
    }

    /// El criterio de la tarea: crear copia la plantilla entera y lo abierto
    /// no queda enlazado a ella.
    #[test]
    fn creating_from_a_template_opens_a_project_of_its_own() {
        let target = tempfile::TempDir::new().expect("carpeta temporal");
        let dest = target.path().join("Mi informe");
        let state = AppState::default();

        let opened =
            create_in(&state, &repo_templates().join("informe"), &dest).expect("se crea y se abre");

        assert_eq!(opened.document.meta.title, "Mi informe");
        assert!(dest.join("document.json").is_file());
        assert!(
            dest.join("fonts/Inter-Regular.ttf").is_file(),
            "con su fuente"
        );
        assert!(!dest.join("template.json").exists(), "ya no es plantilla");
        // Y el estado apunta a lo nuevo, no a la plantilla.
        let (project, _) = state.open_document().expect("hay documento");
        assert_eq!(project.root().canonicalize().ok(), dest.canonicalize().ok());
    }

    #[test]
    fn a_folder_without_templates_has_nothing_to_show() {
        let empty = tempfile::TempDir::new().expect("carpeta temporal");
        assert!(cards(empty.path()).is_empty());
    }
}
