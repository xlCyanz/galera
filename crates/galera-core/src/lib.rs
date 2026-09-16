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
//! - [`codegen`]: traducción del documento a código Typst.
//! - [`world`]: implementación de `typst::World` con las fuentes del proyecto.
//! - [`compile`](mod@compile): compilación a PDF y SVG; PNG llega después.
//! - [`error`]: el error único del núcleo, [`GaleraError`], y los diagnósticos.
//! - [`project`]: la carpeta del proyecto y qué se puede leer de ella.
//! - [`open`](mod@open): abrir un proyecto comprobando su documento y sus recursos.
//! - `layout`:  cajas, posiciones de glifos y detección de clics. *(pendiente)*
//! - `ops`:     comandos de edición e historial de deshacer y rehacer. *(pendiente)*
//! - `snap`:    guías de alineación. *(pendiente)*
//!
//! # Principio que ordena todo lo demás
//!
//! El JSON es la fuente de verdad y Typst es un formato de salida. El núcleo
//! genera código Typst, nunca lo lee ni lo modifica.
//!
//! # Sin `unwrap` ni `expect`
//!
//! Fuera de las pruebas, el núcleo no puede hacer `panic!` por un `unwrap()`
//! o un `expect()`: todo lo que puede fallar devuelve un [`Result`]. No es una
//! convención sino una regla de clippy, así que CI lo impide.

#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

pub mod codegen;
pub mod compile;
pub mod error;
pub mod model;
pub mod open;
pub mod project;
pub mod world;

pub use codegen::{escape, escape_into};
pub use compile::{Compiled, compile, compile_pdf, compile_svg};
pub use error::{Diagnostic, GaleraError, Result, Severity};
pub use model::{
    Align, Document, Element, ElementBox, Meta, Page, PageSize, Run, Stroke, TextStyle, Unit,
    ValidationError, ValidationErrors,
};
pub use open::{DOCUMENT_FILE, OpenError, Opened, open};
pub use project::{AccessError, Project, ProjectError};
pub use world::{GaleraWorld, WorldError};

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
