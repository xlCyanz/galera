//! Comandos de edición: la única forma de cambiar un documento.
//!
//! Nada modifica el documento por su cuenta. Cada cambio es un [`Op`]
//! explícito y serializable, que se aplica a un documento y devuelve el
//! documento nuevo **y el comando que lo deshace** ([`Applied`]). Eso es lo
//! que hace posible el historial de deshacer y rehacer ([`history`]) y, más
//! adelante, la colaboración.
//!
//! # Deshacer sin perder precisión
//!
//! El comando que deshace no recalcula nada: guarda lo que había. Deshacer
//! un movimiento no resta lo que se sumó —con coma flotante, cien idas y
//! vueltas no volverían exactamente al principio—, sino que restaura una
//! copia exacta del elemento ([`Op::Restore`]). Crear se deshace eliminando;
//! eliminar, volviendo a crear en el mismo sitio; reordenar, volviendo a la
//! posición anterior.
//!
//! # Lo que no hace
//!
//! No valida el resultado: un ancho negativo es un documento que no pasa la
//! validación, y eso lo dice [`Document::validate`] al compilar, como con
//! cualquier otro documento. Aquí solo se rechaza lo que no se puede
//! aplicar: un id que no existe, una propiedad que el elemento no tiene.

pub mod history;

use serde::{Deserialize, Serialize};

use crate::model::{Document, Element, Run, Stroke, TextStyle};

/// Un cambio del documento.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "ops.ts"))]
pub enum Op {
    /// Desplaza un elemento `dx`, `dy` milímetros. Una línea mueve sus dos
    /// extremos.
    Move {
        /// El elemento.
        id: String,
        /// Hacia la derecha, en mm.
        dx: f64,
        /// Hacia abajo, en mm.
        dy: f64,
    },

    /// Cambia la caja de un elemento: posición y tamaño. `h: null` deja el
    /// alto a Typst. Una línea no tiene caja: se cambian sus extremos.
    Resize {
        /// El elemento.
        id: String,
        /// Nueva esquina superior izquierda, en mm.
        x: f64,
        /// Nueva esquina superior izquierda, en mm.
        y: f64,
        /// Nuevo ancho, en mm.
        w: f64,
        /// Nuevo alto, en mm, o `null` para el automático.
        h: Option<f64>,
    },

    /// Cambia el giro de un elemento, en grados en sentido horario.
    Rotate {
        /// El elemento.
        id: String,
        /// El giro nuevo.
        rotation: f64,
    },

    /// Cambia una propiedad de un elemento.
    SetProperty {
        /// El elemento.
        id: String,
        /// La propiedad y su valor nuevo.
        property: Property,
    },

    /// Crea un elemento en una página. Sin `index`, queda encima de todos.
    Create {
        /// La página, por su id.
        page: String,
        /// Dónde en el orden de capas: 0 es el de más abajo.
        index: Option<usize>,
        /// El elemento, con un id que no use nadie.
        element: Element,
    },

    /// Elimina un elemento.
    Delete {
        /// El elemento.
        id: String,
    },

    /// Mueve un elemento a otra posición del orden de capas de su página.
    /// Un `index` más allá del final lo deja encima de todos.
    Reorder {
        /// El elemento.
        id: String,
        /// La posición nueva: 0 es la de más abajo.
        index: usize,
    },

    /// Sustituye un elemento por una copia, con el mismo id. Es lo que
    /// deshace mover, redimensionar, girar y cambiar propiedades.
    Restore {
        /// El elemento tal como tiene que quedar.
        element: Element,
    },
}

/// Una propiedad que se puede cambiar con [`Op::SetProperty`], con su valor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "name", content = "value", rename_all = "snake_case")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "ops.ts"))]
pub enum Property {
    /// Relleno de un rectángulo o una elipse, o `null` para ninguno.
    Fill(Option<String>),
    /// Borde de un rectángulo o una elipse, o `null` para ninguno. El trazo
    /// de una línea, que no puede ser `null`.
    Stroke(Option<Stroke>),
    /// Radio de las esquinas de un rectángulo, en mm.
    Radius(f64),
    /// Contenido de un texto.
    Content(Vec<Run>),
    /// Estilo de un texto.
    Style(TextStyle),
    /// Código de un bloque de código.
    Source(String),
    /// Imagen de un elemento de imagen, por su clave en `assets`.
    Asset(String),
}

