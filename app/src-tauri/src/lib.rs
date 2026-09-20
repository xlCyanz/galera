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
pub mod compile_worker;
pub mod state;

use compile_worker::CompileQueue;
use state::AppState;
use tauri::Manager;

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
        .manage(CompileQueue::default())
        // El hilo que compila en segundo plano. Ver `compile_worker`.
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("galera-compile".to_owned())
                .spawn(move || {
                    let state = handle.state::<AppState>();
                    let queue = handle.state::<CompileQueue>();
                    compile_worker::run(&state, &queue, &handle);
                })?;
            Ok(())
        })
        // El diálogo se usa solo desde Rust: la interfaz no tiene permiso
        // para abrirlo por su cuenta. Ver `commands::project`.
        .plugin(tauri_plugin_dialog::init())
        // Lo que se suelta sobre la ventana queda anotado antes de que la
        // interfaz pida copiarlo. Ver `commands::assets`.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<AppState>().offer_files(paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::session::session_status,
            commands::project::choose_project_folder,
            commands::project::choose_project_file,
            commands::project::open_project,
            commands::project::save_project,
            commands::project::save_project_as,
            commands::render::render_page,
            commands::render::request_compilation,
            commands::selection::element_at,
            commands::ops::apply_op,
            commands::ops::undo,
            commands::ops::redo,
            commands::export::export_pdf,
            commands::fonts::text_defaults,
            commands::fonts::add_font,
            commands::fonts::list_fonts,
            commands::fonts::font_families,
            commands::fonts::font_sample,
            commands::fonts::remove_font,
            commands::assets::import_images,
            commands::assets::choose_images,
            commands::assets::list_assets,
            commands::assets::asset_data,
        ])
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// Criterio de F1-03: la interfaz no tiene permisos de sistema de
    /// archivos, ni de diálogo. Solo los básicos de Tauri; lo que lee del
    /// disco lo lee el backend, y solo de la carpeta elegida.
    ///
    /// Si hace falta un permiso nuevo, se añade a propósito aquí y en
    /// `capabilities/default.json`, explicando por qué en el PR.
    #[test]
    fn the_webview_only_has_the_basic_permissions() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
        let capability: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("capabilities/default.json existe"),
        )
        .expect("es JSON");

        assert_eq!(
            capability["permissions"],
            serde_json::json!(["core:default"])
        );

        let capabilities = std::fs::read_dir(path.parent().expect("tiene carpeta"))
            .expect("capabilities/ existe")
            .count();
        assert_eq!(capabilities, 1, "no hay más archivos de permisos");
    }
}
