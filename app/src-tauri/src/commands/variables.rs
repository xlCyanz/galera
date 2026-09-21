//! Las variables del documento: dónde se usan y si sus valores valen.
//!
//! Crear, renombrar, cambiar y quitar variables son comandos de `ops`, como
//! todo lo demás. Lo que hace falta aparte es **mirar**: qué elementos usan
//! una variable —para saber qué se rompe al quitarla— y si un valor vale
//! para su tipo. Las dos cosas las decide el núcleo
//! (`galera_core::variables`, principio 5).

use galera_core::model::Variable;
use galera_core::variables;
use serde::Serialize;
use tauri::State;

use crate::commands::CommandError;
use crate::state::AppState;

/// Qué se sabe de una variable, además de su valor.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableStatus {
    /// Los elementos que la usan, por su id y en orden del documento.
    pub used_by: Vec<String>,
    /// Por qué su valor no vale para su tipo, o `null` si vale.
    pub invalid: Option<String>,
}

/// Dónde se usa la variable `name` y si su valor vale.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn variable_status(
    name: String,
    state: State<'_, AppState>,
) -> Result<VariableStatus, CommandError> {
    status_in(&state, &name)
}

/// La parte de [`variable_status`] que no depende de Tauri.
fn status_in(state: &AppState, name: &str) -> Result<VariableStatus, CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let invalid = document
        .variables
        .get(name)
        .and_then(|variable| variables::check(&document, variable).err())
        .map(|invalid| reason(invalid).to_owned());
    Ok(VariableStatus {
        used_by: variables::uses(&document, name),
        invalid,
    })
}

/// Qué le pasa al valor, en español y listo para enseñar.
fn reason(invalid: variables::Invalid) -> &'static str {
    match invalid {
        variables::Invalid::NotANumber => "no es un número: se escribe con punto decimal",
        variables::Invalid::NotADate => {
            "no es una fecha: se escribe AAAA-MM-DD y tiene que existir"
        }
        variables::Invalid::UnknownAsset => "no hay ningún recurso del documento con esa clave",
    }
}

/// Las variables del documento abierto, con su tipo y su valor.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn variables_of(
    state: State<'_, AppState>,
) -> Result<Vec<(String, Variable)>, CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    Ok(document.variables.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use galera_core::{Document, Project};

    use super::*;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// El informe, con una variable metida en su texto.
    fn opened() -> AppState {
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let json = std::fs::read_to_string(fixtures_dir().join("informe.json")).expect("existe");
        let mut document = Document::from_json_str(&json).expect("es un documento");
        document
            .variables
            .insert("nombre".to_owned(), Variable::text("Cooperativa"));
        document.variables.insert(
            "fecha".to_owned(),
            Variable {
                kind: galera_core::VariableKind::Date,
                value: "2026-02-31".to_owned(),
            },
        );
        if let Some(galera_core::Element::Text { content, .. }) = document
            .pages
            .first_mut()
            .and_then(|page| page.elements.iter_mut().find(|one| one.id() == "t1"))
        {
            content[0].text = "Informe de {{nombre}}".to_owned();
        }

        let state = AppState::default();
        state.open(project, document);
        state
    }

    /// El criterio de la tarea: se ve dónde se usa cada variable.
    #[test]
    fn it_says_which_elements_use_the_variable() {
        let state = opened();
        let status = status_in(&state, "nombre").expect("hay documento");
        assert_eq!(status.used_by, vec!["t1"]);
        assert!(status.invalid.is_none());

        let unused = status_in(&state, "fecha").expect("hay documento");
        assert!(unused.used_by.is_empty());
    }

    /// El criterio de la tarea: el valor se valida según su tipo.
    #[test]
    fn a_value_that_does_not_fit_its_kind_says_why() {
        let state = opened();
        let status = status_in(&state, "fecha").expect("hay documento");
        let reason = status.invalid.expect("el 31 de febrero no existe");
        assert!(reason.contains("fecha"), "{reason}");
    }

    #[test]
    fn a_variable_that_is_not_there_is_used_nowhere() {
        let state = opened();
        let status = status_in(&state, "loquesea").expect("hay documento");
        assert!(status.used_by.is_empty());
        assert!(status.invalid.is_none());
    }

    #[test]
    fn without_a_document_there_is_nothing_to_look_at() {
        let error = status_in(&AppState::default(), "nombre").expect_err("no hay");
        assert_eq!(error.kind(), "nothing_open");
    }
}
