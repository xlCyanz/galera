//! Guías de alineación: a qué se engancha un elemento al moverlo.
//!
//! Mientras se arrastra un elemento, el lienzo pregunta aquí dónde debería
//! quedar de verdad y qué líneas enseñar mientras tanto. La decisión vive en
//! el núcleo (principio 5): la interfaz solo dibuja lo que salga de
//! [`snap`], igual que hace con el hit-testing.
//!
//! # A qué se ajusta
//!
//! - **A los otros elementos de la página**: a sus bordes y a sus centros,
//!   en los dos ejes. Cuenta la caja que se ve, o sea la ya girada.
//! - **A la página**: a sus cuatro bordes y a sus dos centros.
//! - **A los márgenes**, si el lienzo enseña alguno ([`Settings::margin`]).
//!   El documento no tiene márgenes propios —la página se compone con margen
//!   cero—, así que el margen es cosa del lienzo y llega en los ajustes.
//! - **A los espaciados que ya hay**: si dos elementos de la misma fila
//!   están separados 8 mm, el que se mueve se engancha a 8 mm del siguiente,
//!   y también al centro del hueco entre dos.
//!
//! # La distancia de enganche está en píxeles
//!
//! Enganchar a una distancia fija en milímetros haría que con el documento
//! muy alejado todo se pegase a todo, y con mucho zoom no se pegase a nada.
//! Lo que tiene que ser constante es lo que se ve: [`Settings::threshold`]
//! son píxeles de pantalla, y se convierten a milímetros con el zoom
//! ([`Settings::scale`]).
//!
//! # Mover y redimensionar
//!
//! Al arrastrar se agarra la caja entera: se ajustan sus dos bordes y su
//! centro, y engancharse la mueve sin cambiarle el tamaño. Al redimensionar
//! se agarra solo el borde del manejador, que es el único que se está
//! moviendo: engancharlo cambia el tamaño, y el borde de enfrente se queda
//! donde está. Eso es [`Grips`], uno por eje.
//!
//! # Cómo se elige
//!
//! Primero se busca, en cada eje por separado, el desplazamiento más pequeño
//! que cumpla algún ajuste; en caso de empate gana el que se encontró antes,
//! que es el de los elementos, luego el de la página y por último el de los
//! espaciados. Con el elemento ya en su sitio se miran **todos** los ajustes
//! que cumple, no solo el que ganó: por eso al alinear tres cajas se dibuja
//! una guía que las cruza todas.

use serde::{Deserialize, Serialize};

use crate::layout::{LayoutBox, MmRect, MmSegment};
use crate::model::PageSize;

/// Distancia de enganche por defecto, en píxeles de pantalla.
pub const SNAP_PX: f64 = 6.0;

/// Desde cuánto dos medidas en milímetros son la misma: por debajo es ruido
/// de la coma flotante, no una diferencia.
const SAME: f64 = 1e-6;

/// Cómo se ajusta este lienzo.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "snap.ts"))]
pub struct Settings {
    /// A cuántos píxeles de pantalla engancha.
    pub threshold: f64,
    /// Cuántos píxeles de pantalla mide un milímetro: el zoom del lienzo.
    pub scale: f64,
    /// El margen al que ajustarse, en mm desde cada borde de la página, o
    /// `None` si el lienzo no enseña márgenes.
    pub margin: Option<f64>,
}

impl Settings {
    /// Los ajustes de un lienzo a `scale` píxeles por milímetro, con la
    /// distancia de enganche por defecto y sin márgenes.
    pub fn at(scale: f64) -> Self {
        Settings {
            threshold: SNAP_PX,
            scale,
            margin: None,
        }
    }

    /// La distancia de enganche en milímetros, que depende del zoom.
    fn tolerance(&self) -> f64 {
        if self.scale > 0.0 {
            self.threshold / self.scale
        } else {
            0.0
        }
    }
}

/// Qué parte del elemento se está moviendo en un eje.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "snap.ts"))]
#[serde(rename_all = "lowercase")]
pub enum Grip {
    /// La caja entera: se ajustan sus dos bordes y su centro, y engancharse
    /// la mueve sin cambiarle el tamaño. Es lo que pasa al arrastrar.
    Whole,
    /// Solo el borde de menos —el izquierdo, o el de arriba—: engancharlo
    /// cambia el tamaño y deja el de enfrente donde está.
    Start,
    /// Solo el borde de más: el derecho, o el de abajo.
    End,
    /// Nada: en este eje no se ajusta. Un manejador lateral no toca el otro.
    None,
}

/// Qué se agarra en cada eje.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "snap.ts"))]
pub struct Grips {
    /// En el eje horizontal.
    pub x: Grip,
    /// En el eje vertical.
    pub y: Grip,
}

