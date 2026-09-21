//! Del clic al elemento.
//!
//! La interfaz pasa el clic a milímetros de la página y pregunta qué elemento
//! hay debajo. La decisión es del núcleo (`galera_core::layout::hit`,
//! principio 5): aquí solo se le dan las cajas de la compilación que se ve.
//!
//! # Qué compilación
//!
//! La última que salió bien (`AppState::last_good_compilation`). Es la que
//! enseña el lienzo, también mientras el documento tiene errores, así que el
//! clic acierta lo que se ve.
//!
//! Los elementos bloqueados se quitan antes (`hit::selectable`), mirando el
//! documento actual: bloquear vale en cuanto se bloquea.

use galera_core::layout::{MmRect, hit};
use tauri::State;

use crate::commands::CommandError;
use crate::state::AppState;

/// Tolerancia máxima, en mm: más allá, un clic cerca de un elemento pequeño
/// acabaría seleccionando otro lejano.
const MAX_TOLERANCE: f64 = 10.0;

/// El id del elemento bajo el punto `(x, y)` de la página `page`, en mm, o
/// `null` si no hay ninguno (un clic en vacío).
///
/// - `tolerance`: cuánto se ensancha cada elemento, en mm. La interfaz la
///   calcula a partir de unos píxeles fijos y el zoom, para que acertar una
///   línea cueste lo mismo a cualquier zoom.
/// - `below`: si se da el id de un elemento que está bajo el punto, se
///   devuelve el siguiente hacia abajo (Alt o ⌘ + clic).
#[tauri::command]
pub async fn element_at(
    page: usize,
    x: f64,
    y: f64,
    tolerance: f64,
    below: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, CommandError> {
    Ok(element_at_in(
        &state,
        page,
        x,
        y,
        tolerance,
        below.as_deref(),
    ))
}

/// Los elementos de `page` que toca el rectángulo de selección, en mm, de
/// abajo arriba.
///
/// Se puede arrastrar en cualquier dirección: un ancho o un alto negativos
/// valen. Los bloqueados no se cogen, igual que con el clic.
#[tauri::command]
pub async fn elements_in(
    page: usize,
    rect: MmRect,
    state: State<'_, AppState>,
) -> Result<Vec<String>, CommandError> {
    Ok(elements_in_in(&state, page, rect))
}

/// La parte de [`elements_in`] que no depende de Tauri, para poder probarla.
fn elements_in_in(state: &AppState, page: usize, rect: MmRect) -> Vec<String> {
    if ![rect.x, rect.y, rect.w, rect.h]
        .iter()
        .all(|value| value.is_finite())
    {
        return Vec::new();
    }
    let Some(compiled) = state.last_good_compilation() else {
        return Vec::new();
    };
    let Some((_, document)) = state.open_document() else {
        return Vec::new();
    };
    let boxes = hit::selectable(compiled.layout(), &document);
    hit::inside(&boxes, page, rect)
        .into_iter()
        .map(|found| found.id.clone())
        .collect()
}

/// La parte de [`element_at`] que no depende de Tauri, para poder probarla.
fn element_at_in(
    state: &AppState,
    page: usize,
    x: f64,
    y: f64,
    tolerance: f64,
    below: Option<&str>,
) -> Option<String> {
    if !x.is_finite() || !y.is_finite() {
        return None;
    }
    let tolerance = if tolerance.is_finite() {
        tolerance.clamp(0.0, MAX_TOLERANCE)
    } else {
        0.0
    };
    let compiled = state.last_good_compilation()?;
    let (_, document) = state.open_document()?;
    // Lo bloqueado no se acierta: el clic pasa al de debajo.
    let boxes = hit::selectable(compiled.layout(), &document);
    hit::element_at(&boxes, page, x, y, tolerance, below).map(|found| found.id.clone())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use galera_core::{Document, Project};

    use super::*;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// El estado con un fixture abierto y compilado.
    fn compiled(name: &str) -> AppState {
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let json =
            std::fs::read_to_string(fixtures_dir().join(format!("{name}.json"))).expect("existe");
        let state = AppState::default();
        state.open(
            project,
            Document::from_json_str(&json).expect("es un documento"),
        );
        assert!(state.compilation().is_some_and(|c| c.result.is_ok()));
        state
    }

    #[test]
    fn a_click_returns_the_element_under_it() {
        let state = compiled("informe");
        // La banda de arriba (r1) y la imagen (i1) del informe.
        assert_eq!(
            element_at_in(&state, 0, 100.0, 5.0, 0.0, None).as_deref(),
            Some("r1")
        );
        assert_eq!(
            element_at_in(&state, 0, 50.0, 100.0, 0.0, None).as_deref(),
            Some("i1")
        );
    }

    #[test]
    fn a_click_on_an_empty_spot_returns_nothing() {
        let state = compiled("informe");
        assert_eq!(element_at_in(&state, 0, 150.0, 280.0, 0.0, None), None);
    }

    #[test]
    fn a_click_on_another_page_looks_at_that_page() {
        let state = compiled("multipagina");
        // La línea separadora de la segunda página, a 148,5 mm: a medio
        // milímetro de ella solo se acierta con tolerancia.
        assert_eq!(
            element_at_in(&state, 1, 100.0, 149.0, 0.0, None),
            None,
            "sin tolerancia"
        );
        assert_eq!(
            element_at_in(&state, 1, 100.0, 149.0, 1.0, None).as_deref(),
            Some("separador")
        );
        assert_eq!(element_at_in(&state, 0, 100.0, 149.0, 1.0, None), None);
    }

    #[test]
    fn going_through_reaches_the_element_below() {
        // Un rectángulo encima de otro.
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let document = Document::from_json_str(
            r##"{ "version": 1, "meta": { "title": "x" }, "pages": [{
                "id": "p1", "size": { "width": 100, "height": 100, "unit": "mm" }, "elements": [
                  { "id": "abajo", "type": "rect", "x": 10, "y": 10, "w": 50, "h": 50, "fill": "#000000", "stroke": null },
                  { "id": "arriba", "type": "rect", "x": 20, "y": 20, "w": 10, "h": 10, "fill": "#ff0000", "stroke": null }
                ] }] }"##,
        )
        .expect("es un documento");
        let state = AppState::default();
        state.open(project, document);
        state.compilation();

        assert_eq!(
            element_at_in(&state, 0, 25.0, 25.0, 0.0, None).as_deref(),
            Some("arriba")
        );
        assert_eq!(
            element_at_in(&state, 0, 25.0, 25.0, 0.0, Some("arriba")).as_deref(),
            Some("abajo")
        );
        assert_eq!(
            element_at_in(&state, 0, 25.0, 25.0, 0.0, Some("abajo")).as_deref(),
            Some("arriba")
        );
    }

    #[test]
    fn without_a_good_compilation_nothing_is_hit() {
        assert_eq!(
            element_at_in(&AppState::default(), 0, 1.0, 1.0, 0.0, None),
            None
        );
    }

    #[test]
    fn nonsense_input_is_harmless() {
        let state = compiled("informe");
        assert_eq!(element_at_in(&state, 0, f64::NAN, 5.0, 0.0, None), None);
        // Una tolerancia enorme se limita: un clic lejos no alcanza nada.
        assert_eq!(element_at_in(&state, 0, 150.0, 280.0, 1e9, None), None);
        assert_eq!(
            element_at_in(&state, 0, 100.0, 5.0, f64::INFINITY, None).as_deref(),
            Some("r1")
        );
    }

    /// Lo bloqueado no se acierta: el clic pasa al de debajo, o a nada.
    #[test]
    fn a_locked_element_is_not_hit() {
        let state = compiled("capas");
        // El fondo cubre la página, pero está bloqueado.
        assert_eq!(element_at_in(&state, 0, 5.0, 280.0, 0.0, None), None);
        assert_eq!(
            element_at_in(&state, 0, 170.0, 40.0, 0.0, None).as_deref(),
            Some("sello")
        );
    }

    /// El criterio de la tarea: el rectángulo coge lo que toca.
    #[test]
    fn a_rectangle_takes_the_elements_it_touches() {
        let state = compiled("informe");
        // La banda de arriba (0,0 210×15) y nada más.
        let band = MmRect {
            x: 0.0,
            y: 0.0,
            w: 210.0,
            h: 20.0,
        };
        assert_eq!(elements_in_in(&state, 0, band), vec!["r1".to_owned()]);

        // Toda la página: todos, de abajo arriba.
        let whole = MmRect {
            x: 0.0,
            y: 0.0,
            w: 210.0,
            h: 297.0,
        };
        assert_eq!(
            elements_in_in(&state, 0, whole),
            vec![
                "r1".to_owned(),
                "t1".to_owned(),
                "i1".to_owned(),
                "c1".to_owned()
            ]
        );
    }

    #[test]
    fn a_rectangle_on_an_empty_spot_takes_nothing() {
        let state = compiled("informe");
        let empty = MmRect {
            x: 150.0,
            y: 270.0,
            w: 20.0,
            h: 20.0,
        };
        assert!(elements_in_in(&state, 0, empty).is_empty());
    }

    #[test]
    fn a_rectangle_without_a_compilation_takes_nothing() {
        let rect = MmRect {
            x: 0.0,
            y: 0.0,
            w: 210.0,
            h: 297.0,
        };
        assert!(elements_in_in(&AppState::default(), 0, rect).is_empty());
    }

    #[test]
    fn nonsense_numbers_take_nothing() {
        let state = compiled("informe");
        let rect = MmRect {
            x: f64::NAN,
            y: 0.0,
            w: 10.0,
            h: 10.0,
        };
        assert!(elements_in_in(&state, 0, rect).is_empty());
    }
}