impl Property {
    /// El nombre de la propiedad, en español, para describir el comando.
    fn label(&self) -> &'static str {
        match self {
            Property::Fill(_) => "el relleno",
            Property::Stroke(_) => "el borde",
            Property::Radius(_) => "el radio",
            Property::Content(_) => "el texto",
            Property::Style(_) => "el estilo",
            Property::Source(_) => "el código",
            Property::Asset(_) => "la imagen",
        }
    }
}

/// Un comando aplicado: el documento resultante y cómo volver atrás.
#[derive(Debug, Clone, PartialEq)]
pub struct Applied {
    /// El documento con el cambio.
    pub document: Document,
    /// El comando que, aplicado a `document`, deja el documento como estaba.
    pub undo: Op,
}

/// Un comando no se puede aplicar a este documento.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum OpError {
    /// No hay ningún elemento con ese id.
    #[error("no hay ningún elemento con el id {id:?}")]
    ElementNotFound {
        /// El id que se pidió.
        id: String,
    },
    /// No hay ninguna página con ese id.
    #[error("no hay ninguna página con el id {id:?}")]
    PageNotFound {
        /// El id que se pidió.
        id: String,
    },
    /// Ya hay un elemento o una página con ese id.
    #[error("ya hay un elemento o una página con el id {id:?}")]
    DuplicateId {
        /// El id repetido.
        id: String,
    },
    /// El elemento no admite ese cambio.
    #[error("{what} no se puede aplicar a {id:?}, que es un elemento de tipo {kind}")]
    NotApplicable {
        /// El elemento.
        id: String,
        /// Su tipo.
        kind: &'static str,
        /// Qué se intentó.
        what: String,
    },
}

impl Op {
    /// Un nombre legible del comando, para el historial: «Mover r1».
    pub fn describe(&self) -> String {
        match self {
            Op::Move { id, .. } => format!("Mover {id}"),
            Op::Resize { id, .. } => format!("Redimensionar {id}"),
            Op::Rotate { id, .. } => format!("Girar {id}"),
            Op::SetProperty { id, property } => format!("Cambiar {} de {id}", property.label()),
            Op::Create { element, .. } => format!("Crear {}", element.id()),
            Op::Delete { id } => format!("Eliminar {id}"),
            Op::Reorder { id, .. } => format!("Reordenar {id}"),
            Op::Restore { element } => format!("Restaurar {}", element.id()),
        }
    }

    /// El id del elemento al que afecta.
    pub fn element_id(&self) -> &str {
        match self {
            Op::Move { id, .. }
            | Op::Resize { id, .. }
            | Op::Rotate { id, .. }
            | Op::SetProperty { id, .. }
            | Op::Delete { id }
            | Op::Reorder { id, .. } => id,
            Op::Create { element, .. } | Op::Restore { element } => element.id(),
        }
    }

    /// Aplica el comando a una copia del documento.
    ///
    /// # Errores
    ///
    /// [`OpError`] si el comando no se puede aplicar: el documento de
    /// partida no se toca.
    pub fn apply(&self, document: &Document) -> Result<Applied, OpError> {
        let mut document = document.clone();
        let undo = self.apply_in_place(&mut document)?;
        Ok(Applied { document, undo })
    }