impl Grips {
    /// Lo que se agarra al arrastrar: la caja entera en los dos ejes.
    pub fn whole() -> Self {
        Grips {
            x: Grip::Whole,
            y: Grip::Whole,
        }
    }
}

/// De dónde sale una guía.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "snap.ts"))]
#[serde(rename_all = "lowercase")]
pub enum GuideKind {
    /// De un borde o un centro de otro elemento.
    Element,
    /// De un borde o un centro de la página.
    Page,
    /// De un margen del lienzo.
    Margin,
    /// De un hueco que vale lo mismo que otro.
    Spacing,
}

/// Una línea que hay que dibujar mientras se mueve el elemento.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "snap.ts"))]
pub struct Guide {
    /// Los dos extremos del segmento, en mm de la página.
    ///
    /// Una guía de alineación va de punta a punta de lo que alinea; una de
    /// espaciado recorre el hueco que mide.
    pub line: MmSegment,
    /// De dónde sale.
    pub kind: GuideKind,
}

/// Dónde queda el elemento al soltarlo y qué guías enseñar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "snap.ts"))]
pub struct Snapped {
    /// Cuánto hay que correr lo que se agarra hacia la derecha, en mm. 0 si
    /// no engancha.
    pub dx: f64,
    /// Cuánto hay que correrlo hacia abajo, en mm. 0 si no engancha.
    pub dy: f64,
    /// La caja ya ajustada. Al arrastrar es la de antes corrida `dx` y
    /// `dy`; al redimensionar, la que deja el borde enganchado en su sitio.
    pub rect: MmRect,
    /// Las guías que justifican ese desplazamiento.
    pub guides: Vec<Guide>,
}

impl Snapped {
    /// Sin ajuste: el elemento se queda donde lo dejó el ratón.
    pub fn none(moving: MmRect) -> Self {
        Snapped {
            dx: 0.0,
            dy: 0.0,
            rect: moving,
            guides: Vec::new(),
        }
    }
}

/// Las cajas con las que puede ajustarse el elemento `moving`: las de su
/// página, sin la suya.
///
/// Se usa la caja ya girada ([`LayoutBox::bounds`]), que es la que se ve.
pub fn neighbours(boxes: &[LayoutBox], page: usize, moving: &str) -> Vec<MmRect> {
    boxes
        .iter()
        .filter(|layout_box| layout_box.page == page && layout_box.id != moving)
        .map(|layout_box| layout_box.bounds)
        .collect()
}

/// A dónde se ajusta `moving`, que es la caja donde la ha dejado el ratón.
///
/// `others` son las cajas de los demás elementos de la página
/// ([`neighbours`]), `page` el tamaño del papel y `grips` qué se está
/// moviendo: la caja entera al arrastrar ([`Grips::whole`]), o el borde del
/// manejador al redimensionar.
///
/// `dx` y `dy` son cuánto hay que correr eso que se agarra, no siempre la
/// caja entera: con [`Grip::End`] en x, `dx` es lo que crece el ancho.
pub fn snap(
    moving: MmRect,
    others: &[MmRect],
    page: &PageSize,
    settings: &Settings,
    grips: Grips,
) -> Snapped {
    let tolerance = settings.tolerance();
    if tolerance <= 0.0 {
        return Snapped::none(moving);
    }
    let paper = MmRect {
        x: 0.0,
        y: 0.0,
        w: page.unit.to_millimeters(page.width),
        h: page.unit.to_millimeters(page.height),
    };

    let dx = delta(
        Axis::X,
        moving,
        others,
        paper,
        settings.margin,
        tolerance,
        grips.x,
    );
    let dy = delta(
        Axis::Y,
        moving,
        others,
        paper,
        settings.margin,
        tolerance,
        grips.y,
    );
    let moved = place(moving, grips, dx, dy);

    let mut found = guides(Axis::X, moved, others, paper, settings.margin, grips.x);
    found.extend(guides(
        Axis::Y,
        moved,
        others,
        paper,
        settings.margin,
        grips.y,
    ));
    Snapped {
        dx,
        dy,
        rect: moved,
        guides: dedupe(found),
    }
}

/// Uno de los dos ejes de la página.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    /// De izquierda a derecha.
    X,
    /// De arriba abajo.
    Y,
}

/// Un tramo de un eje: dónde empieza y cuánto mide.
#[derive(Debug, Clone, Copy)]
struct Span {
    start: f64,
    size: f64,
}

impl Span {
    fn end(self) -> f64 {
        self.start + self.size
    }

    fn middle(self) -> f64 {
        self.start + self.size / 2.0
    }

    /// Las tres posiciones que se ajustan: los dos bordes y el centro.
    fn edges(self) -> [f64; 3] {
        [self.start, self.middle(), self.end()]
    }

