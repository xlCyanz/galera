//! A dónde se engancha lo que se está moviendo.
//!
//! Mientras se arrastra o se redimensiona, la interfaz manda la caja donde
//! la tiene el ratón y pregunta a dónde debería ir y qué guías enseñar. La
//! decisión es del núcleo (`galera_core::snap`, principio 5): aquí solo se
//! le dan las cajas de la compilación que se ve y el tamaño de la página.
//!
//! # Qué compilación
//!
//! La última que salió bien, igual que el hit-testing: es la que enseña el
//! lienzo, así que las guías salen donde están las cosas que se ven.

use galera_core::layout::MmRect;
use galera_core::snap::{self, Grips, Settings, Snapped};
use tauri::State;

use crate::commands::CommandError;
use crate::state::AppState;

/// Distancia de enganche máxima, en píxeles de pantalla: más allá, todo
/// acabaría pegándose a todo.
const MAX_THRESHOLD_PX: f64 = 48.0;

/// A dónde se ajusta la caja `rect` en la página `page`, en mm.
///
/// `ids` son los elementos que se están moviendo: ninguno cuenta como algo
/// a lo que engancharse, ni siquiera entre ellos con una multiselección.
///
/// - `grips`: qué se está moviendo en cada eje, la caja entera al arrastrar
///   o el borde del manejador al redimensionar.
/// - `settings`: la distancia de enganche en píxeles y la escala del lienzo.
///
/// Devuelve cuánto hay que correr lo que se agarra y las guías que lo
/// justifican; todo a cero y sin guías si no hay nada compilado todavía.
#[tauri::command]
pub async fn snap(
    page: usize,
    ids: Vec<String>,
    rect: MmRect,
    grips: Grips,
    settings: Settings,
    state: State<'_, AppState>,
) -> Result<Snapped, CommandError> {
    Ok(snap_in(&state, page, &ids, rect, grips, settings))
}

