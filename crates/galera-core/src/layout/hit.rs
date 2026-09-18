//! Hit-testing: qué elemento hay bajo un punto de la página.
//!
//! La interfaz convierte el clic a milímetros de la página y pregunta aquí:
//! la decisión vive en el núcleo (principio 5). Trabaja sobre las
//! [`LayoutBox`] de una compilación, sin volver a mirar a Typst.
//!
//! # Reglas
//!
//! - **Gana el de más arriba**: el último que se dibuja, que es el último del
//!   arreglo de elementos de su página.
//! - **Los girados se aciertan por su forma girada**, no por la caja alineada
//!   que los contiene: el punto se lleva a las coordenadas del elemento sin
//!   girar (girándolo al revés alrededor del centro) y se comprueba ahí.
//! - **Las líneas, por su trazo**: el punto tiene que estar a menos de la
//!   tolerancia del segmento, no dentro de la caja de sus extremos.
//! - **El borde cuenta como dentro**, y la tolerancia lo ensancha: con ella
//!   se puede acertar una línea de grosor cero o el filo de una caja.
//! - **Un elemento bloqueado no se acierta** ([`selectable`]): el clic pasa
//!   al de debajo. Solo se selecciona desde el panel de capas. Uno oculto ni
//!   siquiera tiene caja, porque no se emite.
//!
//! [`element_at`] da el elemento de más arriba o, pidiendo atravesar, el que
//! está debajo del que ya se tiene; [`hits`] da todos, de arriba abajo.

use std::collections::HashSet;

use super::LayoutBox;
use crate::model::Document;

/// Las cajas que se pueden acertar con el ratón: todas menos las de los
/// elementos que `document` tiene bloqueados.
///
/// Se mira el documento actual, no el que se compiló: bloquear no cambia
/// nada que dibuje Typst, así que vale en cuanto se bloquea.
pub fn selectable(boxes: Vec<LayoutBox>, document: &Document) -> Vec<LayoutBox> {
    let locked: HashSet<&str> = document
        .pages
        .iter()
        .flat_map(|page| &page.elements)
        .filter(|element| element.layer().is_locked())
        .map(|element| element.id())
        .collect();
    if locked.is_empty() {
        return boxes;
    }
    boxes
        .into_iter()
        .filter(|layout_box| !locked.contains(layout_box.id.as_str()))
        .collect()
}

/// Todos los elementos de `page` bajo el punto `(x, y)` en mm, del de más
/// arriba al de más abajo. `tolerance` es cuánto se ensancha cada elemento,
/// en mm.
pub fn hits(boxes: &[LayoutBox], page: usize, x: f64, y: f64, tolerance: f64) -> Vec<&LayoutBox> {
    boxes
        .iter()
        .rev()
        .filter(|layout_box| layout_box.page == page && contains(layout_box, x, y, tolerance))
        .collect()
}

/// El elemento bajo el punto, o `None` si no hay ninguno: un clic en una
/// zona vacía.
///
/// Con `below`, atraviesa: si ese elemento está bajo el punto, devuelve el
/// siguiente hacia abajo, y del último vuelve al primero. Es lo que hace
/// Alt o ⌘ + clic para llegar a un elemento tapado por otro.
pub fn element_at<'a>(
    boxes: &'a [LayoutBox],
    page: usize,
    x: f64,
    y: f64,
    tolerance: f64,
    below: Option<&str>,
) -> Option<&'a LayoutBox> {
    let found = hits(boxes, page, x, y, tolerance);
    let next = below
        .and_then(|id| found.iter().position(|layout_box| layout_box.id == id))
        .map_or(0, |index| (index + 1) % found.len());
    found.get(next).copied()
}

