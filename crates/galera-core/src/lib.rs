//! Núcleo de Galera.
//!
//! Este crate contiene toda la lógica del editor y no depende de ninguna
//! interfaz: ni de Tauri, ni del webview, ni del sistema de ventanas. Es una
//! decisión deliberada (principio 5 del README) para poder reutilizarlo más
//! adelante desde Swift en macOS o compilarlo a WASM para la web.
//!
//! # Módulos
//!
//! El crate se irá llenando a lo largo de la Fase 0 y la Fase 2. Lo que
//! todavía no existe queda marcado como pendiente:
//!
//! - [`model`]: el documento, sus páginas y sus elementos (serde).
//! - `codegen`: traducción del documento a código Typst. *(pendiente)*
//! - `world`:   implementación de `typst::World` con las fuentes del proyecto. *(pendiente)*
//! - `compile`: compilación a PDF, SVG y PNG. *(pendiente)*
//! - `layout`:  cajas, posiciones de glifos y detección de clics. *(pendiente)*
//! - `ops`:     comandos de edición e historial de deshacer y rehacer. *(pendiente)*
//! - `snap`:    guías de alineación. *(pendiente)*
//!
//! # Principio que ordena todo lo demás
//!
//! El JSON es la fuente de verdad y Typst es un formato de salida. El núcleo
//! genera código Typst, nunca lo lee ni lo modifica.

pub mod model;

pub use model::{
    Align, Document, Element, ElementBox, Meta, Page, PageSize, Run, Stroke, TextStyle, Unit,
};

/// Versión del formato de documento que entiende este núcleo.
///
/// Corresponde al campo `version` del JSON. Un documento con otra versión se
/// rechaza al cargarlo, en vez de interpretarse a medias.
pub const DOCUMENT_VERSION: u32 = 1;

/// Versión del crate, tal como aparece en `Cargo.toml`.
///
/// La usan la CLI y la app para identificarse en los mensajes de error.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_version_is_one() {
        assert_eq!(DOCUMENT_VERSION, 1);
    }

    #[test]
    fn crate_version_is_not_empty() {
        assert!(!version().is_empty());
    }
}
