//! Historial de deshacer y rehacer sobre los comandos de [`ops`](super).
//!
//! Cada paso del historial guarda **los comandos que lo deshacen**, los que
//! devolvió [`Op::apply`], no los que lo hicieron. Deshacer los aplica; y al
//! aplicarlos, cada uno devuelve a su vez el comando que lo deshace, que es
//! justo lo que hace falta para rehacer. Así ir y volver no recalcula nada:
//! cada vuelta restaura copias exactas, y cien deshacer y cien rehacer dejan
//! el documento idéntico, sin error de coma flotante.
//!
//! # Agrupar
//!
//! Un gesto puede mandar varios comandos seguidos (los empujones con las
//! flechas, un arrastre que se partiera en varios): con el mismo `group`,
//! los comandos consecutivos se juntan en **un único paso**. Un paso que va
//! y vuelve de rehacer pierde su grupo: lo que venga después ya no se le
//! junta.
//!
//! # Límite
//!
//! La pila de deshacer guarda como mucho `limit` pasos
//! ([`DEFAULT_LIMIT`] si no se dice otra cosa); al pasarse se olvida el más
//! antiguo. Cada paso guarda como mucho una copia del elemento que cambió
//! (no del documento), así que la memoria queda acotada por el límite.
//!
//! # Rama nueva
//!
//! Un comando nuevo después de deshacer descarta lo que había para rehacer:
//! el historial es una línea, no un árbol.

use std::collections::VecDeque;

use super::{Op, OpError};
use crate::model::Document;

/// Pasos que se guardan si no se dice otra cosa.
pub const DEFAULT_LIMIT: usize = 200;

/// Un paso del historial, en cualquiera de las dos pilas.
#[derive(Debug, Clone, PartialEq)]
struct Step {
    /// Qué hizo el paso: «Mover r1». Es el mismo en las dos pilas.
    description: String,
    /// El grupo con el que se registró, si sigue abierto para juntar más.
    group: Option<String>,
    /// Los comandos que llevan el documento al otro lado del paso, en el
    /// orden en que hay que aplicarlos.
    ops: Vec<Op>,
}

/// La pila de deshacer y rehacer de un documento.
#[derive(Debug, Clone, PartialEq)]
pub struct History {
    undo: VecDeque<Step>,
    redo: Vec<Step>,
    limit: usize,
}

impl Default for History {
    fn default() -> Self {
        Self::new(DEFAULT_LIMIT)
    }
}

impl History {
    /// Un historial vacío que guarda como mucho `limit` pasos (al menos uno).
    pub fn new(limit: usize) -> Self {
        Self {
            undo: VecDeque::new(),
            redo: Vec::new(),
            limit: limit.max(1),
        }
    }

    /// Cuántos pasos guarda como mucho.
    pub fn limit(&self) -> usize {
        self.limit
    }

    /// Cambia el límite; si ya hay más pasos, se olvidan los más antiguos.
    pub fn set_limit(&mut self, limit: usize) {
        self.limit = limit.max(1);
        self.trim();
    }

    /// Aplica un comando al documento y lo apunta en el historial.
    ///
    /// Si `group` coincide con el del último paso, el comando se junta con
    /// él. Descarta lo que hubiera para rehacer.
    ///
    /// # Errores
    ///
    /// Los de [`Op::apply`]; entonces el historial no cambia.
    pub fn apply(
        &mut self,
        document: &Document,
        op: &Op,
        group: Option<&str>,
    ) -> Result<Document, OpError> {
        let applied = op.apply(document)?;
        self.redo.clear();

        match self.undo.back_mut() {
            Some(last) if group.is_some() && last.group.as_deref() == group => {
                // Lo último que se hizo es lo primero que hay que deshacer.
                last.ops.insert(0, applied.undo);
            }
            _ => {
                self.undo.push_back(Step {
                    description: op.describe(),
                    group: group.map(str::to_owned),
                    ops: vec![applied.undo],
                });
                self.trim();
            }
        }
        Ok(applied.document)
    }

    /// Deshace el último paso. Devuelve el documento resultante y qué se ha
    /// deshecho, o `None` si no hay nada que deshacer.
    ///
    /// # Errores
    ///
    /// Si el paso ya no se puede aplicar a `document` (no debería pasar si el
    /// documento solo cambia a través del historial); entonces el historial
    /// no cambia.
    pub fn undo(&mut self, document: &Document) -> Option<Result<(Document, String), OpError>> {
        let step = self.undo.pop_back()?;
        Some(match replay(document, &step) {
            Ok((document, redo)) => {
                let description = step.description.clone();
                self.redo.push(Step {
                    description: step.description,
                    group: None,
                    ops: redo,
                });
                Ok((document, description))
            }
            Err(error) => {
                self.undo.push_back(step);
                Err(error)
            }
        })
    }

