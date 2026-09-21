//! Editar el documento abierto con los comandos del núcleo.
//!
//! La interfaz no cambia el documento: manda un comando de
//! `galera_core::ops` (mover, redimensionar…), el backend lo aplica, pide
//! compilar en segundo plano y devuelve el documento nuevo. El resultado de
//! la compilación llega, como siempre, con los eventos de
//! [`crate::compile_worker`].
//!
//! Cada comando se apunta en el historial del documento abierto, y
//! [`undo`] y [`redo`] lo recorren (ver `galera_core::ops::history`).

use galera_core::layout::MmRect;
use galera_core::ops::align::{self, Alignment, Item, Spread};
use galera_core::ops::group;
use galera_core::{Document, Op};
use serde::Serialize;
use tauri::State;

use crate::commands::CommandError;
use crate::compile_worker::CompileQueue;
use crate::state::{AppState, Edited};

/// Un comando aplicado, tal como lo ve la interfaz.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedOp {
    /// La revisión con la que queda el documento. La compilación con esta
    /// revisión es la que ya incluye el cambio.
    pub revision: u64,
    /// El documento con el cambio.
    pub document: Document,
    /// Un nombre legible de lo que se ha hecho, deshecho o rehecho.
    pub description: String,
    /// Qué desharía ahora `undo`, o `null` si no hay nada.
    pub undo: Option<String>,
    /// Qué reharía ahora `redo`, o `null` si no hay nada.
    pub redo: Option<String>,
}

impl From<Edited> for AppliedOp {
    fn from(edited: Edited) -> Self {
        Self {
            revision: edited.revision,
            document: edited.document,
            description: edited.description,
            undo: edited.undo,
            redo: edited.redo,
        }
    }
}

/// Aplica un comando al documento abierto, lo apunta en el historial y pide
/// compilarlo.
///
/// `group`: los comandos seguidos con el mismo grupo son un único paso del
/// historial (por ejemplo, varios empujones con las flechas).
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si el comando no se puede aplicar (`kind: "op"`); entonces no cambia nada.
#[tauri::command]
pub async fn apply_op(
    op: Op,
    group: Option<String>,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<AppliedOp, CommandError> {
    let applied = apply_in(&state, &op, group.as_deref())?;
    queue.request();
    Ok(applied)
}

/// La parte de [`apply_op`] que no depende de Tauri, para poder probarla.
fn apply_in(state: &AppState, op: &Op, group: Option<&str>) -> Result<AppliedOp, CommandError> {
    Ok(state
        .apply(op, group)
        .ok_or(CommandError::NothingOpen)??
        .into())
}

/// Lleva varios elementos de la caja conjunta `from` a la caja `to`, en mm,
/// como un único cambio del documento.
///
/// Es lo que hace falta al redimensionar una multiselección: qué le toca a
/// cada elemento lo reparte el núcleo (`galera_core::ops::group`), y todo
/// entra como un solo paso del historial y una sola compilación.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si algún id no existe (`kind: "op"`); entonces no cambia nada.
#[tauri::command]
pub async fn scale_group(
    ids: Vec<String>,
    from: MmRect,
    to: MmRect,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<AppliedOp, CommandError> {
    let applied = scale_group_in(&state, &ids, from, to)?;
    queue.request();
    Ok(applied)
}

/// La parte de [`scale_group`] que no depende de Tauri, para poder probarla.
fn scale_group_in(
    state: &AppState,
    ids: &[String],
    from: MmRect,
    to: MmRect,
) -> Result<AppliedOp, CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let op = group::scale(&document, ids, from, to).map_err(galera_core::GaleraError::from)?;
    apply_in(state, &op, None)
}

/// Alinea varios elementos, respecto a la selección o a la página.
///
/// Con `to_page`, la línea a la que se alinea sale de la página que se ve;
/// sin él, de la caja que contiene a todos los elementos. Las cuentas son
/// del núcleo (`ops::align`), y todo entra como un solo paso del historial.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn align_elements(
    ids: Vec<String>,
    how: Alignment,
    to_page: bool,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    let applied = align_in(&state, &ids, how, to_page)?;
    if applied.is_some() {
        queue.request();
    }
    Ok(applied)
}

