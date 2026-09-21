//! Generar muchos documentos de uno solo.
//!
//! La idea es la de siempre en las plantillas: un documento con variables y
//! una tabla con una fila por documento. Aquí está lo que hace falta para
//! **leer esa tabla** y emparejarla con las variables ([`csv`]), y
//! **generar** un PDF por fila o uno solo con todas ([`generate`]).

pub mod csv;
pub mod generate;

pub use generate::{Failure, Outcome, Output, Progress, generate};
