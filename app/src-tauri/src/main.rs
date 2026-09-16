//! Backend de la app de escritorio de Galera.
//!
//! Este proceso es el que abre la ventana y responde a la interfaz. No tiene
//! lógica propia: los comandos que recibe se limitarán a llamar a
//! `galera-core` (principio 5 del README). Enlazarlo es la tarea F1-02.
//!
//! # Nota de Tauri
//!
//! Tauri ejecuta la interfaz en el webview nativo del sistema y la lógica en
//! este proceso Rust. Se hablan por *comandos*: funciones marcadas con
//! `#[tauri::command]` que la interfaz llama con `invoke("nombre", args)`. No
//! hay Node en producción: todo lo que toque disco o use CPU vive aquí.

// En Windows, sin esto la app abriría también una consola al arrancar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(clippy::unwrap_used, clippy::expect_used)]

/// Comando de prueba: devuelve el mensaje con un prefijo.
///
/// Solo sirve para comprobar que la interfaz y el backend se hablan.
/// Desaparecerá cuando haya comandos de verdad (F1-03).
#[tauri::command]
fn ping(message: String) -> String {
    format!("pong: {message}")
}

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!());

    if let Err(error) = app {
        eprintln!("error: no se pudo iniciar Galera: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_answers_with_the_message() {
        assert_eq!(ping("hola".to_owned()), "pong: hola");
    }
}
