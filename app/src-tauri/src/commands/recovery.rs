//! Recuperar lo que no llegó a guardarse.
//!
//! Si la app se cerró de golpe, en la carpeta de datos puede quedar una
//! copia de autoguardado más nueva que lo guardado en el proyecto (ver
//! [`crate::autosave`]). Al arrancar, la interfaz pregunta por ellas con
//! [`pending_recoveries`] y ofrece abrirlas ([`recover`]) o tirarlas
//! ([`discard_recovery`]).
//!
//! Recuperar abre el proyecto como siempre y le pone encima el documento de
//! la copia, sin guardarlo: queda como cambios sin guardar, para decidir.
//!
//! Solo se puede recuperar lo que está en la lista, que sale de las copias
//! que escribió la propia app: la interfaz no puede pedir abrir cualquier
//! ruta por aquí.

use std::path::PathBuf;

use tauri::State;

use crate::autosave::{self, Recovery};
use crate::commands::CommandError;
use crate::commands::project::{OpenedProject, open_path};
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// La carpeta donde se escriben las copias de autoguardado.
pub struct AutosaveDir(pub PathBuf);

/// Las copias que se pueden recuperar, de la más nueva a la más vieja.
///
/// Por el camino tira las que ya no valen: las de proyectos que se
/// guardaron después.
#[tauri::command]
pub async fn pending_recoveries(
    dir: State<'_, AutosaveDir>,
) -> Result<Vec<Recovery>, CommandError> {
    Ok(autosave::pending(&dir.0))
}

/// Abre un proyecto con el documento de su copia de autoguardado.
///
/// Queda con cambios sin guardar: recuperar no guarda nada.
///
/// # Errores
///
/// [`CommandError::FolderNotChosen`] si esa copia no está entre las
/// pendientes, o el error de abrir el proyecto.
#[tauri::command]
pub async fn recover(
    target: PathBuf,
    state: State<'_, AppState>,
    dir: State<'_, AutosaveDir>,
    queue: State<'_, CompileQueue>,
) -> Result<OpenedProject, CommandError> {
    let opened = recover_in(&state, &dir.0, &target)?;
    queue.request();
    Ok(opened)
}

/// La parte de [`recover`] que no depende de Tauri, para poder probarla.
fn recover_in(
    state: &AppState,
    dir: &std::path::Path,
    target: &std::path::Path,
) -> Result<OpenedProject, CommandError> {
    let offered = autosave::pending(dir)
        .into_iter()
        .any(|pending| pending.target == target);
    let Some(copy) = autosave::read(dir, target).filter(|_| offered) else {
        return Err(CommandError::FolderNotChosen {
            path: target.to_owned(),
        });
    };

    let opened = open_path(state, target)?;
    let recovered = state
        .restore(copy.document)
        .ok_or(CommandError::NothingOpen)?;
    // La copia ya está en el documento abierto: si se cierra otra vez de
    // golpe, el autoguardado escribirá una nueva.
    autosave::discard(dir, target);
    Ok(OpenedProject {
        root: opened.root,
        document: recovered.1,
        revision: recovered.0,
        archive: opened.archive,
    })
}

/// Tira la copia de un proyecto: se decide seguir con lo guardado.
#[tauri::command]
pub async fn discard_recovery(
    target: PathBuf,
    dir: State<'_, AutosaveDir>,
) -> Result<(), CommandError> {
    autosave::discard(&dir.0, &target);
    Ok(())
}