    fn overlaps(self, other: Span) -> bool {
        self.start < other.end() && other.start < self.end()
    }

    /// El tramo más pequeño que contiene a los dos.
    fn union(self, other: Span) -> Span {
        let start = self.start.min(other.start);
        Span {
            start,
            size: self.end().max(other.end()) - start,
        }
    }
}

/// Un rectángulo visto desde un eje: lo que ocupa en él y lo que ocupa en el
/// otro.
#[derive(Debug, Clone, Copy)]
struct Seen {
    /// En el eje que se ajusta.
    along: Span,
    /// En el eje perpendicular.
    across: Span,
}

impl Axis {
    /// El rectángulo visto desde este eje.
    fn see(self, rect: MmRect) -> Seen {
        let (x, y) = (
            Span {
                start: rect.x,
                size: rect.w,
            },
            Span {
                start: rect.y,
                size: rect.h,
            },
        );
        match self {
            Axis::X => Seen {
                along: x,
                across: y,
            },
            Axis::Y => Seen {
                along: y,
                across: x,
            },
        }
    }

    /// Una guía de alineación: cruza el eje por `at` y va de `from` a `to`
    /// en el otro.
    fn across(self, at: f64, from: f64, to: f64) -> MmSegment {
        match self {
            Axis::X => MmSegment {
                x1: at,
                y1: from,
                x2: at,
                y2: to,
            },
            Axis::Y => MmSegment {
                x1: from,
                y1: at,
                x2: to,
                y2: at,
            },
        }
    }

    /// Una guía de espaciado: recorre el eje de `from` a `to`, a `at` del
    /// otro.
    fn along(self, from: f64, to: f64, at: f64) -> MmSegment {
        match self {
            Axis::X => MmSegment {
                x1: from,
                y1: at,
                x2: to,
                y2: at,
            },
            Axis::Y => MmSegment {
                x1: at,
                y1: from,
                x2: at,
                y2: to,
            },
        }
    }
}

/// La caja ya ajustada: correr la entera la mueve; correr un borde cambia
/// el tamaño y deja el de enfrente donde estaba.
fn place(rect: MmRect, grips: Grips, dx: f64, dy: f64) -> MmRect {
    let x = shift(
        Span {
            start: rect.x,
            size: rect.w,
        },
        grips.x,
        dx,
    );
    let y = shift(
        Span {
            start: rect.y,
            size: rect.h,
        },
        grips.y,
        dy,
    );
    MmRect {
        x: x.start,
        y: y.start,
        w: x.size,
        h: y.size,
    }
}

/// El tramo después de correr lo que se agarra de él.
fn shift(span: Span, grip: Grip, delta: f64) -> Span {
    match grip {
        Grip::Whole => Span {
            start: span.start + delta,
            ..span
        },
        Grip::Start => Span {
            start: span.start + delta,
            size: span.size - delta,
        },
        Grip::End => Span {
            size: span.size + delta,
            ..span
        },
        Grip::None => span,
    }
}

/// Las posiciones del elemento que se ajustan en este eje: las tres de la
/// caja entera, o la del borde que se agarra.
fn positions(span: Span, grip: Grip) -> Vec<f64> {
    match grip {
        Grip::Whole => span.edges().to_vec(),
        Grip::Start => vec![span.start],
        Grip::End => vec![span.end()],
        Grip::None => Vec::new(),
    }
}

/// Las posiciones de la página a las que se ajusta un eje, con lo que son.
fn paper_lines(length: f64, margin: Option<f64>) -> Vec<(f64, GuideKind)> {
    let mut lines = vec![
        (0.0, GuideKind::Page),
        (length / 2.0, GuideKind::Page),
        (length, GuideKind::Page),
    ];
    if let Some(margin) = margin {
        lines.push((margin, GuideKind::Margin));
        lines.push((length - margin, GuideKind::Margin));
    }
    lines
}

/// Cuánto hay que correr el elemento en este eje: el desplazamiento más
/// pequeño que cumple algún ajuste, o 0 si no hay ninguno a tiro.
fn delta(
    axis: Axis,
    moving: MmRect,
    others: &[MmRect],
    paper: MmRect,
    margin: Option<f64>,
    tolerance: f64,
    grip: Grip,
) -> f64 {
    let moving = axis.see(moving);
    let others: Vec<Seen> = others.iter().map(|rect| axis.see(*rect)).collect();
    let mine = positions(moving.along, grip);
    let mut candidates: Vec<f64> = Vec::new();

    // Los bordes y los centros de los demás elementos.
    for other in &others {
        for one in &mine {
            for theirs in other.along.edges() {
                candidates.push(theirs - one);
            }
        }
    }
    // Los de la página y los márgenes.
    for (at, _) in paper_lines(axis.see(paper).along.size, margin) {
        for one in &mine {
            candidates.push(at - one);
        }
    }
    // Los espaciados que ya hay.
    candidates.extend(spacings(moving, &others, grip));

    candidates
        .into_iter()
        // Un ajuste que dejaría el elemento del revés no es un ajuste.
        .filter(|delta| delta.abs() <= tolerance && shift(moving.along, grip, *delta).size >= 0.0)
        .min_by(|one, another| one.abs().total_cmp(&another.abs()))
        .unwrap_or(0.0)
}

