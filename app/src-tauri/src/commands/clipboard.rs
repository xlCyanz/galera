//! Copiar, cortar, pegar y duplicar elementos.
//!
//! Lo copiado vive **en la aplicación**, no en el portapapeles del sistema:
//! así los elementos viajan enteros de un documento a otro, con los recursos
//! y las fuentes que necesitan (`galera_core::clipboard`). Al portapapeles
//! del sistema va solo el **texto plano** de lo copiado, que es lo que tiene
//! sentido pegar fuera; lo escribe la interfaz, que es quien puede hacerlo
//! con el gesto de la persona.
//!
//! Qué se copia, qué ids le tocan a lo pegado y dónde se coloca lo decide el
//! núcleo (principio 5). Aquí se leen y se escriben los archivos del
//! proyecto, que es lo que el núcleo no hace.

use galera_core::clipboard::{self, Clip};
use tauri::State;

use crate::commands::CommandError;
use crate::commands::ops::AppliedOp;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// Copia esos elementos y devuelve su texto plano, para que la interfaz lo
/// deje en el portapapeles del sistema.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn copy_elements(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    copy_in(&state, &ids)
}

/// Pega lo último que se copió en la página `page`, en el punto `(x, y)` en
/// mm o desplazado si no se dice dónde.
///
/// Devuelve `null` si no hay nada copiado.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si el comando no se puede aplicar.
#[tauri::command]
pub async fn paste_elements(
    page: String,
    x: Option<f64>,
    y: Option<f64>,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    let Some(clip) = state.clipboard() else {
        return Ok(None);
    };
    let applied = paste_in(&state, clip, &page, at(x, y))?;
    if applied.is_some() {
        queue.request();
    }
    Ok(applied)
}

/// Duplica esos elementos en su misma página, sin tocar lo copiado.
///
/// # Errores
///
/// Los de [`paste_elements`].
#[tauri::command]
pub async fn duplicate_elements(
    ids: Vec<String>,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    let applied = duplicate_in(&state, &ids)?;
    if applied.is_some() {
        queue.request();
    }
    Ok(applied)
}

/// El punto de destino, si se han dado los dos números y son de verdad.
fn at(x: Option<f64>, y: Option<f64>) -> Option<(f64, f64)> {
    match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Some((x, y)),
        _ => None,
    }
}

/// La parte de [`copy_elements`] que no depende de Tauri.
fn copy_in(state: &AppState, ids: &[String]) -> Result<String, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    // Con los archivos dentro: el proyecto donde se pegue puede no tenerlos.
    let clip = clipboard::with_files(&project, clipboard::copy(&document, ids));
    let text = clipboard::plain_text(&clip);
    state.set_clipboard(clip);
    Ok(text)
}