/// Cierra la ventana de verdad, después de que la interfaz haya preguntado
/// qué hacer con los cambios sin guardar (ver `lib.rs`).
///
/// # Errores
///
/// Si la ventana no se puede cerrar.
#[tauri::command]
pub async fn close_window(window: tauri::Window) -> Result<(), CommandError> {
    window.destroy().map_err(|error| CommandError::Write {
        path: PathBuf::from("ventana"),
        source: std::io::Error::other(error.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use galera_core::{Document, Op, Project};
    use tempfile::TempDir;

    use super::*;
    use crate::autosave::Autosave;

    fn document(x: f64) -> Document {
        Document::from_json_str(&format!(
            r##"{{ "version": 1, "meta": {{ "title": "Informe" }}, "pages": [{{ "id": "p1",
                 "size": {{ "width": 100, "height": 100, "unit": "mm" }}, "elements": [
                   {{ "id": "r1", "type": "rect", "x": {x}, "y": 0, "w": 10, "h": 10, "fill": null, "stroke": null }}
                 ] }}] }}"##
        ))
        .expect("es un documento")
    }

    /// Un proyecto guardado en disco, con una copia de autoguardado más
    /// nueva que lo guardado.
    fn with_copy(copies: &Path) -> (TempDir, PathBuf) {
        let project = TempDir::new().expect("carpeta temporal");
        galera_core::save_document(project.path(), &document(0.0)).expect("se guarda");
        let target = project.path().canonicalize().expect("existe");
        autosave::write(
            copies,
            &Autosave {
                target: target.clone(),
                root: target.clone(),
                saved_at: u64::MAX,
                document: document(42.0),
            },
        )
        .expect("se escribe");
        (project, target)
    }

    #[test]
    fn a_copy_is_offered_recovered_as_unsaved_changes_and_then_gone() {
        let copies = TempDir::new().expect("carpeta temporal");
        let state = AppState::default();
        let (_project, target) = with_copy(copies.path());

        let offered = autosave::pending(copies.path());
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].target, target);

        let opened = recover_in(&state, copies.path(), &target).expect("se recupera");
        assert_eq!(opened.root, target);
        let recovered = opened
            .document
            .element("r1")
            .and_then(|e| e.base())
            .expect("caja");
        assert_eq!(recovered.x, 42.0, "el documento es el de la copia");
        assert!(state.summary().dirty, "queda por guardar");
        assert!(
            autosave::pending(copies.path()).is_empty(),
            "la copia ya no se ofrece"
        );

        // Lo guardado en el proyecto no se ha tocado.
        let saved = fs::read_to_string(target.join("document.json")).expect("guardado");
        let saved = Document::from_json_str(&saved).expect("es un documento");
        assert_eq!(
            saved.element("r1").and_then(|e| e.base()).expect("caja").x,
            0.0
        );
    }

    #[test]
    fn what_is_not_offered_cannot_be_recovered() {
        let copies = TempDir::new().expect("carpeta temporal");
        let state = AppState::default();
        let dir = TempDir::new().expect("carpeta temporal");
        galera_core::save_document(dir.path(), &document(0.0)).expect("se guarda");

        // Sin copia, no se abre nada por aquí.
        assert!(matches!(
            recover_in(&state, copies.path(), dir.path()),
            Err(CommandError::FolderNotChosen { .. })
        ));
        assert!(state.summary().root.is_none());
    }

    #[test]
    fn discarding_a_copy_leaves_the_saved_project_alone() {
        let copies = TempDir::new().expect("carpeta temporal");
        let (_project, target) = with_copy(copies.path());
        autosave::discard(copies.path(), &target);
        assert!(autosave::pending(copies.path()).is_empty());
        assert!(target.join("document.json").is_file());
    }

    #[test]
    fn saving_the_project_takes_its_copy_out_of_the_way() {
        let copies = TempDir::new().expect("carpeta temporal");
        let state = AppState::default();
        let (project, target) = with_copy(copies.path());
        let opened = Project::open(project.path()).expect("es un proyecto");
        state.open(opened, document(0.0));
        state
            .apply(
                &Op::Move {
                    id: "r1".to_owned(),
                    dx: 1.0,
                    dy: 0.0,
                },
                None,
            )
            .expect("abierto")
            .expect("se aplica");

        autosave::save_now(&state, copies.path()).expect("hay cambios");
        assert!(autosave::read(copies.path(), &target).is_some());

        crate::commands::project::save_in(&state, copies.path()).expect("se guarda");
        assert!(
            autosave::read(copies.path(), &target).is_none(),
            "guardar tira la copia"
        );
    }
}