/// Los desplazamientos que dejarían un hueco igual a otro que ya hay en la
/// fila del elemento.
///
/// La fila son los elementos que se solapan con él en el eje perpendicular:
/// solo con esos tiene sentido hablar de un espaciado.
fn spacings(moving: Seen, others: &[Seen], grip: Grip) -> Vec<f64> {
    if grip == Grip::None {
        return Vec::new();
    }
    let row = row_of(moving, others);
    let gaps: Vec<f64> = row
        .windows(2)
        .map(|pair| pair[1].along.start - pair[0].along.end())
        .filter(|gap| *gap > SAME)
        .collect();

    // Un hueco por la derecha lo fija el borde de más, y uno por la
    // izquierda el de menos: con un borde agarrado solo vale el suyo.
    let (after, before) = match grip {
        Grip::Whole => (true, true),
        Grip::Start => (false, true),
        Grip::End => (true, false),
        Grip::None => (false, false),
    };
    let mut candidates = Vec::new();
    for neighbour in &row {
        for gap in &gaps {
            if after {
                candidates.push(neighbour.along.start - gap - moving.along.end());
            }
            if before {
                candidates.push(neighbour.along.end() + gap - moving.along.start);
            }
        }
    }
    // Centrado entre dos, con el mismo hueco a cada lado. Eso solo tiene
    // sentido moviendo la caja entera.
    if grip == Grip::Whole {
        for pair in row.windows(2) {
            let free = pair[1].along.start - pair[0].along.end() - moving.along.size;
            if free > SAME {
                candidates.push(pair[0].along.end() + free / 2.0 - moving.along.start);
            }
        }
    }
    candidates
}

/// Los elementos que comparten fila con el que se mueve, de menos a más en
/// el eje.
fn row_of(moving: Seen, others: &[Seen]) -> Vec<Seen> {
    let mut row: Vec<Seen> = others
        .iter()
        .copied()
        .filter(|other| other.across.overlaps(moving.across))
        .collect();
    row.sort_by(|one, another| one.along.start.total_cmp(&another.along.start));
    row
}

/// Todas las guías que cumple el elemento ya colocado, en este eje.
fn guides(
    axis: Axis,
    moved: MmRect,
    others: &[MmRect],
    paper: MmRect,
    margin: Option<f64>,
    grip: Grip,
) -> Vec<Guide> {
    if grip == Grip::None {
        return Vec::new();
    }
    let moving = axis.see(moved);
    let others: Vec<Seen> = others.iter().map(|rect| axis.see(*rect)).collect();
    let paper = axis.see(paper);
    let mine = positions(moving.along, grip);
    let mut found = Vec::new();

    for other in &others {
        for one in &mine {
            for theirs in other.along.edges() {
                if (theirs - one).abs() <= SAME {
                    let span = moving.across.union(other.across);
                    found.push(Guide {
                        line: axis.across(theirs, span.start, span.end()),
                        kind: GuideKind::Element,
                    });
                }
            }
        }
    }
    for (at, kind) in paper_lines(paper.along.size, margin) {
        if mine.iter().any(|one| (at - one).abs() <= SAME) {
            found.push(Guide {
                line: axis.across(at, 0.0, paper.across.size),
                kind,
            });
        }
    }
    found.extend(spacing_guides(axis, moving, &others));
    found
}

/// Un hueco de la fila, ya medido.
struct Gap {
    /// Cuánto mide.
    size: f64,
    /// Dónde empieza y dónde acaba, en el eje.
    from: f64,
    to: f64,
    /// A qué altura dibujarlo, en el otro eje.
    at: f64,
    /// Si es uno de los huecos del elemento que se mueve.
    mine: bool,
}