    /// Rehace el último paso deshecho. Devuelve el documento resultante y
    /// qué se ha rehecho, o `None` si no hay nada que rehacer.
    ///
    /// # Errores
    ///
    /// Como en [`History::undo`].
    pub fn redo(&mut self, document: &Document) -> Option<Result<(Document, String), OpError>> {
        let step = self.redo.pop()?;
        Some(match replay(document, &step) {
            Ok((document, undo)) => {
                let description = step.description.clone();
                self.undo.push_back(Step {
                    description: step.description,
                    group: None,
                    ops: undo,
                });
                self.trim();
                Ok((document, description))
            }
            Err(error) => {
                self.redo.push(step);
                Err(error)
            }
        })
    }

    /// Qué se desharía ahora: «Mover r1».
    pub fn undo_description(&self) -> Option<&str> {
        self.undo.back().map(|step| step.description.as_str())
    }

    /// Qué se reharía ahora.
    pub fn redo_description(&self) -> Option<&str> {
        self.redo.last().map(|step| step.description.as_str())
    }

    /// Cuántos pasos se pueden deshacer.
    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }

    /// Cuántos pasos se pueden rehacer.
    pub fn redo_len(&self) -> usize {
        self.redo.len()
    }

    /// Olvida todo: al abrir otro documento.
    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    fn trim(&mut self) {
        while self.undo.len() > self.limit {
            self.undo.pop_front();
        }
    }
}