/// Reparte varios elementos con el mismo hueco entre ellos.
///
/// Con `to_page`, se reparten de borde a borde de la página; sin él, entre
/// los dos que están más lejos, que no se mueven.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn spread_elements(
    ids: Vec<String>,
    axis: Spread,
    to_page: bool,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    let applied = spread_in(&state, &ids, axis, to_page)?;
    if applied.is_some() {
        queue.request();
    }
    Ok(applied)
}

/// La parte de [`align_elements`] que no depende de Tauri.
fn align_in(
    state: &AppState,
    ids: &[String],
    how: Alignment,
    to_page: bool,
) -> Result<Option<AppliedOp>, CommandError> {
    let (items, page) = targets(state, ids)?;
    apply_moves(state, align::align(&items, how, to_page.then_some(page)))
}

/// La parte de [`spread_elements`] que no depende de Tauri.
fn spread_in(
    state: &AppState,
    ids: &[String],
    axis: Spread,
    to_page: bool,
) -> Result<Option<AppliedOp>, CommandError> {
    let (items, page) = targets(state, ids)?;
    apply_moves(state, align::spread(&items, axis, to_page.then_some(page)))
}

/// Los elementos con la caja que se ve, y el rectángulo de su página.
///
/// Se usan las cajas de la última compilación buena, que es la que se está
/// viendo: un texto de alto automático mide lo que midió Typst. Mientras no
/// haya ninguna compilación se usa la que declara el documento, que es lo
/// único que se sabe.
fn targets(state: &AppState, ids: &[String]) -> Result<(Vec<Item>, MmRect), CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let boxes = state
        .last_good_compilation()
        .map(|compiled| compiled.layout())
        .unwrap_or_default();

    let items: Vec<Item> = ids
        .iter()
        .filter_map(|id| {
            let measured = boxes.iter().find(|one| one.id == *id).map(|one| one.bounds);
            let rect = measured.or_else(|| declared(&document, id))?;
            Some(Item {
                id: id.clone(),
                rect,
            })
        })
        .collect();

    // La página de los elementos, o la primera si todavía no hay cajas.
    let number = items
        .first()
        .and_then(|first| boxes.iter().find(|one| one.id == first.id))
        .map_or(0, |found| found.page);
    let size = document
        .pages
        .get(number)
        .map(|page| MmRect {
            x: 0.0,
            y: 0.0,
            w: page.size.unit.to_millimeters(page.size.width),
            h: page.size.unit.to_millimeters(page.size.height),
        })
        .unwrap_or(MmRect {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        });
    Ok((items, size))
}

/// La caja que declara el documento, para cuando todavía no hay
/// compilación. Un alto automático cuenta como cero: es lo único que se
/// sabe de él hasta que Typst lo mida.
fn declared(document: &galera_core::Document, id: &str) -> Option<MmRect> {
    let element = document.element(id)?;
    if let galera_core::Element::Line { x, y, x2, y2, .. } = element {
        return Some(MmRect {
            x: x.min(*x2),
            y: y.min(*y2),
            w: (x2 - x).abs(),
            h: (y2 - y).abs(),
        });
    }
    let base = element.base()?;
    Some(MmRect {
        x: base.x,
        y: base.y,
        w: base.w,
        h: base.h.unwrap_or(0.0),
    })
}

/// Aplica el comando si mueve algo; si no, no toca el historial.
fn apply_moves(state: &AppState, op: Op) -> Result<Option<AppliedOp>, CommandError> {
    let empty = matches!(&op, Op::Batch { ops } if ops.is_empty());
    if empty {
        return Ok(None);
    }
    Ok(Some(apply_in(state, &op, None)?))
}

/// Deshace el último paso del historial y pide compilar. `null` si no hay
/// nada que deshacer.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn undo(
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    let undone = undo_in(&state)?;
    if undone.is_some() {
        queue.request();
    }
    Ok(undone)
}

