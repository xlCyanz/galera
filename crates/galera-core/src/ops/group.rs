//! Cambiar varios elementos a la vez, y meterlos y sacarlos de un grupo.
//!
//! Con varios elementos seleccionados, el lienzo enseña **una sola caja**:
//! la que los contiene a todos. Moverla los mueve a todos y estirarla los
//! estira a todos, y eso tiene que ser **un único cambio del documento**:
//! una compilación y un paso del historial, no uno por elemento. De eso se
//! encarga [`Op::Batch`].
//!
//! Qué le toca a cada elemento cuando se estira la caja conjunta es la
//! cuenta que vive aquí (principio 5): la interfaz manda la caja de antes y
//! la de después, y recibe el comando que hay que aplicar.
//!
//! # Cómo se reparte
//!
//! La caja conjunta define una transformación afín —un desplazamiento y una
//! escala por eje— y cada elemento la recibe entera: su posición se mueve
//! con ella y su tamaño se multiplica por la escala.
//!
//! - **Una línea** no tiene caja: se escalan sus dos extremos.
//! - **Un alto automático sigue siendo automático.** Un texto con `h: null`
//!   mide lo que midan sus líneas, y eso solo lo sabe Typst (principio 3):
//!   estirar el grupo a lo alto cambia el de los demás, pero el suyo lo
//!   sigue decidiendo la composición.
//! - **El giro no se toca.** Estirar de un lado una caja girada no se puede
//!   representar con una caja y un ángulo, así que se escala su caja sin
//!   girar y se queda con el giro que tenía.

use crate::layout::MmRect;
use crate::model::{Document, Element, ElementBox, Layer, is_valid_id};
use crate::ops::{Op, OpError};

/// Desde cuánto una medida cuenta como cero, en mm.
const TINY: f64 = 1e-9;

/// El comando que mueve todos esos elementos `dx`, `dy` milímetros.
///
/// Es un [`Op::Batch`] de movimientos: si uno falla no se mueve ninguno.
pub fn translate(ids: &[String], dx: f64, dy: f64) -> Op {
    Op::Batch {
        ops: ids
            .iter()
            .map(|id| Op::Move {
                id: id.clone(),
                dx,
                dy,
            })
            .collect(),
    }
}

/// El comando que lleva esos elementos de la caja conjunta `from` a la caja
/// `to`.
///
/// # Errores
///
/// [`OpError::ElementNotFound`] si algún id no está en el documento.
pub fn scale(document: &Document, ids: &[String], from: MmRect, to: MmRect) -> Result<Op, OpError> {
    let (sx, sy) = (factor(from.w, to.w), factor(from.h, to.h));
    let at_x = |x: f64| to.x + (x - from.x) * sx;
    let at_y = |y: f64| to.y + (y - from.y) * sy;

    let mut ops = Vec::with_capacity(ids.len());
    for id in ids {
        let element = document
            .element(id)
            .ok_or_else(|| OpError::ElementNotFound { id: id.clone() })?;
        ops.push(match element {
            Element::Line { .. } => {
                let mut scaled = element.clone();
                if let Element::Line { x, y, x2, y2, .. } = &mut scaled {
                    (*x, *y) = (at_x(*x), at_y(*y));
                    (*x2, *y2) = (at_x(*x2), at_y(*y2));
                }
                // Una línea no se puede redimensionar con `Op::Resize`: se
                // deja tal como queda.
                Op::Restore { element: scaled }
            }
            other => {
                let base = other.base().ok_or_else(|| OpError::NotApplicable {
                    id: id.clone(),
                    kind: other.type_name(),
                    what: "Redimensionar".to_owned(),
                })?;
                Op::Resize {
                    id: id.clone(),
                    x: at_x(base.x),
                    y: at_y(base.y),
                    w: base.w * sx,
                    h: base.h.map(|h| h * sy),
                }
            }
        });
    }
    Ok(Op::Batch { ops })
}

/// Cuánto se multiplica un eje. Una caja sin tamaño no escala nada: solo se
/// mueve.
fn factor(from: f64, to: f64) -> f64 {
    if from.abs() < TINY { 1.0 } else { to / from }
}