/// Si el punto cae en el elemento.
fn contains(layout_box: &LayoutBox, x: f64, y: f64, tolerance: f64) -> bool {
    let (x, y) = unrotate(layout_box, x, y);

    if let Some(line) = &layout_box.line {
        return distance_to_segment(x, y, (line.x1, line.y1), (line.x2, line.y2)) <= tolerance;
    }

    x >= layout_box.x - tolerance
        && x <= layout_box.x + layout_box.w + tolerance
        && y >= layout_box.y - tolerance
        && y <= layout_box.y + layout_box.h + tolerance
}

/// El punto en las coordenadas del elemento sin girar: girado al revés
/// alrededor del centro de su caja.
fn unrotate(layout_box: &LayoutBox, x: f64, y: f64) -> (f64, f64) {
    if layout_box.rotation == 0.0 {
        return (x, y);
    }
    let center_x = layout_box.x + layout_box.w / 2.0;
    let center_y = layout_box.y + layout_box.h / 2.0;
    let (sin, cos) = (-layout_box.rotation).to_radians().sin_cos();
    let (dx, dy) = (x - center_x, y - center_y);
    // Con el eje y hacia abajo, un ángulo positivo gira en sentido horario.
    (
        center_x + dx * cos - dy * sin,
        center_y + dx * sin + dy * cos,
    )
}