/// Las guías de los huecos que valen lo mismo, cuando uno de ellos es del
/// elemento que se mueve.
fn spacing_guides(axis: Axis, moving: Seen, others: &[Seen]) -> Vec<Guide> {
    let mut row: Vec<(Seen, bool)> = others
        .iter()
        .copied()
        .filter(|other| other.across.overlaps(moving.across))
        .map(|other| (other, false))
        .collect();
    row.push((moving, true));
    row.sort_by(|one, another| one.0.along.start.total_cmp(&another.0.along.start));

    let gaps: Vec<Gap> = row
        .windows(2)
        .filter_map(|pair| {
            let ((before, before_mine), (after, after_mine)) = (pair[0], pair[1]);
            let size = after.along.start - before.along.end();
            (size > SAME).then(|| Gap {
                size,
                from: before.along.end(),
                to: after.along.start,
                at: (before.across.middle() + after.across.middle()) / 2.0,
                mine: before_mine || after_mine,
            })
        })
        .collect();

    let mut found = Vec::new();
    for gap in gaps.iter().filter(|gap| gap.mine) {
        let equal: Vec<&Gap> = gaps
            .iter()
            .filter(|other| (other.size - gap.size).abs() <= SAME)
            .collect();
        if equal.len() < 2 {
            continue;
        }
        for one in equal {
            found.push(Guide {
                line: axis.along(one.from, one.to, one.at),
                kind: GuideKind::Spacing,
            });
        }
    }
    found
}

/// Quita las guías repetidas: los bordes coinciden a menudo, y dibujar dos
/// veces la misma línea la deja más gruesa.
fn dedupe(guides: Vec<Guide>) -> Vec<Guide> {
    let mut kept: Vec<Guide> = Vec::new();
    for guide in guides {
        if !kept.iter().any(|other| same(other, &guide)) {
            kept.push(guide);
        }
    }
    kept
}

