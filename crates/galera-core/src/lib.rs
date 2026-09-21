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
//! - [`layout`](mod@layout): la caja real de cada elemento, tal como la compuso Typst.
//! - [`ops`]: comandos de edición, cada uno con cómo deshacerlo, y el historial.
//! - [`clipboard`]: copiar y pegar elementos, también de un documento a otro.
//! - [`code`](mod@code): dónde está roto el código de un bloque, por líneas.
//! - [`snap`](mod@snap): guías de alineación y ajuste al mover un elemento.
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

pub mod archive;
pub mod assets;
pub mod clipboard;
pub mod code;
pub mod codegen;
pub mod compile;
pub mod error;
pub mod fonts;
mod import;
pub mod layout;
pub mod model;
pub mod open;
pub mod ops;
pub mod project;
pub mod snap;
#[cfg(test)]
mod testing;
pub mod world;
pub mod zip;

pub use archive::{
    ARCHIVE_EXTENSION, ArchiveError, ProjectFormat, create, pack, save_as_folder, save_document,
    unpack,
};
pub use assets::{
    AssetSummary, ImageFormat, ImportImageError, ImportedImage, asset_summaries, import_image,
};
pub use clipboard::{Clip, ClipFile};
pub use code::{CodeError, check_code};
pub use codegen::{escape, escape_into};
pub use compile::cache::Compiler;
pub use compile::{Compiled, compile, compile_pdf, compile_svg};
pub use error::{Diagnostic, GaleraError, Result, Severity};
pub use fonts::{
    ImportFontError, ImportedFont, default_text_style, font_users, import_font, sample_document,
};
pub use layout::glyphs::{Glyph, glyphs};
pub use layout::{LayoutBox, MmRect, layout, overflowing};
pub use model::{
    Align, DEFAULT_PARAGRAPH_SPACING, Dash, Document, Element, ElementBox, Layer, Meta, Page,
    PageSize, Run, Stroke, TextStyle, Unit, ValidationError, ValidationErrors,
};
pub use open::{DOCUMENT_FILE, OpenError, Opened, open};
pub use ops::history::History;
pub use ops::{Applied, Op, OpError, Property};
pub use project::{AccessError, Project, ProjectError};
pub use snap::{Grip, Grips, Guide, GuideKind, SNAP_PX, Snapped, neighbours, snap};
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