/// Mete los elementos en un grupo nuevo con la caja `rect`.
///
/// Devuelve el comando que lo deshace: uno que quita el grupo y vuelve a
/// poner cada elemento donde estaba, **tal como estaba**, sin recalcular
/// nada.
///
/// # Errores
///
/// - [`OpError::ElementNotFound`] si algún id no está en el documento.
/// - [`OpError::DuplicateId`] si el id del grupo ya lo usa alguien, o
///   [`OpError::InvalidId`] si no vale para el código generado.
/// - [`OpError::NotApplicable`] si no hay al menos dos elementos, si están
///   en páginas distintas o si alguno está dentro de otro grupo.
pub(super) fn apply_group(
    document: &mut Document,
    ids: &[String],
    id: &str,
    rect: MmRect,
) -> Result<Op, OpError> {
    if !is_valid_id(id) {
        return Err(OpError::InvalidId { id: id.to_owned() });
    }
    if document.element(id).is_some() || document.pages.iter().any(|page| page.id == id) {
        return Err(OpError::DuplicateId { id: id.to_owned() });
    }
    if ids.len() < 2 {
        return Err(not_applicable(
            id,
            "Agrupar",
            "hacen falta al menos dos elementos",
        ));
    }

    // Todos en la misma página y en su primer nivel: un hijo de otro grupo
    // no se puede sacar de donde está sin mover lo demás.
    let mut page = None;
    let mut positions = Vec::with_capacity(ids.len());
    for one in ids {
        let (at_page, index) = top_level(document, one)?;
        if *page.get_or_insert(at_page) != at_page {
            return Err(not_applicable(id, "Agrupar", "están en páginas distintas"));
        }
        positions.push(index);
    }
    let page = page.unwrap_or_default();

    // El grupo se queda en la capa del que estaba más arriba, y los hijos
    // conservan su orden.
    let mut ordered = positions.clone();
    ordered.sort_unstable();
    let top = ordered.last().copied().unwrap_or_default();

    // Cómo estaba todo, para el comando que lo deshace.
    let before: Vec<(usize, Element)> = ordered
        .iter()
        .map(|index| (*index, document.pages[page].elements[*index].clone()))
        .collect();

    let mut children: Vec<Element> = ordered
        .iter()
        .map(|index| document.pages[page].elements[*index].clone())
        .collect();
    for child in &mut children {
        offset(child, -rect.x, -rect.y);
    }

    // Se quitan de atrás adelante para que los índices sigan valiendo.
    for index in ordered.iter().rev() {
        document.pages[page].elements.remove(*index);
    }
    let at = top + 1 - ids.len();
    document.pages[page].elements.insert(
        at,
        Element::Group {
            base: ElementBox {
                id: id.to_owned(),
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: Some(rect.h),
                rotation: 0.0,
                layer: Layer::default(),
            },
            children,
        },
    );

    Ok(restore(document, page, id, before))
}

/// Saca los hijos de un grupo y lo quita.
///
/// # Errores
///
/// - [`OpError::ElementNotFound`] si no hay ningún elemento con ese id.
/// - [`OpError::NotApplicable`] si no es un grupo o está dentro de otro.
pub(super) fn apply_ungroup(document: &mut Document, id: &str) -> Result<Op, OpError> {
    let (page, index) = top_level(document, id)?;
    let Element::Group { base, children } = document.pages[page].elements[index].clone() else {
        return Err(not_applicable(id, "Desagrupar", "no es un grupo"));
    };

    let mut freed = children;
    for child in &mut freed {
        offset(child, base.x, base.y);
        if base.rotation != 0.0 {
            turn(child, &base);
        }
    }

    let before = vec![(index, document.pages[page].elements[index].clone())];
    document.pages[page].elements.remove(index);
    let ids: Vec<String> = freed.iter().map(|child| child.id().to_owned()).collect();
    for (offset_index, child) in freed.into_iter().enumerate() {
        document.pages[page]
            .elements
            .insert(index + offset_index, child);
    }

    Ok(restore_many(document, page, &ids, before))
}

/// Mueve un elemento `dx`, `dy` milímetros, sea del tipo que sea.
fn offset(element: &mut Element, dx: f64, dy: f64) {
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
}