/// Si dos guías son la misma línea.
fn same(one: &Guide, another: &Guide) -> bool {
    one.kind == another.kind
        && (one.line.x1 - another.line.x1).abs() <= SAME
        && (one.line.y1 - another.line.y1).abs() <= SAME
        && (one.line.x2 - another.line.x2).abs() <= SAME
        && (one.line.y2 - another.line.y2).abs() <= SAME
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Unit;

    /// Una hoja A4 en milímetros.
    fn a4() -> PageSize {
        PageSize {
            width: 210.0,
            height: 297.0,
            unit: Unit::Mm,
        }
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> MmRect {
        MmRect { x, y, w, h }
    }

    /// Un lienzo a 2 píxeles por milímetro: engancha a 3 mm.
    fn canvas() -> Settings {
        Settings::at(2.0)
    }

    fn at(moving: MmRect, others: &[MmRect]) -> Snapped {
        snap(moving, others, &a4(), &canvas(), Grips::whole())
    }

    /// Redimensionar: se agarra un solo borde, y el otro eje no se ajusta.
    fn pulling(moving: MmRect, others: &[MmRect], grips: Grips) -> Snapped {
        snap(moving, others, &a4(), &canvas(), grips)
    }

    /// Dónde acaba el elemento, redondeado a la micra.
    fn landed(moving: MmRect, others: &[MmRect]) -> (f64, f64) {
        let snapped = at(moving, others);
        (
            (moving.x + snapped.dx).round(),
            (moving.y + snapped.dy).round(),
        )
    }

    fn kinds(snapped: &Snapped) -> Vec<GuideKind> {
        snapped.guides.iter().map(|guide| guide.kind).collect()
    }

    #[test]
    fn it_snaps_to_the_left_edge_of_another_element() {
        let other = rect(50.0, 10.0, 30.0, 20.0);
        let snapped = at(rect(48.0, 100.0, 10.0, 10.0), &[other]);

        assert_eq!(snapped.dx, 2.0, "se pega al borde izquierdo");
        assert_eq!(snapped.dy, 0.0, "el otro eje no engancha con nada");
        assert_eq!(kinds(&snapped), vec![GuideKind::Element]);
    }

    #[test]
    fn it_snaps_to_the_center_of_another_element() {
        // El centro del otro está en x = 65; el del que se mueve, en 63,5.
        let other = rect(50.0, 10.0, 30.0, 20.0);
        let snapped = at(rect(58.5, 100.0, 10.0, 10.0), &[other]);
        assert_eq!(snapped.dx, 1.5, "los dos centros acaban en 65");
    }

    #[test]
    fn it_snaps_the_right_edge_to_the_left_edge_of_another() {
        let other = rect(100.0, 10.0, 30.0, 20.0);
        let snapped = at(rect(88.0, 200.0, 10.0, 10.0), &[other]);
        assert_eq!(snapped.dx, 2.0, "el borde derecho acaba en 100");
    }

    #[test]
    fn far_away_nothing_snaps() {
        let other = rect(50.0, 10.0, 30.0, 20.0);
        let snapped = at(rect(35.0, 100.0, 10.0, 10.0), &[other]);
        assert_eq!((snapped.dx, snapped.dy), (0.0, 0.0));
        assert!(snapped.guides.is_empty(), "sin ajuste no hay guías");
    }

    /// El criterio de la tarea: la distancia se mide en píxeles, así que
    /// depende del zoom.
    #[test]
    fn the_snapping_distance_is_in_screen_pixels() {
        let other = [rect(50.0, 10.0, 30.0, 20.0)];
        // Su borde derecho está a 4 mm del izquierdo del otro.
        let moving = rect(36.0, 100.0, 10.0, 10.0);

        // A 1 px/mm, 6 px son 6 mm y los 4 de diferencia enganchan.
        let far = snap(moving, &other, &a4(), &Settings::at(1.0), Grips::whole());
        assert_eq!(far.dx, 4.0);

        // A 4 px/mm son 1,5 mm y ya no.
        let near = snap(moving, &other, &a4(), &Settings::at(4.0), Grips::whole());
        assert_eq!(near.dx, 0.0);

        // Y se puede cambiar sin tocar el zoom.
        let wide = snap(
            moving,
            &other,
            &a4(),
            &Settings {
                threshold: 24.0,
                scale: 4.0,
                margin: None,
            },
            Grips::whole(),
        );
        assert_eq!(wide.dx, 4.0);
    }

    #[test]
    fn it_snaps_to_the_edges_and_the_center_of_the_page() {
        assert_eq!(landed(rect(2.0, 100.0, 10.0, 10.0), &[]), (0.0, 100.0));
        assert_eq!(landed(rect(199.0, 100.0, 10.0, 10.0), &[]), (200.0, 100.0));
        assert_eq!(landed(rect(100.0, 100.0, 10.0, 10.0), &[]), (100.0, 100.0));
        // Centrado en la página: 210/2 - 5 = 100 en x, 297/2 - 5 = 143,5 en y.
        let snapped = at(rect(102.0, 145.0, 10.0, 10.0), &[]);
        assert_eq!(snapped.dx, -2.0);
        assert_eq!(snapped.dy, -1.5);
        assert_eq!(kinds(&snapped), vec![GuideKind::Page, GuideKind::Page]);
    }

    #[test]
    fn the_page_guides_cross_the_whole_page() {
        let snapped = at(rect(0.0, 100.0, 10.0, 10.0), &[]);
        assert_eq!(
            snapped.guides,
            vec![Guide {
                line: MmSegment {
                    x1: 0.0,
                    y1: 0.0,
                    x2: 0.0,
                    y2: 297.0
                },
                kind: GuideKind::Page,
            }]
        );
    }

    #[test]
    fn it_snaps_to_the_margins_when_the_canvas_has_them() {
        let settings = Settings {
            margin: Some(20.0),
            ..canvas()
        };
        let moving = rect(18.0, 100.0, 10.0, 10.0);

        let with = snap(moving, &[], &a4(), &settings, Grips::whole());
        assert_eq!(with.dx, 2.0);
        assert_eq!(kinds(&with), vec![GuideKind::Margin]);

        // Sin márgenes en el lienzo no hay nada a lo que engancharse ahí.
        let without = snap(moving, &[], &a4(), &canvas(), Grips::whole());
        assert_eq!(without.dx, 0.0);

        // También al margen de la derecha: 210 - 20 = 190.
        let right = snap(
            rect(179.0, 100.0, 10.0, 10.0),
            &[],
            &a4(),
            &settings,
            Grips::whole(),
        );
        assert_eq!(right.dx + 189.0, 190.0);
    }

    #[test]
    fn it_snaps_in_both_axes_at_once() {
        let other = rect(50.0, 60.0, 30.0, 30.0);
        let snapped = at(rect(48.0, 58.0, 10.0, 10.0), &[other]);
        assert_eq!((snapped.dx, snapped.dy), (2.0, 2.0));
        assert_eq!(
            kinds(&snapped),
            vec![GuideKind::Element, GuideKind::Element],
            "una guía por eje"
        );
    }

    #[test]
    fn the_nearest_snap_wins() {
        // El borde izquierdo del primero está a 2 mm; el del segundo, a 1.
        let others = [rect(50.0, 10.0, 30.0, 20.0), rect(49.0, 10.0, 30.0, 20.0)];
        let snapped = at(rect(48.0, 100.0, 10.0, 10.0), &others);
        assert_eq!(snapped.dx, 1.0);
    }

    /// Con el elemento colocado se dibujan todas las alineaciones que
    /// cumple, no solo la que decidió el enganche.
    #[test]
    fn every_alignment_it_meets_gets_a_guide() {
        let others = [rect(50.0, 10.0, 30.0, 20.0), rect(50.0, 200.0, 40.0, 20.0)];
        let snapped = at(rect(48.0, 100.0, 10.0, 10.0), &others);

        assert_eq!(snapped.dx, 2.0);
        assert_eq!(
            kinds(&snapped),
            vec![GuideKind::Element, GuideKind::Element]
        );
        // La guía de cada pareja va de punta a punta de las dos cajas.
        assert_eq!(
            snapped.guides[0].line,
            MmSegment {
                x1: 50.0,
                y1: 10.0,
                x2: 50.0,
                y2: 110.0
            }
        );
        assert_eq!(
            snapped.guides[1].line,
            MmSegment {
                x1: 50.0,
                y1: 100.0,
                x2: 50.0,
                y2: 220.0
            }
        );
    }

    /// El criterio de la tarea: también se ajusta a los espaciados iguales.
    #[test]
    fn it_snaps_to_the_spacing_the_row_already_has() {
        // Dos cajas de 20 mm separadas 10 mm: 10..30 y 40..60.
        let others = [rect(10.0, 50.0, 20.0, 20.0), rect(40.0, 50.0, 20.0, 20.0)];
        // La tercera cae cerca de los 10 mm de separación: iría a 70.
        let snapped = at(rect(68.0, 50.0, 20.0, 20.0), &others);

        assert_eq!(snapped.dx, 2.0);
        let spacing: Vec<&Guide> = snapped
            .guides
            .iter()
            .filter(|guide| guide.kind == GuideKind::Spacing)
            .collect();
        assert_eq!(
            spacing.len(),
            2,
            "los dos huecos iguales: {:?}",
            kinds(&snapped)
        );
        assert_eq!(
            spacing[0].line,
            MmSegment {
                x1: 30.0,
                y1: 60.0,
                x2: 40.0,
                y2: 60.0
            }
        );
        assert_eq!(
            spacing[1].line,
            MmSegment {
                x1: 60.0,
                y1: 60.0,
                x2: 70.0,
                y2: 60.0
            }
        );
    }

    #[test]
    fn it_snaps_to_the_middle_of_a_gap() {
        // Un hueco de 40 mm entre 30 y 70; una caja de 20 va a 40..60.
        let others = [rect(10.0, 50.0, 20.0, 20.0), rect(70.0, 50.0, 20.0, 20.0)];
        let snapped = at(rect(42.0, 50.0, 20.0, 20.0), &others);

        assert_eq!(snapped.dx, -2.0);
        assert_eq!(
            snapped
                .guides
                .iter()
                .filter(|guide| guide.kind == GuideKind::Spacing)
                .count(),
            2,
            "el hueco de cada lado, los dos de 10 mm"
        );
    }

    #[test]
    fn a_spacing_only_counts_within_the_row() {
        // Las mismas dos cajas, pero la que se mueve está en otra fila.
        let others = [rect(10.0, 50.0, 20.0, 20.0), rect(40.0, 50.0, 20.0, 20.0)];
        let snapped = at(rect(68.0, 200.0, 20.0, 20.0), &others);
        assert_eq!(snapped.dx, 0.0, "no comparten fila");
    }

    #[test]
    fn an_alignment_beats_a_spacing_at_the_same_distance() {
        // El borde izquierdo de la tercera caja alinea con el de la primera
        // a la misma distancia a la que engancharía el espaciado.
        let others = [rect(10.0, 50.0, 20.0, 20.0), rect(40.0, 50.0, 20.0, 20.0)];
        let snapped = at(rect(8.0, 100.0, 20.0, 20.0), &others);
        assert_eq!(snapped.dx, 2.0);
        assert_eq!(snapped.guides[0].kind, GuideKind::Element);
    }

    #[test]
    fn a_rotated_neighbour_snaps_by_the_box_you_see() {
        // Un elemento girado llega con su caja ya girada: es la que se ve.
        let turned = rect(40.0, 10.0, 40.0, 40.0);
        let snapped = at(rect(38.0, 100.0, 10.0, 10.0), &[turned]);
        assert_eq!(snapped.dx, 2.0);
    }

    #[test]
    fn neighbours_leaves_out_the_one_that_moves_and_the_other_pages() {
        let boxes = [
            layout("a", 0, rect(10.0, 10.0, 20.0, 20.0)),
            layout("b", 0, rect(50.0, 10.0, 20.0, 20.0)),
            layout("c", 1, rect(90.0, 10.0, 20.0, 20.0)),
        ];
        let found = neighbours(&boxes, 0, "a");
        assert_eq!(found, vec![rect(50.0, 10.0, 20.0, 20.0)]);
    }

    #[test]
    fn without_zoom_there_is_no_snapping() {
        let settings = Settings {
            scale: 0.0,
            ..canvas()
        };
        let snapped = snap(
            rect(2.0, 2.0, 10.0, 10.0),
            &[],
            &a4(),
            &settings,
            Grips::whole(),
        );
        assert_eq!((snapped.dx, snapped.dy), (0.0, 0.0));
        assert!(snapped.guides.is_empty());
    }

    #[test]
    fn the_page_size_can_come_in_another_unit() {
        let inches = PageSize {
            width: 8.0,
            height: 10.0,
            unit: Unit::In,
        };
        // 8 pulgadas son 203,2 mm: el borde derecho está ahí, no en 8.
        let snapped = snap(
            rect(192.0, 50.0, 10.0, 10.0),
            &[],
            &inches,
            &canvas(),
            Grips::whole(),
        );
        assert!((snapped.dx - 1.2).abs() < SAME, "{} mm", snapped.dx);
    }

    /// El criterio de la tarea: el ajuste funciona igual al redimensionar.
    #[test]
    fn resizing_snaps_the_edge_you_pull() {
        let other = rect(100.0, 10.0, 30.0, 80.0);
        // Se estira el borde derecho, que está a 2 mm del izquierdo del otro.
        let snapped = pulling(
            rect(40.0, 30.0, 58.0, 20.0),
            &[other],
            Grips {
                x: Grip::End,
                y: Grip::None,
            },
        );
        assert_eq!(snapped.dx, 2.0, "el ancho crece 2 mm");
        assert_eq!(snapped.dy, 0.0, "un manejador lateral no toca el alto");
        assert_eq!(kinds(&snapped), vec![GuideKind::Element]);
        // La guía sale del borde ya estirado, no del de antes.
        assert_eq!(snapped.guides[0].line.x1, 100.0);
    }

    #[test]
    fn resizing_does_not_snap_by_the_edge_that_stays() {
        // El borde izquierdo está a 2 mm del de la otra caja, pero no se
        // está moviendo: tirando del derecho no engancha nada.
        let other = rect(50.0, 10.0, 30.0, 80.0);
        let snapped = pulling(
            rect(48.0, 30.0, 10.0, 20.0),
            &[other],
            Grips {
                x: Grip::End,
                y: Grip::None,
            },
        );
        assert_eq!(snapped.dx, 0.0);
        assert!(snapped.guides.is_empty());
    }

    #[test]
    fn pulling_the_left_edge_moves_it_and_the_other_stays() {
        let other = rect(20.0, 10.0, 30.0, 80.0);
        let moving = rect(18.0, 30.0, 40.0, 20.0);
        let snapped = pulling(
            moving,
            &[other],
            Grips {
                x: Grip::Start,
                y: Grip::None,
            },
        );
        assert_eq!(snapped.dx, 2.0);
        // El de enfrente se queda: x 18 → 20 y ancho 40 → 38.
        assert_eq!((snapped.rect.x, snapped.rect.w), (20.0, 38.0));
        assert_eq!(moving.w, 40.0, "la caja de entrada no se toca");
    }

    #[test]
    fn a_corner_snaps_in_both_axes() {
        let other = rect(100.0, 60.0, 30.0, 30.0);
        let snapped = pulling(
            rect(40.0, 30.0, 58.0, 28.0),
            &[other],
            Grips {
                x: Grip::End,
                y: Grip::End,
            },
        );
        assert_eq!((snapped.dx, snapped.dy), (2.0, 2.0));
    }

    #[test]
    fn a_snap_that_would_turn_the_box_inside_out_is_no_snap() {
        // Tirando del borde derecho hasta pasarse del izquierdo: el único
        // candidato cerca dejaría el ancho en negativo.
        let other = rect(10.0, 10.0, 5.0, 80.0);
        let snapped = pulling(
            rect(12.0, 30.0, 0.5, 20.0),
            &[other],
            Grips {
                x: Grip::End,
                y: Grip::None,
            },
        );
        assert!(snapped.dx >= -0.5, "ancho no negativo: {}", snapped.dx);
    }

    #[test]
    fn resizing_also_matches_the_spacing_of_the_row() {
        // Dos cajas de la fila están separadas 10 mm: estirando la tercera
        // hasta 10 mm de la cuarta, engancha.
        let others = [
            rect(10.0, 50.0, 20.0, 20.0),
            rect(40.0, 50.0, 20.0, 20.0),
            rect(80.0, 50.0, 20.0, 20.0),
        ];
        let snapped = pulling(
            rect(62.0, 50.0, 6.0, 20.0),
            &others,
            Grips {
                x: Grip::End,
                y: Grip::None,
            },
        );
        assert_eq!(snapped.dx, 2.0, "el borde derecho acaba en 70");
        assert!(
            snapped
                .guides
                .iter()
                .any(|guide| guide.kind == GuideKind::Spacing)
        );
    }

    /// Una caja del layout con su `bounds`, para probar [`neighbours`].
    fn layout(id: &str, page: usize, bounds: MmRect) -> LayoutBox {
        LayoutBox {
            id: id.to_owned(),
            page,
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h,
            rotation: 0.0,
            bounds,
            line: None,
            overflow: 0.0,
        }
    }
}