    fn apply_in_place(&self, document: &mut Document) -> Result<Op, OpError> {
        match self {
            Op::Move { id, dx, dy } => edit(document, id, |element| {
                match element {
                    Element::Line { x, y, x2, y2, .. } => {
                        *x += dx;
                        *y += dy;
                        *x2 += dx;
                        *y2 += dy;
                    }
                    other => {
                        if let Some(base) = other.base_mut() {
                            base.x += dx;
                            base.y += dy;
                        }
                    }
                }
                Ok(())
            }),

            Op::Resize { id, x, y, w, h } => edit(document, id, |element| {
                let kind = element.type_name();
                let base = element.base_mut().ok_or_else(|| OpError::NotApplicable {
                    id: id.clone(),
                    kind,
                    what: "Redimensionar".to_owned(),
                })?;
                base.x = *x;
                base.y = *y;
                base.w = *w;
                base.h = *h;
                Ok(())
            }),

            Op::Rotate { id, rotation } => edit(document, id, |element| {
                match element {
                    Element::Line {
                        rotation: current, ..
                    } => *current = *rotation,
                    other => {
                        if let Some(base) = other.base_mut() {
                            base.rotation = *rotation;
                        }
                    }
                }
                Ok(())
            }),

            Op::SetProperty { id, property } => {
                edit(document, id, |element| set_property(element, id, property))
            }

            Op::Create {
                page,
                index,
                element,
            } => {
                let id = element.id();
                if document.element(id).is_some() || document.pages.iter().any(|p| p.id == id) {
                    return Err(OpError::DuplicateId { id: id.to_owned() });
                }
                let target = document
                    .pages
                    .iter_mut()
                    .find(|candidate| candidate.id == *page)
                    .ok_or_else(|| OpError::PageNotFound { id: page.clone() })?;
                let at = index
                    .unwrap_or(target.elements.len())
                    .min(target.elements.len());
                target.elements.insert(at, element.clone());
                Ok(Op::Delete { id: id.to_owned() })
            }

            Op::Delete { id } => {
                let (page, index) = locate(document, id)?;
                let element = document.pages[page].elements.remove(index);
                Ok(Op::Create {
                    page: document.pages[page].id.clone(),
                    index: Some(index),
                    element,
                })
            }

            Op::Reorder { id, index } => {
                let (page, from) = locate(document, id)?;
                let elements = &mut document.pages[page].elements;
                let element = elements.remove(from);
                let to = (*index).min(elements.len());
                elements.insert(to, element);
                Ok(Op::Reorder {
                    id: id.clone(),
                    index: from,
                })
            }

            Op::Restore { element } => {
                let (page, index) = locate(document, element.id())?;
                let previous =
                    std::mem::replace(&mut document.pages[page].elements[index], element.clone());
                Ok(Op::Restore { element: previous })
            }
        }
    }
}

/// Cambia un elemento en su sitio y devuelve el [`Op::Restore`] con cómo
/// estaba. Si `change` falla, el elemento queda como estaba.
fn edit(
    document: &mut Document,
    id: &str,
    change: impl FnOnce(&mut Element) -> Result<(), OpError>,
) -> Result<Op, OpError> {
    let (page, index) = locate(document, id)?;
    let element = &mut document.pages[page].elements[index];
    let previous = element.clone();
    if let Err(error) = change(element) {
        *element = previous;
        return Err(error);
    }
    Ok(Op::Restore { element: previous })
}

/// En qué página y en qué posición está un elemento.
fn locate(document: &Document, id: &str) -> Result<(usize, usize), OpError> {
    document
        .pages
        .iter()
        .enumerate()
        .find_map(|(page, content)| {
            content
                .elements
                .iter()
                .position(|element| element.id() == id)
                .map(|index| (page, index))
        })
        .ok_or_else(|| OpError::ElementNotFound { id: id.to_owned() })
}

fn set_property(element: &mut Element, id: &str, property: &Property) -> Result<(), OpError> {
    let kind = element.type_name();
    let not_applicable = || OpError::NotApplicable {
        id: id.to_owned(),
        kind,
        what: format!("Cambiar {}", property.label()),
    };

    match (element, property) {
        (Element::Rect { fill, .. } | Element::Ellipse { fill, .. }, Property::Fill(value)) => {
            fill.clone_from(value);
        }
        (
            Element::Rect { stroke, .. } | Element::Ellipse { stroke, .. },
            Property::Stroke(value),
        ) => {
            stroke.clone_from(value);
        }
        (Element::Line { stroke, .. }, Property::Stroke(Some(value))) => *stroke = value.clone(),
        (Element::Rect { radius, .. }, Property::Radius(value)) => *radius = *value,
        (Element::Text { content, .. }, Property::Content(value)) => content.clone_from(value),
        (Element::Text { style, .. }, Property::Style(value)) => *style = value.clone(),
        (Element::Code { source, .. }, Property::Source(value)) => source.clone_from(value),
        (Element::Image { asset, .. }, Property::Asset(value)) => asset.clone_from(value),
        _ => return Err(not_applicable()),
    }
    Ok(())
}

#[cfg(test)]
mod tests;
