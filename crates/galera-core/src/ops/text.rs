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
use crate::model::text::{self, Format};
use crate::model::{Element, Line};

/// Mete texto en la posición `at`.
pub(super) fn insert(
    element: &mut Element,
    id: &str,
    at: usize,
    insertion: &str,
) -> Result<(), OpError> {
    let (content, lines) = text_of(element, id, "Escribir")?;
    // Los estilos de línea van por número de línea: si el texto gana
    // líneas, se mueven con él.
    let before = text::text(content);
    text::insert(content, at, insertion)?;
    text::after_insert(lines, &before, at, insertion)?;
    Ok(())
}

/// Borra el tramo `[from, to)`.
pub(super) fn delete(
    element: &mut Element,
    id: &str,
    from: usize,
    to: usize,
) -> Result<(), OpError> {
    let (content, lines) = text_of(element, id, "Borrar texto")?;
    let before = text::text(content);
    text::remove(content, from, to)?;
    text::after_remove(lines, &before, from, to)?;
    Ok(())
}

/// Cambia cómo se componen las líneas que toca el tramo `[from, to)`.
pub(super) fn set_lines(
    element: &mut Element,
    id: &str,
    from: usize,
    to: usize,
    style: Line,
) -> Result<(), OpError> {
    let (content, lines) = text_of(element, id, "Cambiar las líneas")?;
    let (first, last) = text::lines_touched(content, from, to)?;
    text::set_lines(lines, first, last, style);
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

/// Los tramos del elemento y los estilos de sus líneas, si es un bloque de
/// texto.
fn text_of<'a>(
    element: &'a mut Element,
    id: &str,
    what: &str,
) -> Result<(&'a mut Vec<crate::model::Run>, &'a mut Vec<Line>), OpError> {
    let kind = element.type_name();
    match element {
        Element::Text { content, lines, .. } => Ok((content, lines)),
        _ => Err(OpError::NotApplicable {
            id: id.to_owned(),
            kind,
            what: what.to_owned(),
        }),
    }
}

/// Los tramos del elemento, si es un bloque de texto.
fn content_of<'a>(
    element: &'a mut Element,
    id: &str,
    what: &str,
) -> Result<&'a mut Vec<crate::model::Run>, OpError> {
    Ok(text_of(element, id, what)?.0)
}
