//! Punto de entrada de la app de escritorio. Todo lo demás está en la
//! biblioteca `galera_app`.

// En Windows, sin esto la app abriría también una consola al arrancar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = galera_app::run() {
        eprintln!("error: no se pudo iniciar Galera: {error}");
        std::process::exit(1);
    }
}
