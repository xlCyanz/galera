//! Criterio de salida de la Fase 2: aplicar cien comandos y deshacerlos todos
//! deja el documento **byte a byte** igual que al principio.
//!
//! Se compara el JSON serializado, no los documentos: así un `-0.0` que
//! apareciera en vez de `0.0`, o un `60.000000000000014` en vez de `60`,
//! también se detectaría. Los desplazamientos son a propósito números que
//! no se pueden representar exactos en binario (0,1, 1/3…): si deshacer
//! restara lo que se sumó, el error se acumularía y la prueba fallaría.
//!
//! Además de deshacer, se rehace todo y se compara con el documento al que
//! se había llegado: el historial no puede perder ni inventar estado a la
//! ida ni a la vuelta.

use std::path::{Path, PathBuf};

use galera_core::{Document, Element, History, Op};

/// Cuántos comandos aplica cada prueba.
const COMMANDS: usize = 100;

/// Todos los fixtures: tienen de todo (textos con alto automático, líneas,
/// imágenes, bloques de código, elementos girados, varias páginas).
const FIXTURES: &[&str] = &[
    "codigo",
    "elipse",
    "escape",
    "imagen",
    "informe",
    "linea",
    "multipagina",
    "rectangulo",
    "texto",
];

fn load(name: &str) -> Document {
    let path: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(format!("{name}.json"));
    let json = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("no se puede leer {}: {error}", path.display()));
    Document::from_json_str(&json).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn json(document: &Document) -> String {
    document
        .to_json_string()
        .expect("un documento siempre se serializa")
}

/// Todos los elementos del documento, en orden.
fn elements(document: &Document) -> Vec<&Element> {
    document
        .pages
        .iter()
        .flat_map(|page| page.elements.iter())
        .collect()
}

/// Números pseudoaleatorios deterministas: la prueba falla siempre igual.
struct Lcg(u64);