/// La parte de [`paste_elements`] que no depende de Tauri.
fn paste_in(
    state: &AppState,
    clip: Clip,
    page: &str,
    at: Option<(f64, f64)>,
) -> Result<Option<AppliedOp>, CommandError> {
    let (project, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    if clip.is_empty() {
        return Ok(None);
    }
    // Los archivos que trae se dejan en el proyecto antes de nombrarlos en
    // el documento: si el proyecto ya tiene uno igual, se reutiliza.
    let clip = clipboard::materialize(&project, clip);
    let op =
        clipboard::paste(&document, &clip, page, at).map_err(galera_core::GaleraError::from)?;
    Ok(Some(
        state
            .apply(&op, None)
            .ok_or(CommandError::NothingOpen)??
            .into(),
    ))
}

/// La parte de [`duplicate_elements`] que no depende de Tauri.
fn duplicate_in(state: &AppState, ids: &[String]) -> Result<Option<AppliedOp>, CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let clip = clipboard::copy(&document, ids);
    if clip.is_empty() {
        return Ok(None);
    }
    // En su misma página: la del primero que se duplica.
    let page = document
        .pages
        .iter()
        .find(|page| {
            page.elements
                .iter()
                .any(|element| ids.iter().any(|id| id == element.id()))
        })
        .map(|page| page.id.clone())
        .ok_or(CommandError::NothingOpen)?;
    paste_in(state, clip, &page, None)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use galera_core::{Document, Element, Project};

    use super::*;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// El estado con el informe abierto, que tiene texto e imagen.
    fn opened() -> AppState {
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let json = std::fs::read_to_string(fixtures_dir().join("informe.json")).expect("existe");
        let state = AppState::default();
        state.open(
            project,
            Document::from_json_str(&json).expect("es un documento"),
        );
        state
    }

    /// El criterio de la tarea: copiar deja texto plano para fuera.
    #[test]
    fn copying_returns_the_plain_text_and_keeps_what_was_copied() {
        let state = opened();
        let text = copy_in(&state, &["t1".to_owned()]).expect("se copia");
        assert!(text.contains("Informe"), "{text:?}");

        let clip = state.clipboard().expect("hay algo copiado");
        assert_eq!(clip.elements.len(), 1);
        // Con la fuente dentro, leída del proyecto.
        assert!(clip.fonts.iter().any(|file| file.bytes.is_some()));
    }

    /// El criterio de la tarea: los ids se rehacen al pegar.
    #[test]
    fn pasting_gives_new_ids_and_is_one_step() {
        let state = opened();
        copy_in(&state, &["r1".to_owned()]).expect("se copia");
        let applied = paste_elements_in(&state, "p1", None).expect("se pega");

        assert_eq!(applied.revision, 2, "un solo paso");
        assert!(
            applied.document.element("r1").is_some(),
            "el original sigue"
        );
        assert!(applied.document.element("r1-2").is_some(), "y la copia");
    }

    /// El criterio de la tarea: pegar en el punto del cursor.
    #[test]
    fn pasting_at_a_point_puts_it_there() {
        let state = opened();
        copy_in(&state, &["r1".to_owned()]).expect("se copia");
        let applied = paste_elements_in(&state, "p1", Some((70.0, 90.0))).expect("se pega");
        let copy = applied.document.element("r1-2").expect("está");
        assert_eq!(copy.position(), (70.0, 90.0));
    }

    /// Copiar una imagen se lleva su archivo, y pegarla lo deja donde toca.
    #[test]
    fn copying_an_image_carries_its_file() {
        let state = opened();
        copy_in(&state, &["i1".to_owned()]).expect("se copia");
        let clip = state.clipboard().expect("hay algo");
        let file = clip.assets.get("logo").expect("el recurso");
        assert!(file.bytes.is_some(), "con el archivo dentro");

        let applied = paste_elements_in(&state, "p1", None).expect("se pega");
        let Element::Image { asset, .. } = applied.document.element("i1-2").expect("está") else {
            panic!("es una imagen");
        };
        assert_eq!(asset, "logo", "el proyecto ya tenía ese recurso");
    }

    /// El criterio de la tarea: duplicar, sin tocar lo copiado.
    #[test]
    fn duplicating_does_not_touch_the_clipboard() {
        let state = opened();
        copy_in(&state, &["t1".to_owned()]).expect("se copia");
        let applied = duplicate_in(&state, &["r1".to_owned()])
            .expect("se duplica")
            .expect("cambia algo");

        assert!(applied.document.element("r1-2").is_some());
        let clip = state.clipboard().expect("sigue lo de antes");
        assert_eq!(clip.elements.first().map(Element::id), Some("t1"));
    }

    #[test]
    fn without_anything_copied_there_is_nothing_to_paste() {
        let state = opened();
        assert!(state.clipboard().is_none());
        assert!(duplicate_in(&state, &[]).expect("no falla").is_none());
    }

    #[test]
    fn without_a_document_copying_says_so() {
        let error = copy_in(&AppState::default(), &["r1".to_owned()]).expect_err("no hay");
        assert_eq!(error.kind(), "nothing_open");
    }

    /// Pegar sin pasar por Tauri, con lo que haya copiado.
    fn paste_elements_in(
        state: &AppState,
        page: &str,
        at: Option<(f64, f64)>,
    ) -> Option<AppliedOp> {
        let clip = state.clipboard()?;
        paste_in(state, clip, page, at).expect("se pega")
    }
}