/// Rehace el último paso deshecho y pide compilar. Como [`undo`].
#[tauri::command]
pub async fn redo(
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<Option<AppliedOp>, CommandError> {
    let redone = redo_in(&state)?;
    if redone.is_some() {
        queue.request();
    }
    Ok(redone)
}

fn undo_in(state: &AppState) -> Result<Option<AppliedOp>, CommandError> {
    Ok(state
        .undo()
        .ok_or(CommandError::NothingOpen)?
        .transpose()?
        .map(AppliedOp::from))
}

fn redo_in(state: &AppState) -> Result<Option<AppliedOp>, CommandError> {
    Ok(state
        .redo()
        .ok_or(CommandError::NothingOpen)?
        .transpose()?
        .map(AppliedOp::from))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use galera_core::Project;
    use serde_json::json;

    use super::*;

    fn opened() -> AppState {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        let project = Project::open(&dir).expect("fixtures/ es un proyecto");
        let json = std::fs::read_to_string(dir.join("informe.json")).expect("existe");
        let state = AppState::default();
        state.open(
            project,
            Document::from_json_str(&json).expect("es un documento"),
        );
        state
    }

    #[test]
    fn a_move_changes_the_document_and_says_what_it_did() {
        let state = opened();
        let op: Op =
            serde_json::from_value(json!({ "op": "move", "id": "r1", "dx": 0, "dy": 12.5 }))
                .expect("la interfaz lo manda así");

        let applied = apply_in(&state, &op, None).expect("se aplica");
        assert_eq!(applied.revision, 2);
        assert_eq!(applied.description, "Mover r1");
        let moved = applied
            .document
            .element("r1")
            .and_then(|e| e.base())
            .expect("caja");
        assert_eq!((moved.x, moved.y), (0.0, 12.5));

        let json = serde_json::to_value(&applied).expect("serializa");
        assert_eq!(json["revision"], 2);
        assert!(json["document"]["pages"].is_array());
        assert_eq!(json["undo"], "Mover r1");
        assert!(json["redo"].is_null());
    }

    #[test]
    fn a_nudge_burst_with_one_group_is_undone_at_once() {
        let state = opened();
        let op = Op::Move {
            id: "r1".into(),
            dx: 1.0,
            dy: 0.0,
        };
        for _ in 0..5 {
            apply_in(&state, &op, Some("empujar-r1-1")).expect("se aplica");
        }

        let undone = undo_in(&state).expect("abierto").expect("hay algo");
        assert_eq!(undone.description, "Mover r1");
        let x = undone
            .document
            .element("r1")
            .and_then(|e| e.base())
            .map(|b| b.x);
        assert_eq!(x, Some(0.0));
        assert_eq!(undone.undo, None);
        assert_eq!(undone.redo.as_deref(), Some("Mover r1"));
        assert!(undo_in(&state).expect("abierto").is_none());

        let redone = redo_in(&state).expect("abierto").expect("hay algo");
        let x = redone
            .document
            .element("r1")
            .and_then(|e| e.base())
            .map(|b| b.x);
        assert_eq!(x, Some(5.0));
    }

    #[test]
    fn undo_and_redo_without_a_document_say_so() {
        assert!(matches!(
            undo_in(&AppState::default()),
            Err(CommandError::NothingOpen)
        ));
        assert!(matches!(
            redo_in(&AppState::default()),
            Err(CommandError::NothingOpen)
        ));
    }

    #[test]
    fn a_command_that_does_not_apply_is_an_op_error() {
        let state = opened();
        let error =
            apply_in(&state, &Op::Delete { id: "nadie".into() }, None).expect_err("no existe");
        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "op");
        assert_eq!(state.summary().revision, 1);
    }

    #[test]
    fn without_a_document_there_is_nothing_to_edit() {
        assert!(matches!(
            apply_in(&AppState::default(), &Op::Delete { id: "r1".into() }, None),
            Err(CommandError::NothingOpen)
        ));
    }

    /// El criterio de la tarea: redimensionar el grupo escala posiciones y
    /// tamaños, y entra como un solo paso.
    #[test]
    fn scaling_a_group_is_one_step_of_the_history() {
        let state = opened();
        // La banda de arriba (0,0 210×15) y el texto (20,30 170 de ancho):
        // su caja conjunta va de (0,0) a (190, …). Se estira al doble de
        // ancho desde el mismo sitio.
        let from = MmRect {
            x: 0.0,
            y: 0.0,
            w: 190.0,
            h: 100.0,
        };
        let to = MmRect { w: 380.0, ..from };
        let ids = ["r1".to_owned(), "t1".to_owned()];

        let applied = scale_group_in(&state, &ids, from, to).expect("se aplica");
        assert_eq!(applied.revision, 2, "una sola revisión para los dos");
        assert_eq!(applied.description, "Redimensionar 2 elementos");

        let band = applied
            .document
            .element("r1")
            .and_then(|one| one.base())
            .expect("caja");
        assert_eq!((band.x, band.w), (0.0, 420.0));
        let text = applied
            .document
            .element("t1")
            .and_then(|one| one.base())
            .expect("caja");
        assert_eq!((text.x, text.w), (40.0, 340.0));
    }

    #[test]
    fn scaling_a_group_with_an_id_that_is_not_there_changes_nothing() {
        let state = opened();
        let rect = MmRect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
        };
        let error =
            scale_group_in(&state, &["fantasma".to_owned()], rect, rect).expect_err("no está");
        assert_eq!(error.kind(), "op");
        let (_, document) = state.open_document().expect("sigue abierto");
        let band = document
            .element("r1")
            .and_then(|one| one.base())
            .expect("caja");
        assert_eq!((band.x, band.w), (0.0, 210.0), "nada se ha movido");
    }

    #[test]
    fn scaling_a_group_without_a_document_says_so() {
        let rect = MmRect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
        };
        let error = scale_group_in(&AppState::default(), &["r1".to_owned()], rect, rect)
            .expect_err("no hay documento");
        assert_eq!(error.kind(), "nothing_open");
    }

    /// El criterio de la tarea: alinear la selección con cajas conocidas.
    #[test]
    fn aligning_moves_the_elements_to_the_same_line() {
        let state = opened();
        // r1 (0,0 210×15) y t1 (20,30 170 de ancho): alineados a la
        // izquierda, t1 se va a x = 0.
        let applied = align_in(
            &state,
            &["r1".to_owned(), "t1".to_owned()],
            Alignment::Left,
            false,
        )
        .expect("se aplica")
        .expect("mueve algo");
        assert_eq!(applied.description, "Mover t1", "solo se mueve uno");
        let text = applied
            .document
            .element("t1")
            .and_then(|one| one.base())
            .expect("caja");
        assert_eq!(text.x, 0.0);
    }

    /// El criterio de la tarea: alinear respecto a la página.
    #[test]
    fn aligning_to_the_page_centres_on_the_paper() {
        let state = opened();
        // La imagen está en x = 20 y mide 80 de ancho: centrada en una
        // página de 210 va a (210 - 80) / 2 = 65.
        let applied = align_in(&state, &["i1".to_owned()], Alignment::CenterX, true)
            .expect("se aplica")
            .expect("mueve algo");
        let image = applied
            .document
            .element("i1")
            .and_then(|one| one.base())
            .expect("caja");
        assert_eq!(image.x, 65.0);

        // Y el texto, que ya estaba centrado, no se mueve.
        assert!(
            align_in(&state, &["t1".to_owned()], Alignment::CenterX, true)
                .expect("no falla")
                .is_none()
        );
    }

    /// El criterio de la tarea: cada operación es un solo paso.
    #[test]
    fn spreading_is_one_step_of_the_history() {
        let state = opened();
        let applied = spread_in(
            &state,
            &["r1".to_owned(), "t1".to_owned(), "i1".to_owned()],
            Spread::Vertical,
            false,
        )
        .expect("se aplica")
        .expect("mueve algo");
        assert_eq!(applied.revision, 2, "una sola revisión");
    }

    #[test]
    fn aligning_what_is_already_in_place_changes_nothing() {
        let state = opened();
        let applied =
            align_in(&state, &["r1".to_owned()], Alignment::Left, false).expect("no falla");
        assert!(applied.is_none(), "ni un paso del historial");
    }

    #[test]
    fn aligning_without_a_document_says_so() {
        let error = align_in(
            &AppState::default(),
            &["r1".to_owned()],
            Alignment::Left,
            false,
        )
        .expect_err("no hay documento");
        assert_eq!(error.kind(), "nothing_open");
    }
}
