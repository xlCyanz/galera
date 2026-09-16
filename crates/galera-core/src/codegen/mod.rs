//! Generación de código Typst a partir del documento.
//!
//! El sentido de este módulo es de ida y solo de ida: el documento entra,
//! el código `.typ` sale. Galera no lee Typst ni lo interpreta, con la única
//! excepción del elemento [`Element::Code`](crate::Element::Code), que se
//! copia tal cual sin mirarlo (principio 1 del README).
//!
//! # Piezas
//!
//! - [`escape`]: convierte texto del usuario en texto literal para Typst.
//!   Es la pieza de la que depende la seguridad de todo lo demás.
//! - El resto —cabecera del documento, páginas, formas, texto, imágenes y
//!   bloques de código— llega en las tareas F0-05 a F0-09.

pub mod escape;

pub use escape::{escape, escape_into};