/// La distancia de un punto a un segmento.
fn distance_to_segment(x: f64, y: f64, (x1, y1): (f64, f64), (x2, y2): (f64, f64)) -> f64 {
    let (dx, dy) = (x2 - x1, y2 - y1);
    let length_squared = dx * dx + dy * dy;
    let t = if length_squared == 0.0 {
        0.0
    } else {
        (((x - x1) * dx + (y - y1) * dy) / length_squared).clamp(0.0, 1.0)
    };
    let (closest_x, closest_y) = (x1 + t * dx, y1 + t * dy);
    ((x - closest_x).powi(2) + (y - closest_y).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{MmRect, MmSegment};

    /// Una caja sin girar.
    fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> LayoutBox {
        LayoutBox {
            id: id.to_owned(),
            page: 0,
            x,
            y,
            w,
            h,
            rotation: 0.0,
            bounds: MmRect { x, y, w, h },
            line: None,
        }
    }

    fn ids(found: Vec<&LayoutBox>) -> Vec<&str> {
        found
            .into_iter()
            .map(|layout_box| layout_box.id.as_str())
            .collect()
    }

    fn at(boxes: &[LayoutBox], x: f64, y: f64) -> Option<&str> {
        element_at(boxes, 0, x, y, 0.0, None).map(|layout_box| layout_box.id.as_str())
    }

    #[test]
    fn points_inside_outside_and_on_the_edge() {
        let boxes = [rect("r", 10.0, 20.0, 30.0, 40.0)];

        assert_eq!(at(&boxes, 25.0, 40.0), Some("r"), "dentro");
        assert_eq!(at(&boxes, 5.0, 40.0), None, "fuera, a la izquierda");
        assert_eq!(at(&boxes, 25.0, 60.5), None, "fuera, debajo");

        // Los cuatro bordes y las esquinas cuentan como dentro.
        for (x, y) in [
            (10.0, 40.0),
            (40.0, 40.0),
            (25.0, 20.0),
            (25.0, 60.0),
            (10.0, 20.0),
            (40.0, 60.0),
        ] {
            assert_eq!(at(&boxes, x, y), Some("r"), "borde ({x}, {y})");
        }
        // Justo fuera del borde, no.
        assert_eq!(at(&boxes, 9.999, 40.0), None);
    }

    #[test]
    fn the_tolerance_widens_every_edge() {
        let boxes = [rect("r", 10.0, 20.0, 30.0, 40.0)];
        assert!(element_at(&boxes, 0, 9.0, 40.0, 1.0, None).is_some());
        assert!(element_at(&boxes, 0, 8.9, 40.0, 1.0, None).is_none());
        assert!(element_at(&boxes, 0, 25.0, 61.0, 1.0, None).is_some());
    }

    /// El criterio de la tarea: gana el de más arriba, que es el último.
    #[test]
    fn the_topmost_element_wins() {
        let boxes = [
            rect("fondo", 0.0, 0.0, 100.0, 100.0),
            rect("medio", 20.0, 20.0, 50.0, 50.0),
            rect("arriba", 30.0, 30.0, 10.0, 10.0),
        ];
        assert_eq!(at(&boxes, 35.0, 35.0), Some("arriba"));
        assert_eq!(at(&boxes, 60.0, 60.0), Some("medio"));
        assert_eq!(at(&boxes, 90.0, 90.0), Some("fondo"));
        assert_eq!(
            ids(hits(&boxes, 0, 35.0, 35.0, 0.0)),
            ["arriba", "medio", "fondo"]
        );
    }

    /// El criterio de la tarea: Alt o ⌘ + clic atraviesa hacia abajo, y del
    /// último vuelve al primero.
    #[test]
    fn going_through_reaches_the_elements_below() {
        let boxes = [
            rect("fondo", 0.0, 0.0, 100.0, 100.0),
            rect("medio", 20.0, 20.0, 50.0, 50.0),
            rect("arriba", 30.0, 30.0, 10.0, 10.0),
        ];
        let through = |below: &str| {
            element_at(&boxes, 0, 35.0, 35.0, 0.0, Some(below)).map(|b| b.id.as_str())
        };
        assert_eq!(through("arriba"), Some("medio"));
        assert_eq!(through("medio"), Some("fondo"));
        assert_eq!(through("fondo"), Some("arriba"));
        // Si lo que se tenía no está bajo el punto, se empieza por arriba.
        assert_eq!(through("otro"), Some("arriba"));
    }

    /// El criterio de la tarea: un clic en una zona vacía no da ningún
    /// elemento (la interfaz deselecciona).
    #[test]
    fn an_empty_spot_hits_nothing() {
        let boxes = [rect("r", 10.0, 10.0, 10.0, 10.0)];
        assert_eq!(at(&boxes, 100.0, 100.0), None);
        assert_eq!(at(&[], 1.0, 1.0), None);
    }

    #[test]
    fn only_the_elements_of_that_page_count() {
        let mut other = rect("otra", 0.0, 0.0, 100.0, 100.0);
        other.page = 1;
        let boxes = [rect("esta", 50.0, 50.0, 10.0, 10.0), other];
        assert_eq!(at(&boxes, 5.0, 5.0), None);
        assert_eq!(
            element_at(&boxes, 1, 5.0, 5.0, 0.0, None).map(|b| b.id.as_str()),
            Some("otra")
        );
    }

    /// El criterio de la tarea: un elemento girado se acierta por su forma,
    /// no por la caja alineada que lo contiene.
    #[test]
    fn a_rotated_element_is_hit_by_its_real_shape() {
        // 40 × 10 mm con centro en (50, 50), girado 45°.
        let mut rotated = rect("girado", 30.0, 45.0, 40.0, 10.0);
        rotated.rotation = 45.0;
        let boxes = [rotated];

        // En su eje largo, a 15 mm del centro en diagonal: dentro.
        let d = 15.0 / 2f64.sqrt();
        assert_eq!(at(&boxes, 50.0 + d, 50.0 + d), Some("girado"));
        assert_eq!(at(&boxes, 50.0 - d, 50.0 - d), Some("girado"));
        // Una esquina de la caja alineada sin girar: fuera del elemento.
        assert_eq!(at(&boxes, 32.0, 46.0), None);
        // En la otra diagonal, a 15 mm del centro: el elemento solo mide 10
        // de ancho, así que fuera.
        assert_eq!(at(&boxes, 50.0 + d, 50.0 - d), None);
    }

    #[test]
    fn the_rotation_is_clockwise_like_in_typst() {
        // Horizontal de 40 × 2 mm con centro en (50, 50), girado 90° en
        // sentido horario: queda vertical.
        let mut rotated = rect("girado", 30.0, 49.0, 40.0, 2.0);
        rotated.rotation = 90.0;
        let boxes = [rotated];
        assert_eq!(at(&boxes, 50.0, 30.5), Some("girado"));
        assert_eq!(at(&boxes, 69.0, 50.0), None);
    }

    /// Una línea se acierta cerca de su trazo, no en toda la caja de sus
    /// extremos.
    #[test]
    fn a_line_is_hit_along_its_stroke() {
        let mut line = rect("linea", 20.0, 40.0, 170.0, 80.0);
        line.line = Some(MmSegment {
            x1: 190.0,
            y1: 120.0,
            x2: 20.0,
            y2: 40.0,
        });
        let boxes = [line];

        let near = |x: f64, y: f64| element_at(&boxes, 0, x, y, 1.0, None).is_some();
        // En el trazo y a menos de 1 mm de él.
        assert!(near(105.0, 80.0));
        assert!(near(105.0, 80.9));
        // Dentro de la caja, pero lejos del trazo.
        assert!(!near(170.0, 45.0));
        // Pasado el extremo, fuera aunque esté en la prolongación.
        assert!(!near(195.0, 122.35));
    }

    #[test]
    fn a_line_without_thickness_needs_the_tolerance() {
        let mut line = rect("horizontal", 20.0, 20.0, 170.0, 0.0);
        line.line = Some(MmSegment {
            x1: 20.0,
            y1: 20.0,
            x2: 190.0,
            y2: 20.0,
        });
        let boxes = [line];
        assert!(element_at(&boxes, 0, 100.0, 20.5, 0.0, None).is_none());
        assert!(element_at(&boxes, 0, 100.0, 20.5, 1.0, None).is_some());
    }

    /// Con las cajas de un documento de verdad, compiladas por Typst.
    #[test]
    fn with_real_boxes_from_typst() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        let json = std::fs::read_to_string(dir.join("rectangulo.json")).expect("existe");
        let document = crate::Document::from_json_str(&json).expect("es un documento");
        let project = crate::Project::open(&dir).expect("es un proyecto");
        let boxes = crate::layout(&document, &project).expect("compila");

        assert_eq!(at(&boxes, 60.0, 40.0), Some("relleno-y-borde"));
        assert_eq!(at(&boxes, 150.0, 40.0), Some("sin-relleno-ni-borde"));
        assert_eq!(at(&boxes, 150.0, 100.0), Some("girado"));
        // Esquina de la caja alineada del girado (15°), fuera de su forma.
        assert_eq!(at(&boxes, 107.0, 71.0), None);
        assert_eq!(at(&boxes, 5.0, 5.0), None);
    }

    /// El criterio de la tarea: un bloqueado no responde al clic, que pasa
    /// al de debajo; uno oculto ni siquiera tiene caja.
    #[test]
    fn locked_elements_are_not_hit_and_hidden_ones_have_no_box() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        let json = std::fs::read_to_string(dir.join("capas.json")).expect("existe");
        let document = crate::Document::from_json_str(&json).expect("es un documento");
        let project = crate::Project::open(&dir).expect("es un proyecto");
        let all = crate::layout(&document, &project).expect("compila");

        // Sin filtrar, el fondo bloqueado se acierta; filtrado, no.
        assert_eq!(at(&all, 5.0, 280.0), Some("fondo"));
        let boxes = selectable(all, &document);
        assert_eq!(at(&boxes, 5.0, 280.0), None);
        // Lo que no está bloqueado sigue igual.
        assert_eq!(at(&boxes, 170.0, 40.0), Some("sello"));
        // Donde está el rectángulo oculto solo queda el fondo, y bloqueado.
        assert_eq!(at(&boxes, 60.0, 40.0), None);
        assert!(boxes.iter().all(|b| b.id != "borrador" && b.id != "guia"));
    }
}
