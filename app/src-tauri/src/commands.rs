//! Los comandos que la interfaz puede invocar.
//!
//! Cada comando es una puerta fina: recibe lo que manda la interfaz, llama a
//! `galera-core` o al estado, y devuelve el resultado. Sin lógica propia
//! (principio 5 del README).
//!
//! Lo que devuelven se serializa a JSON con los nombres en `camelCase`, que es
//! como se escriben en TypeScript.

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// El estado de la sesión, tal como lo ve la interfaz.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    /// La versión de `galera-core` con la que está compilada la app.
    pub core_version: &'static str,
    /// El título del documento abierto, si hay uno.
    pub title: Option<String>,
    /// Cuántas páginas tiene el documento abierto.
    pub page_count: usize,
    /// Si la última compilación corresponde a lo que hay abierto.
    pub compiled_is_current: bool,
}

/// Devuelve el estado de la sesión.
///
/// Sirve de momento para comprobar que la interfaz, el backend y el núcleo
/// están conectados; los comandos de abrir y compilar llegan en F1-03 y F1-04.
#[tauri::command]
pub fn session_status(state: State<'_, AppState>) -> SessionStatus {
    status_of(&state)
}

/// La parte del comando que no depende de Tauri, para poder probarla.
fn status_of(state: &AppState) -> SessionStatus {
    let summary = state.summary();
    SessionStatus {
        core_version: galera_core::version(),
        title: summary.title,
        page_count: summary.page_count,
        compiled_is_current: summary.compiled_is_current,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_session_reports_the_core_version_and_nothing_open() {
        let status = status_of(&AppState::default());
        assert_eq!(status.core_version, galera_core::version());
        assert_eq!(status.title, None);
        assert_eq!(status.page_count, 0);
        assert!(!status.compiled_is_current);
    }

    /// La interfaz lee `camelCase`: un cambio de nombre aquí rompería
    /// `src/commands.ts` sin que TypeScript lo viera.
    #[test]
    fn it_serializes_in_camel_case() {
        let json = serde_json::to_value(status_of(&AppState::default())).expect("serializa");
        assert_eq!(
            json,
            serde_json::json!({
                "coreVersion": galera_core::version(),
                "title": null,
                "pageCount": 0,
                "compiledIsCurrent": false
            })
        );
    }
}