/// Aplica los comandos de un paso en orden. Devuelve el documento y los
/// comandos que vuelven atrás, ya en el orden en que hay que aplicarlos.
fn replay(document: &Document, step: &Step) -> Result<(Document, Vec<Op>), OpError> {
    let mut document = document.clone();
    let mut back = Vec::with_capacity(step.ops.len());
    for op in &step.ops {
        let applied = op.apply(&document)?;
        document = applied.document;
        back.push(applied.undo);
    }
    back.reverse();
    Ok((document, back))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Historial" },
              "pages": [{ "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" }, "elements": [
                { "id": "r1", "type": "rect", "x": 10, "y": 20, "w": 30, "h": 40, "fill": "#ff0000", "stroke": null },
                { "id": "r2", "type": "rect", "x": 50, "y": 60, "w": 10, "h": 10, "fill": "#0000ff", "stroke": null }
              ] }]
            }"##,
        )
        .expect("es un documento")
    }

    fn nudge(id: &str, dx: f64) -> Op {
        Op::Move {
            id: id.into(),
            dx,
            dy: 0.0,
        }
    }

    fn x_of(document: &Document, id: &str) -> f64 {
        document.element(id).and_then(|e| e.base()).expect("caja").x
    }

    #[test]
    fn undo_and_redo_go_back_and_forth() {
        let mut history = History::default();
        let start = document();
        let moved = history
            .apply(&start, &nudge("r1", 5.0), None)
            .expect("se aplica");
        assert_eq!(history.undo_description(), Some("Mover r1"));
        assert_eq!(history.redo_description(), None);

        let (undone, what) = history.undo(&moved).expect("hay algo").expect("se aplica");
        assert_eq!(undone, start);
        assert_eq!(what, "Mover r1");
        assert_eq!(history.undo_description(), None);
        assert_eq!(history.redo_description(), Some("Mover r1"));

        let (redone, what) = history.redo(&undone).expect("hay algo").expect("se aplica");
        assert_eq!(redone, moved);
        assert_eq!(what, "Mover r1");
        assert_eq!(history.undo_description(), Some("Mover r1"));
    }

    #[test]
    fn with_nothing_to_undo_or_redo_nothing_happens() {
        let mut history = History::default();
        assert!(history.undo(&document()).is_none());
        assert!(history.redo(&document()).is_none());
    }

    /// El criterio de salida de la fase: mover 100 veces y deshacer 100 veces
    /// deja el documento igual que al inicio. Y rehacer 100 veces, igual que
    /// al final.
    #[test]
    fn a_hundred_moves_undone_and_redone_are_exact() {
        let mut history = History::default();
        let start = document();
        let mut current = start.clone();
        for step in 0..100 {
            let id = if step % 2 == 0 { "r1" } else { "r2" };
            current = history
                .apply(&current, &nudge(id, 0.1 + f64::from(step) * 0.01), None)
                .expect("se aplica");
        }
        let end = current.clone();
        assert_eq!(history.undo_len(), 100);

        while let Some(result) = history.undo(&current) {
            current = result.expect("se aplica").0;
        }
        assert_eq!(current, start);

        while let Some(result) = history.redo(&current) {
            current = result.expect("se aplica").0;
        }
        assert_eq!(current, end);
    }

    #[test]
    fn a_whole_gesture_with_the_same_group_is_one_step() {
        let mut history = History::default();
        let start = document();
        let mut current = start.clone();
        for _ in 0..100 {
            current = history
                .apply(&current, &nudge("r1", 0.1), Some("empujar-1"))
                .expect("se aplica");
        }
        assert_eq!(history.undo_len(), 1);

        // Otro grupo, o ninguno, es otro paso.
        current = history
            .apply(&current, &nudge("r1", 1.0), Some("empujar-2"))
            .expect("se aplica");
        current = history
            .apply(&current, &nudge("r1", 1.0), None)
            .expect("se aplica");
        assert_eq!(history.undo_len(), 3);

        for _ in 0..3 {
            current = history
                .undo(&current)
                .expect("hay algo")
                .expect("se aplica")
                .0;
        }
        assert_eq!(current, start);
        assert_eq!(history.undo_len(), 0);
    }

    #[test]
    fn a_step_that_comes_back_from_redo_does_not_take_more_commands() {
        let mut history = History::default();
        let mut current = history
            .apply(&document(), &nudge("r1", 1.0), Some("g"))
            .expect("se aplica");
        current = history.undo(&current).expect("hay").expect("ok").0;
        current = history.redo(&current).expect("hay").expect("ok").0;
        history
            .apply(&current, &nudge("r1", 1.0), Some("g"))
            .expect("se aplica");
        assert_eq!(history.undo_len(), 2);
    }

    #[test]
    fn a_new_command_after_undoing_drops_the_redo_stack() {
        let mut history = History::default();
        let mut current = document();
        current = history
            .apply(&current, &nudge("r1", 1.0), None)
            .expect("ok");
        current = history
            .apply(&current, &nudge("r1", 2.0), None)
            .expect("ok");
        current = history.undo(&current).expect("hay").expect("ok").0;
        assert_eq!(history.redo_len(), 1);

        current = history
            .apply(&current, &nudge("r2", 3.0), None)
            .expect("ok");
        assert_eq!(history.redo_len(), 0);
        assert!(history.redo(&current).is_none());
        assert_eq!(history.undo_description(), Some("Mover r2"));
    }

    #[test]
    fn the_history_forgets_the_oldest_steps_past_its_limit() {
        let mut history = History::new(3);
        let mut current = document();
        for _ in 0..10 {
            current = history
                .apply(&current, &nudge("r1", 1.0), None)
                .expect("ok");
        }
        assert_eq!(history.undo_len(), 3);
        while let Some(result) = history.undo(&current) {
            current = result.expect("ok").0;
        }
        // Solo se pueden deshacer los tres últimos.
        assert!((x_of(&current, "r1") - 17.0).abs() < 1e-9);

        history.set_limit(1);
        assert_eq!(history.limit(), 1);
        assert_eq!(history.undo_len(), 0);
        assert_eq!(History::new(0).limit(), 1, "al menos un paso");
    }

    #[test]
    fn a_command_that_does_not_apply_leaves_the_history_alone() {
        let mut history = History::default();
        let current = history
            .apply(&document(), &nudge("r1", 1.0), None)
            .expect("ok");
        history.undo(&current).expect("hay").expect("ok");
        let before = history.clone();
        assert!(history.apply(&current, &nudge("nadie", 1.0), None).is_err());
        assert_eq!(history, before, "ni siquiera se descarta rehacer");
    }

    #[test]
    fn a_step_that_no_longer_applies_stays_in_the_history() {
        let mut history = History::default();
        let current = history
            .apply(&document(), &nudge("r1", 1.0), None)
            .expect("ok");
        // Un documento donde r1 ya no está.
        let other = Op::Delete { id: "r1".into() }
            .apply(&current)
            .expect("ok")
            .document;
        assert!(history.undo(&other).expect("hay").is_err());
        assert_eq!(history.undo_len(), 1);
    }

    #[test]
    fn every_kind_of_command_is_undone_and_redone_exactly() {
        let mut history = History::default();
        let start = document();
        let ops = [
            nudge("r1", 1.5),
            Op::Resize {
                id: "r1".into(),
                x: 1.0,
                y: 2.0,
                w: 3.0,
                h: None,
            },
            Op::Rotate {
                id: "r2".into(),
                rotation: 37.5,
            },
            Op::Reorder {
                id: "r1".into(),
                index: 1,
            },
            Op::Delete { id: "r2".into() },
        ];
        let mut current = start.clone();
        for op in &ops {
            current = history.apply(&current, op, None).expect("se aplica");
        }
        let end = current.clone();
        while let Some(result) = history.undo(&current) {
            current = result.expect("ok").0;
        }
        assert_eq!(current, start);
        while let Some(result) = history.redo(&current) {
            current = result.expect("ok").0;
        }
        assert_eq!(current, end);
    }
}
