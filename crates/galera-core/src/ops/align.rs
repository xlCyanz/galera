//! Alinear y repartir varios elementos.
//!
//! Alinear es llevar un borde —o el centro— de cada elemento a la misma
//! línea, y repartir es dejar el mismo hueco entre unos y otros. Las dos
//! cosas son cuentas sobre las cajas que se ven, así que viven en el núcleo
//! (principio 5): la interfaz dice qué se quiere y recibe el comando.
//!
//! # Respecto a qué
//!
//! Sin decir nada, respecto a **la selección**: la línea a la que se alinea
//! sale de la caja que contiene a todos, así que el que ya estaba más a la
//! izquierda no se mueve. Con un rectángulo —la página—, respecto a **él**,
//! y entonces alinear un solo elemento también tiene sentido.
//!
//! # Un solo paso
//!
//! Sale un [`Op::Batch`] de movimientos, y los que no se mueven no entran:
//! alinear cinco elementos es un cambio del documento, una compilación y un
//! paso del historial. Como son movimientos, valen para cualquier tipo de
//! elemento, también para una línea o para un texto de alto automático.

use serde::{Deserialize, Serialize};

use crate::layout::MmRect;
use crate::ops::Op;

/// Un elemento al que alinear, con la caja que se ve.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    /// El elemento.
    pub id: String,
    /// Su caja, ya girada, en mm de la página.
    pub rect: MmRect,
}

/// A qué línea se lleva cada elemento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "align.ts"))]
#[serde(rename_all = "snake_case")]
pub enum Alignment {
    /// Los bordes izquierdos.
    Left,
    /// Los centros, en horizontal.
    CenterX,
    /// Los bordes derechos.
    Right,
    /// Los bordes de arriba.
    Top,
    /// Los centros, en vertical.
    Middle,
    /// Los bordes de abajo.
    Bottom,
}

/// En qué eje se reparte el espacio.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "align.ts"))]
#[serde(rename_all = "snake_case")]
pub enum Spread {
    /// De izquierda a derecha.
    Horizontal,
    /// De arriba abajo.
    Vertical,
}

/// El comando que alinea esos elementos.
///
/// `area` es respecto a qué se alinea; sin ella, respecto a la caja que los
/// contiene a todos.
pub fn align(items: &[Item], how: Alignment, area: Option<MmRect>) -> Op {
    let area = area.or_else(|| bounds(items));
    let Some(area) = area else {
        return Op::Batch { ops: Vec::new() };
    };

    let moves = items.iter().map(|item| {
        let rect = item.rect;
        match how {
            Alignment::Left => (area.x - rect.x, 0.0),
            Alignment::CenterX => (area.x + (area.w - rect.w) / 2.0 - rect.x, 0.0),
            Alignment::Right => (area.x + area.w - rect.w - rect.x, 0.0),
            Alignment::Top => (0.0, area.y - rect.y),
            Alignment::Middle => (0.0, area.y + (area.h - rect.h) / 2.0 - rect.y),
            Alignment::Bottom => (0.0, area.y + area.h - rect.h - rect.y),
        }
    });

    batch(items.iter().map(|item| item.id.clone()).zip(moves))
}

/// El comando que reparte esos elementos con el mismo hueco entre ellos.
///
/// Sin `area`, los dos de los extremos se quedan donde están y se reparte lo
/// que hay entre ellos; con un rectángulo, se reparte dentro de él, del
/// borde al borde. Si no caben, los huecos salen negativos: se solapan en
/// vez de salirse del sitio que se les da.
pub fn spread(items: &[Item], axis: Spread, area: Option<MmRect>) -> Op {
    if items.len() < 2 {
        return Op::Batch { ops: Vec::new() };
    }
    let area = area.or_else(|| bounds(items));
    let Some(area) = area else {
        return Op::Batch { ops: Vec::new() };
    };

    // De menos a más en el eje; los empates, por el orden en que llegaron.
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by(|one, another| {
        along(items[*one].rect, axis).total_cmp(&along(items[*another].rect, axis))
    });

    let (start, length) = match axis {
        Spread::Horizontal => (area.x, area.w),
        Spread::Vertical => (area.y, area.h),
    };
    let used: f64 = items.iter().map(|item| size(item.rect, axis)).sum();
    #[expect(
        clippy::cast_precision_loss,
        reason = "el número de elementos cabe de sobra en un f64"
    )]
    let gap = (length - used) / (items.len() - 1) as f64;

    let mut deltas = vec![(0.0, 0.0); items.len()];
    let mut at = start;
    for index in order {
        let rect = items[index].rect;
        let delta = at - along(rect, axis);
        deltas[index] = match axis {
            Spread::Horizontal => (delta, 0.0),
            Spread::Vertical => (0.0, delta),
        };
        at += size(rect, axis) + gap;
    }

    batch(items.iter().map(|item| item.id.clone()).zip(deltas))
}

