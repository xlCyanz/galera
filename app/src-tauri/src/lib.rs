//! Backend de la app de escritorio de Galera.
//!
//! Este proceso abre la ventana y responde a la interfaz. No tiene lógica
//! propia: guarda lo que hay abierto ([`state`]) y expone comandos
//! ([`commands`]) que llaman a `galera-core` (principio 5 del README).
//!
//! Está en una biblioteca, y `main.rs` solo llama a [`run`], que es la
//! estructura que usa Tauri 2: el estado y los comandos son la API del
//! backend, y se pueden probar sin abrir ninguna ventana.
//!
//! # Nota de Tauri
//!
//! Tauri ejecuta la interfaz en el webview nativo del sistema y la lógica en
//! este proceso Rust. Se hablan por *comandos*: funciones marcadas con
//! `#[tauri::command]` que la interfaz llama con `invoke("nombre", args)`. No
//! hay Node en producción: todo lo que toque disco o use CPU vive aquí.

#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

pub mod commands;
pub mod state;

use state::AppState;

/// Arranca la app y se queda atendiendo la ventana hasta que se cierra.
///
/// # Errores
///
/// Falla si Tauri no puede crear la ventana o el webview.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        // Tauri guarda el estado y se lo pasa a cada comando que lo pida
        // con un argumento `State<'_, AppState>`.
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![commands::session_status])
        .run(tauri::generate_context!())
}