/// La parte de [`snap`] que no depende de Tauri, para poder probarla.
fn snap_in(
    state: &AppState,
    page: usize,
    ids: &[String],
    moving: MmRect,
    grips: Grips,
    settings: Settings,
) -> Snapped {
    let sane = [moving.x, moving.y, moving.w, moving.h]
        .iter()
        .all(|value| value.is_finite())
        && settings.threshold.is_finite()
        && settings.scale.is_finite();
    if !sane || moving.w < 0.0 || moving.h < 0.0 {
        // Con números que no son, ni la caja de vuelta vale.
        return Snapped::none(MmRect {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        });
    }
    let settings = Settings {
        threshold: settings.threshold.clamp(0.0, MAX_THRESHOLD_PX),
        ..settings
    };

    let Some(compiled) = state.last_good_compilation() else {
        return Snapped::none(moving);
    };
    let Some((_, document)) = state.open_document() else {
        return Snapped::none(moving);
    };
    let Some(size) = document.pages.get(page).map(|one| one.size.clone()) else {
        return Snapped::none(moving);
    };
    let others = snap::neighbours(&compiled.layout(), page, ids);
    snap::snap(moving, &others, &size, &settings, grips)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use galera_core::snap::{Grip, GuideKind};
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

    /// Un lienzo al 100 %: 2 píxeles por milímetro engancha a 3 mm.
    fn canvas() -> Settings {
        Settings::at(2.0)
    }

    /// La caja de un elemento del informe, tal como la midió Typst.
    fn box_of(state: &AppState, id: &str) -> MmRect {
        state
            .last_good_compilation()
            .expect("hay compilación")
            .layout()
            .into_iter()
            .find(|one| one.id == id)
            .expect("el elemento está compilado")
            .bounds
    }

    #[test]
    fn it_snaps_to_an_element_of_the_page() {
        let state = compiled("informe");
        let target = box_of(&state, "i1");
        // La imagen movida 2 mm a la derecha vuelve a su sitio de un tirón.
        let moving = MmRect {
            x: target.x + 2.0,
            ..target
        };
        let snapped = snap_in(
            &state,
            0,
            &["i1".to_owned()],
            moving,
            Grips::whole(),
            canvas(),
        );

        assert_eq!(snapped.dx, -2.0);
        assert!(!snapped.guides.is_empty());
    }

    #[test]
    fn the_element_that_moves_does_not_snap_to_itself() {
        let state = compiled("informe");
        let target = box_of(&state, "i1");
        // Sin quitarla de los vecinos, engancharía a su propia caja: 0 mm.
        let moving = MmRect {
            x: target.x + 1.0,
            ..target
        };
        let snapped = snap_in(
            &state,
            0,
            &["i1".to_owned()],
            moving,
            Grips::whole(),
            canvas(),
        );
        assert_ne!(snapped.dx, 0.0, "se engancha a otra cosa, no a sí misma");
    }

    #[test]
    fn it_snaps_to_the_edge_of_the_page() {
        let state = compiled("informe");
        let moving = MmRect {
            x: 1.0,
            y: 150.0,
            w: 20.0,
            h: 20.0,
        };
        let snapped = snap_in(
            &state,
            0,
            &["nuevo".to_owned()],
            moving,
            Grips::whole(),
            canvas(),
        );

        assert_eq!(snapped.dx, -1.0);
        assert!(
            snapped
                .guides
                .iter()
                .any(|guide| guide.kind == GuideKind::Page)
        );
    }

    #[test]
    fn resizing_snaps_only_the_edge_that_moves() {
        let state = compiled("informe");
        let target = box_of(&state, "i1");
        // La imagen va de 20 a 100; estirada hasta 103, su borde derecho
        // queda a 2 mm del centro de la página.
        let moving = MmRect { w: 83.0, ..target };
        let grips = Grips {
            x: Grip::End,
            y: Grip::None,
        };
        let snapped = snap_in(&state, 0, &["i1".to_owned()], moving, grips, canvas());

        assert_eq!(snapped.dx, 2.0, "el borde derecho acaba en 105");
        assert_eq!(snapped.dy, 0.0, "un manejador lateral no toca el alto");
        // El borde de la izquierda se queda donde estaba.
        assert_eq!(snapped.rect.x, target.x);
        assert_eq!(snapped.rect.w, 85.0);
    }

    #[test]
    fn without_a_compilation_nothing_snaps() {
        let state = AppState::default();
        let moving = MmRect {
            x: 1.0,
            y: 1.0,
            w: 10.0,
            h: 10.0,
        };
        let snapped = snap_in(
            &state,
            0,
            &["r1".to_owned()],
            moving,
            Grips::whole(),
            canvas(),
        );
        assert_eq!((snapped.dx, snapped.dy), (0.0, 0.0));
        assert!(snapped.guides.is_empty());
    }

    #[test]
    fn a_page_that_does_not_exist_does_not_snap() {
        let state = compiled("informe");
        let moving = MmRect {
            x: 1.0,
            y: 1.0,
            w: 10.0,
            h: 10.0,
        };
        let snapped = snap_in(
            &state,
            9,
            &["r1".to_owned()],
            moving,
            Grips::whole(),
            canvas(),
        );
        assert_eq!((snapped.dx, snapped.dy), (0.0, 0.0));
    }

    #[test]
    fn nonsense_numbers_do_not_snap() {
        let state = compiled("informe");
        let moving = MmRect {
            x: f64::NAN,
            y: 1.0,
            w: 10.0,
            h: 10.0,
        };
        let snapped = snap_in(
            &state,
            0,
            &["r1".to_owned()],
            moving,
            Grips::whole(),
            canvas(),
        );
        assert_eq!((snapped.dx, snapped.dy), (0.0, 0.0));
    }

    /// Una distancia de enganche enorme pegaría todo con todo.
    #[test]
    fn the_snapping_distance_has_a_ceiling() {
        let state = compiled("informe");
        let moving = MmRect {
            x: 60.0,
            y: 150.0,
            w: 20.0,
            h: 20.0,
        };
        let settings = Settings {
            threshold: 10_000.0,
            scale: 2.0,
            margin: None,
        };
        let snapped = snap_in(
            &state,
            0,
            &["nuevo".to_owned()],
            moving,
            Grips::whole(),
            settings,
        );
        // Con el techo son 24 mm: lo que haya más lejos no tira de él.
        assert!(snapped.dx.abs() <= MAX_THRESHOLD_PX / 2.0, "{}", snapped.dx);
    }
}
