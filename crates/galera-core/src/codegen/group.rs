//! Cuerpo de un grupo: un bloque del tamaño del grupo con sus hijos dentro.
//!
//! El grupo se coloca como cualquier otro elemento —lo hace
//! [`super::emit_element`]: su `place`, su rotación y su etiqueta—, y su
//! cuerpo es un `block` del tamaño del grupo. Dentro van los hijos, cada uno
//! con su propio `place`, que Typst cuenta **desde la esquina del bloque**:
//! por eso las coordenadas de los hijos son relativas al grupo y agrupar no
//! mueve nada de sitio.
//!
//! ```text
//! #place(top + left, dx: 20mm, dy: 30mm)[#block(width: 80mm, height: 40mm)[
//!   #place(top + left, dx: 0mm, dy: 0mm)[…] <el-hijo-1>
//!   #place(top + left, dx: 50mm, dy: 10mm)[…] <el-hijo-2>
//! ]] <el-grupo>
//! ```
//!
//! Como el cuerpo del grupo vuelve a pasar por `emit_element`, un grupo
//! dentro de otro sale solo: cada nivel es un bloque más.
//!
//! # Lo que no se emite
//!
//! Un hijo oculto no se emite, igual que en la página. Un grupo oculto no
//! emite ni el bloque ni nada de lo que lleva dentro, y eso lo decide quien
//! recorre la página.

use crate::model::{Document, Element, ElementBox};

use super::{CodegenError, emit_element, millimeters};

/// Prefijo de la etiqueta del bloque de un grupo: `<grp-ID>`.
pub(crate) const GROUP_PREFIX: &str = "grp-";

/// Escribe el cuerpo de un grupo: el bloque y, dentro, sus hijos.
pub(super) fn emit_group(
    base: &ElementBox,
    children: &[Element],
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    out.push_str(&format!("#block(width: {}", millimeters(base.w)));
    // Sin alto fijo, el bloque mide lo que ocupe su contenido; con hijos
    // colocados con `place`, eso es cero, así que el grupo siempre lo lleva.
    if let Some(h) = base.h {
        out.push_str(&format!(", height: {}", millimeters(h)));
    }
    out.push_str(")[\n");

    for child in children.iter().filter(|one| !one.layer().is_hidden()) {
        emit_element(child, document, out)?;
    }

    // El bloque va etiquetado aparte: al leer la composición, esa marca es
    // lo que distingue el grupo de un bloque cualquiera, y por ella se sabe
    // que dentro hay elementos con caja propia (ver `layout`).
    out.push_str(&format!("] <{GROUP_PREFIX}{}>", base.id));
    Ok(())
}
