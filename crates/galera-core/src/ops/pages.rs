//! Añadir, copiar, mover, redimensionar y quitar páginas.
//!
//! Una página es la unidad más grande del documento y, como todo lo demás,
//! solo cambia con comandos ([`Op`]), así que ⌘Z deshace cualquiera de estas
//! cosas.
//!
//! # Quitar y deshacer
//!
//! Quitar una página se deshace **volviendo a meter la misma página**, con
//! sus elementos tal como estaban: no se recalcula nada. Y no se puede
//! quitar la última: un documento sin páginas no es un documento.
//!
//! # Copiar
//!
//! Copiar una página no puede repetir sus ids, que son únicos en todo el
//! documento: a cada elemento de la copia se le busca uno libre a partir del
//! suyo (`titulo` → `titulo-2`), también a los que van dentro de un grupo.
//! Así la copia es igual pero con nombres propios, y lo que se refiera a un
//! elemento por su id sigue señalando al original.

use crate::model::{Document, Element, Page, PageSize, is_valid_id};
use crate::ops::{Op, OpError};

/// Mete una página en el documento, en `index` o al final.
///
/// # Errores
///
/// - [`OpError::InvalidId`] si el id de la página no vale para el código
///   generado, o [`OpError::DuplicateId`] si ya lo usa alguien.
pub(super) fn apply_insert(
    document: &mut Document,
    index: Option<usize>,
    page: &Page,
) -> Result<Op, OpError> {
    for id in ids_of(page) {
        check_free(document, &id)?;
    }
    let at = index
        .unwrap_or(document.pages.len())
        .min(document.pages.len());
    document.pages.insert(at, page.clone());
    Ok(Op::RemovePage {
        id: page.id.clone(),
    })
}

/// Quita una página con todo lo que lleva.
///
/// # Errores
///
/// - [`OpError::PageNotFound`] si no hay ninguna página con ese id.
/// - [`OpError::NotApplicable`] si es la última que queda.
pub(super) fn apply_remove(document: &mut Document, id: &str) -> Result<Op, OpError> {
    let at = locate(document, id)?;
    if document.pages.len() == 1 {
        return Err(OpError::NotApplicable {
            id: id.to_owned(),
            kind: "page",
            what: "Quitar la última página".to_owned(),
        });
    }
    let page = document.pages.remove(at);
    Ok(Op::InsertPage {
        index: Some(at),
        page,
    })
}

/// Copia una página entera detrás de la original, con ids nuevos.
///
/// # Errores
///
/// - [`OpError::PageNotFound`] si no hay ninguna página con ese id.
/// - [`OpError::InvalidId`] o [`OpError::DuplicateId`] si el id de la copia
///   no vale o ya lo usa alguien.
pub(super) fn apply_duplicate(document: &mut Document, id: &str, to: &str) -> Result<Op, OpError> {
    let at = locate(document, id)?;
    check_free(document, to)?;

    let mut copy = document.pages[at].clone();
    copy.id = to.to_owned();
    // Los ids de los elementos, uno a uno: los que ya están cogidos son los
    // del documento más los que se vayan dando en esta misma copia.
    let mut taken: Vec<String> = document
        .pages
        .iter()
        .flat_map(ids_of)
        .chain(std::iter::once(to.to_owned()))
        .collect();
    for element in &mut copy.elements {
        rename(element, &mut taken);
    }

    document.pages.insert(at + 1, copy);
    Ok(Op::RemovePage { id: to.to_owned() })
}

/// Cambia una página de sitio.
///
/// # Errores
///
/// [`OpError::PageNotFound`] si no hay ninguna página con ese id.
pub(super) fn apply_reorder(
    document: &mut Document,
    id: &str,
    index: usize,
) -> Result<Op, OpError> {
    let from = locate(document, id)?;
    let to = index.min(document.pages.len().saturating_sub(1));
    let page = document.pages.remove(from);
    document.pages.insert(to, page);
    Ok(Op::ReorderPage {
        id: id.to_owned(),
        index: from,
    })
}

/// Cambia el tamaño de una página.
///
/// # Errores
///
/// - [`OpError::PageNotFound`] si no hay ninguna página con ese id.
/// - [`OpError::InvalidPageSize`] si alguna medida no es mayor que cero, o
///   no es un número.
pub(super) fn apply_resize(
    document: &mut Document,
    id: &str,
    size: &PageSize,
) -> Result<Op, OpError> {
    let at = locate(document, id)?;
    let valid = |value: f64| value.is_finite() && value > 0.0;
    if !valid(size.width) || !valid(size.height) {
        return Err(OpError::InvalidPageSize {
            width: size.width,
            height: size.height,
        });
    }
    let before = std::mem::replace(&mut document.pages[at].size, size.clone());
    Ok(Op::ResizePage {
        id: id.to_owned(),
        size: before,
    })
}

/// Le da al elemento —y a lo que lleve dentro— un id libre parecido al suyo.
fn rename(element: &mut Element, taken: &mut Vec<String>) {
    let id = free(element.id(), taken);
    taken.push(id.clone());
    element.set_id(id);
    if let Element::Group { children, .. } = element {
        for child in children {
            rename(child, taken);
        }
    }
}

/// El primer id libre a partir de este: `titulo`, `titulo-2`, `titulo-3`…
fn free(id: &str, taken: &[String]) -> String {
    // Si ya lleva un número al final, se cuenta desde su raíz: de `hoja-2`
    // salen `hoja-3` y `hoja-4`, y no `hoja-2-2`.
    let root = match id.rsplit_once('-') {
        Some((root, tail)) if !root.is_empty() && tail.parse::<usize>().is_ok() => root,
        _ => id,
    };
    for number in 2.. {
        let candidate = format!("{root}-{number}");
        if !taken.iter().any(|one| one == &candidate) {
            return candidate;
        }
    }
    // El bucle no termina de otra forma.
    id.to_owned()
}

/// Los ids de una página: el suyo y los de todo lo que lleva dentro.
fn ids_of(page: &Page) -> Vec<String> {
    let mut ids = vec![page.id.clone()];
    for element in &page.elements {
        ids.extend(element.tree().into_iter().map(|one| one.id().to_owned()));
    }
    ids
}

/// Dónde está la página con ese id.
fn locate(document: &Document, id: &str) -> Result<usize, OpError> {
    document
        .pages
        .iter()
        .position(|page| page.id == id)
        .ok_or_else(|| OpError::PageNotFound { id: id.to_owned() })
}

/// Que un id valga para el código generado y no lo use nadie más.
fn check_free(document: &Document, id: &str) -> Result<(), OpError> {
    if !is_valid_id(id) {
        return Err(OpError::InvalidId { id: id.to_owned() });
    }
    if document.element(id).is_some() || document.pages.iter().any(|page| page.id == id) {
        return Err(OpError::DuplicateId { id: id.to_owned() });
    }
    Ok(())
}