/// Aplica a un hijo el giro que llevaba su grupo: gira su centro alrededor
/// del centro del grupo y le suma el ángulo.
///
/// Girar la caja de un elemento es girarla sobre su propio centro, así que
/// esto es exacto mientras se sepa dónde está ese centro. Con un alto
/// automático no se sabe hasta componer, y entonces se gira su esquina: el
/// elemento puede quedar desplazado, que es lo que pasa al desagrupar un
/// grupo girado con un texto de alto automático dentro.
fn turn(element: &mut Element, group: &ElementBox) {
    let (cx, cy) = (
        group.x + group.w / 2.0,
        group.y + group.h.unwrap_or(0.0) / 2.0,
    );
    let (sin, cos) = group.rotation.to_radians().sin_cos();
    let around = |x: f64, y: f64| {
        let (dx, dy) = (x - cx, y - cy);
        (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
    };

    match element {
        Element::Line {
            x,
            y,
            x2,
            y2,
            rotation,
            ..
        } => {
            (*x, *y) = around(*x, *y);
            (*x2, *y2) = around(*x2, *y2);
            *rotation += group.rotation;
        }
        other => {
            let Some(base) = other.base_mut() else {
                return;
            };
            let (half_w, half_h) = (base.w / 2.0, base.h.unwrap_or(0.0) / 2.0);
            let (center_x, center_y) = around(base.x + half_w, base.y + half_h);
            base.x = center_x - half_w;
            base.y = center_y - half_h;
            base.rotation += group.rotation;
        }
    }
}

/// El elemento en el primer nivel de una página: su página y su posición.
fn top_level(document: &Document, id: &str) -> Result<(usize, usize), OpError> {
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
        .ok_or_else(|| {
            if document.element(id).is_some() {
                not_applicable(id, "Agrupar", "está dentro de otro grupo")
            } else {
                OpError::ElementNotFound { id: id.to_owned() }
            }
        })
}

/// El comando que quita `id` y vuelve a poner los elementos como estaban.
fn restore(document: &Document, page: usize, id: &str, before: Vec<(usize, Element)>) -> Op {
    restore_many(document, page, &[id.to_owned()], before)
}

/// El comando que quita esos elementos y vuelve a poner los de `before`.
///
/// No recalcula nada: guarda una copia exacta de lo que había, así que
/// deshacer deja el documento como estaba hasta el último decimal.
fn restore_many(
    document: &Document,
    page: usize,
    ids: &[String],
    before: Vec<(usize, Element)>,
) -> Op {
    let mut ops: Vec<Op> = ids.iter().map(|id| Op::Delete { id: id.clone() }).collect();
    let name = document
        .pages
        .get(page)
        .map(|one| one.id.clone())
        .unwrap_or_default();
    ops.extend(before.into_iter().map(|(index, element)| Op::Create {
        page: name.clone(),
        index: Some(index),
        element,
    }));
    Op::Batch { ops }
}

/// Un comando que no se puede aplicar a esto.
fn not_applicable(id: &str, what: &str, why: &str) -> OpError {
    OpError::NotApplicable {
        id: id.to_owned(),
        kind: "group",
        what: format!("{what}: {why}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Document;

    /// Una página con un rectángulo, un texto de alto automático y una
    /// línea, todos dentro de la caja conjunta 10,10 → 110,60.
    fn document() -> Document {
        let json = r##"{
          "version": 1,
          "meta": { "title": "Grupo" },
          "fonts": ["fonts/Inter-Regular.ttf"],
          "pages": [
            {
              "id": "p1",
              "size": { "width": 210, "height": 297 },
              "elements": [
                { "type": "rect", "id": "r1", "x": 10, "y": 10, "w": 40, "h": 20,
                  "fill": "#ff0000" },
                { "type": "text", "id": "t1", "x": 60, "y": 10, "w": 50, "h": null,
                  "content": [{ "text": "Hola" }],
                  "style": { "font": "Inter", "size": 12, "color": "#000000" } },
                { "type": "line", "id": "l1", "x": 10, "y": 50, "x2": 110, "y2": 60,
                  "stroke": { "color": "#000000", "width": 1 } }
              ]
            }
          ]
        }"##;
        Document::from_json_str(json).expect("es un documento")
    }

    /// La caja conjunta de esos tres elementos, tal como la vería el lienzo.
    fn joint() -> MmRect {
        MmRect {
            x: 10.0,
            y: 10.0,
            w: 100.0,
            h: 50.0,
        }
    }

    fn ids() -> Vec<String> {
        ["r1", "t1", "l1"].map(str::to_owned).to_vec()
    }

    /// Los comandos de un `Op::Batch`.
    fn ops(op: &Op) -> &[Op] {
        match op {
            Op::Batch { ops } => ops,
            other => panic!("no es un comando compuesto: {other:?}"),
        }
    }

    #[test]
    fn moving_the_group_moves_every_element_in_one_command() {
        let op = translate(&ids(), 5.0, -2.0);
        assert_eq!(ops(&op).len(), 3);
        assert_eq!(
            ops(&op)[0],
            Op::Move {
                id: "r1".to_owned(),
                dx: 5.0,
                dy: -2.0
            }
        );

        let applied = op.apply(&document()).expect("se aplica");
        let moved = applied
            .document
            .pages
            .first()
            .and_then(|page| page.elements.first())
            .and_then(|element| element.base())
            .map(|base| (base.x, base.y));
        assert_eq!(moved, Some((15.0, 8.0)));
    }

    #[test]
    fn stretching_the_group_scales_positions_and_sizes() {
        // El doble de ancho, el mismo alto, desde el mismo sitio.
        let wider = MmRect {
            w: 200.0,
            ..joint()
        };
        let op = scale(&document(), &ids(), joint(), wider).expect("se puede");

        assert_eq!(
            ops(&op)[0],
            Op::Resize {
                id: "r1".to_owned(),
                x: 10.0,
                y: 10.0,
                w: 80.0,
                h: Some(20.0)
            }
        );
        // El texto estaba a 50 mm del borde izquierdo del grupo: ahora a 100.
        assert_eq!(
            ops(&op)[1],
            Op::Resize {
                id: "t1".to_owned(),
                x: 110.0,
                y: 10.0,
                w: 100.0,
                h: None
            }
        );
    }

    /// El criterio de la tarea: un alto automático lo sigue midiendo Typst.
    #[test]
    fn an_automatic_height_stays_automatic() {
        let taller = MmRect {
            h: 100.0,
            ..joint()
        };
        let op = scale(&document(), &ids(), joint(), taller).expect("se puede");

        match &ops(&op)[1] {
            Op::Resize { id, h, .. } => {
                assert_eq!(id, "t1");
                assert_eq!(*h, None, "el alto sigue siendo el que mida Typst");
            }
            other => panic!("se esperaba un redimensionado: {other:?}"),
        }
    }

    #[test]
    fn a_line_is_scaled_by_its_two_ends() {
        let wider = MmRect {
            w: 200.0,
            ..joint()
        };
        let applied = scale(&document(), &ids(), joint(), wider)
            .expect("se puede")
            .apply(&document())
            .expect("se aplica");

        let line = applied
            .document
            .pages
            .first()
            .and_then(|page| page.elements.iter().find(|element| element.id() == "l1"))
            .cloned()
            .expect("sigue ahí");
        match line {
            Element::Line { x, y, x2, y2, .. } => {
                assert_eq!((x, y), (10.0, 50.0));
                assert_eq!((x2, y2), (210.0, 60.0));
            }
            other => panic!("es una línea: {other:?}"),
        }
    }

    #[test]
    fn moving_the_group_without_stretching_it_keeps_every_size() {
        let elsewhere = MmRect {
            x: 50.0,
            y: 100.0,
            ..joint()
        };
        let applied = scale(&document(), &ids(), joint(), elsewhere)
            .expect("se puede")
            .apply(&document())
            .expect("se aplica");

        let rect = applied
            .document
            .pages
            .first()
            .and_then(|page| page.elements.first())
            .and_then(|element| element.base())
            .cloned()
            .expect("sigue ahí");
        assert_eq!((rect.x, rect.y), (50.0, 100.0));
        assert_eq!((rect.w, rect.h), (40.0, Some(20.0)));
    }

    /// Un grupo sin tamaño en un eje no multiplica por infinito: solo se
    /// mueve.
    #[test]
    fn a_group_with_no_width_only_moves() {
        let flat = MmRect {
            x: 10.0,
            y: 10.0,
            w: 0.0,
            h: 50.0,
        };
        let op = scale(
            &document(),
            &["r1".to_owned()],
            flat,
            MmRect { x: 30.0, ..flat },
        )
        .expect("se puede");
        assert_eq!(
            ops(&op)[0],
            Op::Resize {
                id: "r1".to_owned(),
                x: 30.0,
                y: 10.0,
                w: 40.0,
                h: Some(20.0)
            }
        );
    }

    #[test]
    fn an_id_that_is_not_there_changes_nothing() {
        let error =
            scale(&document(), &["fantasma".to_owned()], joint(), joint()).expect_err("no está");
        assert!(matches!(error, OpError::ElementNotFound { .. }));
    }

    /// Deshacer el estirón devuelve el grupo exactamente como estaba.
    #[test]
    fn undoing_a_group_change_restores_every_element() {
        let before = document();
        let wider = MmRect {
            w: 200.0,
            h: 90.0,
            ..joint()
        };
        let applied = scale(&before, &ids(), joint(), wider)
            .expect("se puede")
            .apply(&before)
            .expect("se aplica");
        let back = applied.undo.apply(&applied.document).expect("se deshace");

        assert_eq!(back.document, before);
    }
}