/// La caja que contiene a todas, o `None` si no hay ninguna.
pub fn bounds(items: &[Item]) -> Option<MmRect> {
    let first = items.first()?.rect;
    let (mut left, mut top) = (first.x, first.y);
    let (mut right, mut bottom) = (first.x + first.w, first.y + first.h);
    for item in items {
        left = left.min(item.rect.x);
        top = top.min(item.rect.y);
        right = right.max(item.rect.x + item.rect.w);
        bottom = bottom.max(item.rect.y + item.rect.h);
    }
    Some(MmRect {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
    })
}

/// Dónde empieza la caja en el eje.
fn along(rect: MmRect, axis: Spread) -> f64 {
    match axis {
        Spread::Horizontal => rect.x,
        Spread::Vertical => rect.y,
    }
}

/// Cuánto mide la caja en el eje.
fn size(rect: MmRect, axis: Spread) -> f64 {
    match axis {
        Spread::Horizontal => rect.w,
        Spread::Vertical => rect.h,
    }
}

/// Los movimientos que de verdad mueven algo, como un solo comando.
fn batch(moves: impl Iterator<Item = (String, (f64, f64))>) -> Op {
    Op::Batch {
        ops: moves
            .filter(|(_, (dx, dy))| *dx != 0.0 || *dy != 0.0)
            .map(|(id, (dx, dy))| Op::Move { id, dx, dy })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, x: f64, y: f64, w: f64, h: f64) -> Item {
        Item {
            id: id.to_owned(),
            rect: MmRect { x, y, w, h },
        }
    }

    /// Tres cajas de tamaños distintos, repartidas a ojo.
    fn three() -> Vec<Item> {
        vec![
            item("a", 10.0, 10.0, 40.0, 20.0),
            item("b", 70.0, 30.0, 20.0, 40.0),
            item("c", 100.0, 5.0, 30.0, 10.0),
        ]
    }

    /// Los movimientos de un comando compuesto, por id.
    fn moves(op: &Op) -> Vec<(&str, f64, f64)> {
        match op {
            Op::Batch { ops } => ops
                .iter()
                .map(|one| match one {
                    Op::Move { id, dx, dy } => (id.as_str(), *dx, *dy),
                    other => panic!("se esperaba un movimiento: {other:?}"),
                })
                .collect(),
            other => panic!("no es un comando compuesto: {other:?}"),
        }
    }

    /// El criterio de la tarea: las seis alineaciones, con posiciones
    /// conocidas.
    #[test]
    fn the_six_alignments_line_up_the_selection() {
        // La caja conjunta va de (10, 5) a (130, 70).
        assert_eq!(
            moves(&align(&three(), Alignment::Left, None)),
            vec![("b", -60.0, 0.0), ("c", -90.0, 0.0)],
            "a ya estaba a la izquierda del todo"
        );
        assert_eq!(
            moves(&align(&three(), Alignment::Right, None)),
            vec![("a", 80.0, 0.0), ("b", 40.0, 0.0)]
        );
        // El centro de la caja conjunta está en x = 70.
        assert_eq!(
            moves(&align(&three(), Alignment::CenterX, None)),
            vec![("a", 40.0, 0.0), ("b", -10.0, 0.0), ("c", -45.0, 0.0)]
        );
        assert_eq!(
            moves(&align(&three(), Alignment::Top, None)),
            vec![("a", 0.0, -5.0), ("b", 0.0, -25.0)]
        );
        assert_eq!(
            moves(&align(&three(), Alignment::Bottom, None)),
            vec![("a", 0.0, 40.0), ("c", 0.0, 55.0)]
        );
        // El medio está en y = 37,5.
        assert_eq!(
            moves(&align(&three(), Alignment::Middle, None)),
            vec![("a", 0.0, 17.5), ("b", 0.0, -12.5), ("c", 0.0, 27.5)]
        );
    }

    /// El criterio de la tarea: se puede alinear respecto a la página.
    #[test]
    fn aligning_to_the_page_uses_the_page() {
        let page = MmRect {
            x: 0.0,
            y: 0.0,
            w: 210.0,
            h: 297.0,
        };
        assert_eq!(
            moves(&align(&three(), Alignment::Left, Some(page))),
            vec![("a", -10.0, 0.0), ("b", -70.0, 0.0), ("c", -100.0, 0.0)]
        );
        // Centrado en la página: 210/2 - 40/2 = 85 para la primera.
        assert_eq!(
            moves(&align(&three()[..1], Alignment::CenterX, Some(page))),
            vec![("a", 75.0, 0.0)]
        );
        // Y uno solo respecto a sí mismo no se mueve.
        assert_eq!(
            moves(&align(&three()[..1], Alignment::CenterX, None)),
            vec![]
        );
    }

    /// El criterio de la tarea: repartir deja huecos iguales.
    #[test]
    fn spreading_leaves_equal_gaps() {
        let op = spread(&three(), Spread::Horizontal, None);
        let mut rects: Vec<MmRect> = three().iter().map(|item| item.rect).collect();
        for (id, dx, _) in moves(&op) {
            let index = three().iter().position(|item| item.id == id).expect("está");
            rects[index].x += dx;
            let _ = id;
        }
        rects.sort_by(|one, another| one.x.total_cmp(&another.x));

        // Los de los extremos no se mueven.
        assert_eq!(rects[0].x, 10.0);
        assert_eq!(rects[2].x + rects[2].w, 130.0);
        // Y los dos huecos son el mismo: 120 - 90 = 30, repartidos en dos.
        let first = rects[1].x - (rects[0].x + rects[0].w);
        let second = rects[2].x - (rects[1].x + rects[1].w);
        assert!((first - second).abs() < 1e-9, "{first} != {second}");
        assert!((first - 15.0).abs() < 1e-9, "{first}");
    }

    #[test]
    fn spreading_vertically_uses_the_other_axis() {
        let op = spread(&three(), Spread::Vertical, None);
        // La caja conjunta va de y = 5 a y = 70, y los altos suman 70: no
        // cabe, así que los huecos salen negativos y se solapan.
        let moved = moves(&op);
        assert!(moved.iter().all(|(_, dx, _)| *dx == 0.0), "{moved:?}");
        assert!(!moved.is_empty());
    }

    #[test]
    fn spreading_inside_the_page_goes_from_edge_to_edge() {
        let page = MmRect {
            x: 0.0,
            y: 0.0,
            w: 210.0,
            h: 297.0,
        };
        let op = spread(&three(), Spread::Horizontal, Some(page));
        let mut rects: Vec<(String, MmRect)> = three()
            .into_iter()
            .map(|item| (item.id, item.rect))
            .collect();
        for (id, dx, _) in moves(&op) {
            if let Some(found) = rects.iter_mut().find(|(one, _)| one == id) {
                found.1.x += dx;
            }
        }
        rects.sort_by(|one, another| one.1.x.total_cmp(&another.1.x));

        assert_eq!(rects[0].1.x, 0.0, "el primero pegado al borde");
        assert!(
            (rects[2].1.x + rects[2].1.w - 210.0).abs() < 1e-9,
            "el último pegado al otro: {:?}",
            rects[2].1
        );
    }

    #[test]
    fn with_less_than_two_there_is_nothing_to_spread() {
        assert_eq!(
            moves(&spread(&three()[..1], Spread::Horizontal, None)),
            vec![]
        );
        assert_eq!(moves(&spread(&[], Spread::Horizontal, None)), vec![]);
    }

    /// Lo que ya está en su sitio no se mueve: el comando no lo lleva.
    #[test]
    fn what_is_already_in_place_is_left_alone() {
        let aligned = vec![
            item("a", 10.0, 10.0, 40.0, 20.0),
            item("b", 10.0, 50.0, 30.0, 20.0),
        ];
        assert_eq!(moves(&align(&aligned, Alignment::Left, None)), vec![]);
    }
}
