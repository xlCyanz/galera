//! El código Typst del documento abierto, para verlo.
//!
//! El panel de código enseña **la salida** del editor: el código que genera
//! `galera_core::codegen` a partir del documento. No es una entrada —el
//! editor no lee Typst escrito a mano (principio 1)—, así que el comando
//! solo devuelve texto y dónde está cada elemento dentro de él.
//!
//! Se genera del documento de ahora, no del de la última compilación: es
//! una cuenta de milisegundos y así el panel enseña lo que se está
//! editando.

use galera_core::code::{self, CodeError};
use galera_core::codegen::{self, CodeSpan};
use serde::Serialize;
use tauri::State;

use crate::commands::CommandError;
use crate::state::AppState;

/// El código generado y dónde está cada elemento dentro de él.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCode {
    /// El código Typst, entero.
    pub code: String,
    /// Dónde empieza y acaba el código de cada elemento, en bytes.
    pub spans: Vec<CodeSpan>,
    /// La revisión del documento del que salió.
    pub revision: u64,
}

/// El código Typst del documento abierto.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento, o el error del núcleo
/// si el documento no se puede traducir a código (`kind: "codegen"`).
#[tauri::command]
pub async fn generated_code(state: State<'_, AppState>) -> Result<GeneratedCode, CommandError> {
    generated_code_in(&state)
}

/// Dónde está roto el código de un bloque, por líneas.
///
/// Son errores **de sintaxis**, los que se ven sin compilar: es lo que hace
/// falta mientras se escribe. Lo que falla al evaluar sale al compilar, como
/// cualquier otro problema del documento.
#[tauri::command]
pub async fn check_code(source: String) -> Result<Vec<CodeError>, CommandError> {
    Ok(code::check_code(&source))
}

/// La parte de [`generated_code`] que no depende de Tauri.
fn generated_code_in(state: &AppState) -> Result<GeneratedCode, CommandError> {
    let (revision, document) = state
        .document_with_revision()
        .ok_or(CommandError::NothingOpen)?;
    let code = codegen::generate(&document).map_err(galera_core::GaleraError::from)?;
    let spans = codegen::spans(&code);
    Ok(GeneratedCode {
        code,
        spans,
        revision,
    })
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use galera_core::{Document, Project};

    use super::*;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

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

    #[test]
    fn it_returns_the_code_with_every_element_in_it() {
        let state = opened();
        let generated = generated_code_in(&state).expect("hay documento");

        assert!(generated.code.contains("#set page("), "{}", generated.code);
        assert_eq!(generated.revision, 1);
        let ids: Vec<&str> = generated.spans.iter().map(|one| one.id.as_str()).collect();
        assert_eq!(ids, vec!["r1", "t1", "i1", "c1"]);

        // Y cada trozo es el código de su elemento.
        let first = &generated.spans[0];
        assert!(generated.code[first.start..first.end].ends_with("<el-r1>"));
    }

    /// El panel enseña lo que se está editando, no lo último compilado.
    #[test]
    fn it_follows_the_document_as_it_changes() {
        let state = opened();
        state
            .apply(
                &galera_core::Op::Move {
                    id: "r1".to_owned(),
                    dx: 0.0,
                    dy: 10.0,
                },
                None,
            )
            .expect("hay documento")
            .expect("se aplica");

        let generated = generated_code_in(&state).expect("hay documento");
        assert_eq!(generated.revision, 2);
        assert!(generated.code.contains("dy: 10mm"), "{}", generated.code);
    }

    /// El criterio de la tarea: el error de sintaxis sale con su línea.
    #[test]
    fn a_syntax_error_comes_with_its_line() {
        let found = code::check_code("bien\n#table(columns: 2)[A");
        assert_eq!(found.len(), 1, "{found:#?}");
        assert_eq!(found[0].line, 2);
    }

    #[test]
    fn without_a_document_there_is_no_code() {
        let error = generated_code_in(&AppState::default()).expect_err("no hay");
        assert_eq!(error.kind(), "nothing_open");
    }
}
