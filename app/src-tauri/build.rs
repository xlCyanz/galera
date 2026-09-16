//! Tauri necesita preparar, antes de compilar, la configuración de la app y
//! los permisos de `capabilities/`. Lo hace este script de compilación.

fn main() {
    tauri_build::build();
}
