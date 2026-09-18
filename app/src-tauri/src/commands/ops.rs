//! Editar el documento abierto con los comandos del núcleo.
//!
//! La interfaz no cambia el documento: manda un comando de
//! `galera_core::ops` (mover, redimensionar…), el backend lo aplica, pide
//! compilar en segundo plano y devuelve el documento nuevo. El resultado de
//! la compilación llega, como siempre, con los eventos de
//! [`crate::compile_worker`].

use galera_core::{Document, Op};
use serde::Serialize;
use tauri::State;

use crate::commands::CommandError;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// Un comando aplicado, tal como lo ve la interfaz.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedOp {
    /// La revisión con la que queda el documento. La compilación con esta
    /// revisión es la que ya incluye el cambio.
    pub revision: u64,
    /// El documento con el cambio.
    pub document: Document,
    /// Un nombre legible del cambio, para el historial.
    pub description: String,
}

/// Aplica un comando al documento abierto y pide compilarlo.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si el comando no se puede aplicar (`kind: "op"`); entonces no cambia nada.
#[tauri::command]
pub async fn apply_op(
    op: Op,
    state: State<'_, AppState>,
    queue: State<'_, CompileQueue>,
) -> Result<AppliedOp, CommandError> {
    let applied = apply_in(&state, &op)?;
    queue.request();
    Ok(applied)
}

/// La parte de [`apply_op`] que no depende de Tauri, para poder probarla.
fn apply_in(state: &AppState, op: &Op) -> Result<AppliedOp, CommandError> {
    let (revision, document, _undo) = state.apply(op).ok_or(CommandError::NothingOpen)??;
    Ok(AppliedOp {
        revision,
        document,
        description: op.describe(),
    })
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

        let applied = apply_in(&state, &op).expect("se aplica");
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
    }

    #[test]
    fn a_command_that_does_not_apply_is_an_op_error() {
        let state = opened();
        let error = apply_in(&state, &Op::Delete { id: "nadie".into() }).expect_err("no existe");
        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "op");
        assert_eq!(state.summary().revision, 1);
    }

    #[test]
    fn without_a_document_there_is_nothing_to_edit() {
        assert!(matches!(
            apply_in(&AppState::default(), &Op::Delete { id: "r1".into() }),
            Err(CommandError::NothingOpen)
        ));
    }
}