impl Lcg {
    /// Un número en [0, 1).
    fn next(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        // Los 53 bits altos, como hace `rand` para un f64.
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Un número en [min, max).
    fn between(&mut self, min: f64, max: f64) -> f64 {
        min + (max - min) * self.next()
    }

    /// Un índice en [0, len).
    fn index(&mut self, len: usize) -> usize {
        ((self.next() * len as f64) as usize).min(len - 1)
    }
}

/// Qué tipo de comando genera cada prueba.
#[derive(Clone, Copy, Debug)]
enum Kind {
    Move,
    Resize,
    Rotate,
    Mixed,
}

/// Un comando del tipo pedido sobre algún elemento de `document`, o `None`
/// si no hay ninguno al que se le pueda aplicar.
fn command(kind: Kind, document: &Document, random: &mut Lcg, step: usize) -> Option<Op> {
    let kind = match kind {
        Kind::Mixed => [Kind::Move, Kind::Resize, Kind::Rotate][step % 3],
        other => other,
    };
    let candidates: Vec<&Element> = elements(document)
        .into_iter()
        // Una línea no tiene caja que redimensionar.
        .filter(|element| !matches!(kind, Kind::Resize) || element.base().is_some())
        .collect();
    if candidates.is_empty() {
        return None;
    }
    let element = candidates[random.index(candidates.len())];
    let id = element.id().to_owned();

    Some(match kind {
        Kind::Move => {
            // Pasos que no son exactos en binario.
            let awkward = [0.1, -0.2, 1.0 / 3.0, -0.7, 2.54 / 3.0];
            Op::Move {
                id,
                dx: awkward[step % awkward.len()] * random.between(0.5, 3.0),
                dy: -awkward[(step + 2) % awkward.len()] * random.between(0.5, 3.0),
            }
        }
        Kind::Resize => {
            let base = element.base().expect("filtrado arriba");
            Op::Resize {
                id,
                x: base.x + random.between(-1.0, 1.0) / 3.0,
                y: base.y + random.between(-1.0, 1.0) / 7.0,
                w: (base.w * random.between(0.9, 1.1)).max(1.0),
                // Uno de cada cuatro deja o pone el alto automático.
                h: if step.is_multiple_of(4) {
                    None
                } else {
                    Some(random.between(1.0, 80.0) / 3.0)
                },
            }
        }
        Kind::Rotate => Op::Rotate {
            id,
            rotation: random.between(-360.0, 360.0) / 7.0,
        },
        Kind::Mixed => unreachable!("resuelto arriba"),
    })
}

/// Aplica `COMMANDS` comandos a cada fixture, los deshace todos y los rehace
/// todos, comparando el JSON en cada extremo.
fn check_round_trip(kind: Kind, seed: u64) {
    for name in FIXTURES {
        let start = load(name);
        let initial = json(&start);
        let mut random = Lcg(seed);
        let mut history = History::new(COMMANDS * 2);
        let mut current = start;

        let mut applied = 0;
        for step in 0..COMMANDS {
            let Some(op) = command(kind, &current, &mut random, step) else {
                break;
            };
            current = history
                .apply(&current, &op, None)
                .unwrap_or_else(|error| panic!("{name}, {kind:?} {step}: {op:?}: {error}"));
            applied += 1;
        }
        if applied == 0 {
            // Un fixture sin elementos a los que aplicarlo (p. ej. solo
            // líneas al redimensionar): no hay nada que comprobar.
            continue;
        }
        let end = json(&current);
        assert_ne!(
            end, initial,
            "{name}, {kind:?}: los comandos no cambiaron nada"
        );
        assert_eq!(history.undo_len(), applied, "{name}, {kind:?}");

        for step in 0..applied {
            current = history
                .undo(&current)
                .unwrap_or_else(|| panic!("{name}, {kind:?}: falta el paso {step} al deshacer"))
                .unwrap_or_else(|error| panic!("{name}, {kind:?}: deshacer {step}: {error}"))
                .0;
        }
        assert!(
            history.undo(&current).is_none(),
            "{name}, {kind:?}: sobran pasos"
        );
        assert_eq!(
            json(&current),
            initial,
            "{name}, {kind:?}: deshacer todo no deja el documento como al principio"
        );

        for step in 0..applied {
            current = history
                .redo(&current)
                .unwrap_or_else(|| panic!("{name}, {kind:?}: falta el paso {step} al rehacer"))
                .unwrap_or_else(|error| panic!("{name}, {kind:?}: rehacer {step}: {error}"))
                .0;
        }
        assert!(
            history.redo(&current).is_none(),
            "{name}, {kind:?}: sobran pasos"
        );
        assert_eq!(
            json(&current),
            end,
            "{name}, {kind:?}: rehacer todo no deja el documento como al final"
        );
    }
}

#[test]
fn a_hundred_moves_undone_leave_the_same_bytes() {
    check_round_trip(Kind::Move, 1);
}

#[test]
fn a_hundred_resizes_undone_leave_the_same_bytes() {
    check_round_trip(Kind::Resize, 2);
}

#[test]
fn a_hundred_rotations_undone_leave_the_same_bytes() {
    check_round_trip(Kind::Rotate, 3);
}

#[test]
fn a_hundred_mixed_commands_undone_leave_the_same_bytes() {
    check_round_trip(Kind::Mixed, 4);
}

/// Ir y volver muchas veces a mitad del historial tampoco acumula nada.
#[test]
fn going_back_and_forth_many_times_does_not_drift() {
    let start = load("informe");
    let mut random = Lcg(5);
    let mut history = History::new(COMMANDS);
    let mut current = start.clone();
    let mut snapshots = vec![json(&start)];
    for step in 0..COMMANDS {
        let op = command(Kind::Mixed, &current, &mut random, step).expect("hay elementos");
        current = history.apply(&current, &op, None).expect("se aplica");
        snapshots.push(json(&current));
    }

    // Desde el final, retroceder y avanzar tramos de distinto largo, y
    // comprobar en cada parada que el documento es el que había ahí.
    let mut position = COMMANDS;
    for round in 0..50 {
        let back = 1 + random.index(position.max(1));
        for _ in 0..back.min(position) {
            current = history.undo(&current).expect("hay").expect("se aplica").0;
            position -= 1;
        }
        assert_eq!(json(&current), snapshots[position], "vuelta {round}, atrás");

        let forward = random.index(COMMANDS - position + 1);
        for _ in 0..forward {
            current = history.redo(&current).expect("hay").expect("se aplica").0;
            position += 1;
        }
        assert_eq!(
            json(&current),
            snapshots[position],
            "vuelta {round}, adelante"
        );
    }
}

/// Cien comandos del mismo gesto son un paso, y deshacerlo deja los mismos
/// bytes.
#[test]
fn a_hundred_grouped_moves_are_one_step_and_undo_exactly() {
    let start = load("informe");
    let initial = json(&start);
    let mut history = History::default();
    let mut current = start;
    for _ in 0..COMMANDS {
        current = history
            .apply(
                &current,
                &Op::Move {
                    id: "r1".into(),
                    dx: 0.1,
                    dy: 1.0 / 3.0,
                },
                Some("arrastre"),
            )
            .expect("se aplica");
    }
    assert_eq!(history.undo_len(), 1);
    current = history.undo(&current).expect("hay").expect("se aplica").0;
    assert_eq!(json(&current), initial);
}

/// Por qué hace falta todo esto: deshacer restando lo que se sumó no vuelve
/// a los mismos bytes. Si un día el historial deshiciera así, las pruebas de
/// arriba lo detectarían.
#[test]
fn undoing_by_subtracting_would_drift() {
    let start = load("informe");
    let step = |dx: f64, dy: f64| Op::Move {
        id: "r1".into(),
        dx,
        dy,
    };
    let mut current = start.clone();
    for _ in 0..COMMANDS {
        current = step(0.1, 1.0 / 3.0)
            .apply(&current)
            .expect("se aplica")
            .document;
    }
    for _ in 0..COMMANDS {
        current = step(-0.1, -1.0 / 3.0)
            .apply(&current)
            .expect("se aplica")
            .document;
    }
    assert_ne!(json(&current), json(&start));
}
