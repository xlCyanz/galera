//! Los comandos que cambian el texto de un bloque.
//!
//! Son la traducción de lo que hace quien escribe —teclear, borrar, poner
//! en negrita— a comandos del documento. El reparto en tramos lo hace
//! [`crate::model::text`]: aquí solo se comprueba que el elemento sea un
//! texto y se traduce el error.
//!
//! Las posiciones van en caracteres (clústeres de grafemas), como en el
//! modelo. Deshacer es [`Op::Restore`](super::Op::Restore), igual que en
//! cualquier otro cambio de un elemento: guarda el texto que había en vez
//! de calcular el cambio contrario, que con los tramos normalizados no
//! siempre sería el mismo.

use super::OpError;
use crate::model::Element;
use crate::model::text::{self, Format};

/// Mete texto en la posición `at`.
pub(super) fn insert(
    element: &mut Element,
    id: &str,
    at: usize,
    insertion: &str,
) -> Result<(), OpError> {
    let content = content_of(element, id, "Escribir")?;
    text::insert(content, at, insertion)?;
    Ok(())
}

/// Borra el tramo `[from, to)`.
pub(super) fn delete(
    element: &mut Element,
    id: &str,
    from: usize,
    to: usize,
) -> Result<(), OpError> {
    let content = content_of(element, id, "Borrar texto")?;
    text::remove(content, from, to)?;
    Ok(())
}

/// Cambia el formato del tramo `[from, to)`.
pub(super) fn format(
    element: &mut Element,
    id: &str,
    from: usize,
    to: usize,
    change: &Format,
) -> Result<(), OpError> {
    let content = content_of(element, id, "Dar formato")?;
    text::format(content, from, to, change)?;
    Ok(())
}

/// Los tramos del elemento, si es un bloque de texto.
fn content_of<'a>(
    element: &'a mut Element,
    id: &str,
    what: &str,
) -> Result<&'a mut Vec<crate::model::Run>, OpError> {
    let kind = element.type_name();
    match element {
        Element::Text { content, .. } => Ok(content),
        _ => Err(OpError::NotApplicable {
            id: id.to_owned(),
            kind,
            what: what.to_owned(),
        }),
    }
}
