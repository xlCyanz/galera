//! Crear flujos y enlazar zonas.
//!
//! Un flujo y sus zonas son lo mismo mirado de dos maneras: el flujo lleva
//! el texto y la cadena, y cada zona dice a qué flujo pertenece (ver
//! [`crate::model::flow`]). Los comandos de aquí cambian las dos cosas a la
//! vez, para que el documento **nunca quede a medias**: ni una zona sin
//! cadena que la lleve ni una cadena que nombre lo que no existe.
//!
//! # Desenlazar no es quedarse sin flujo
//!
//! Una zona suelta no compondría nada, así que desenlazar no la deja sin
//! flujo: **la pasa a un flujo suyo**, vacío y con el mismo estilo. Lo que
//! se rompe es la cadena, que es lo que se quería; la zona sigue siendo una
//! zona y el documento sigue valiendo.

use crate::model::text::{self, Format};
use crate::model::{Document, Element, Flow};

use super::{Op, OpError};

/// Crea un flujo vacío.
pub fn apply_create(document: &mut Document, name: &str, flow: &Flow) -> Result<Op, OpError> {
    if document.flows.contains_key(name) {
        return Err(OpError::FlowNameTaken {
            name: name.to_owned(),
        });
    }
    document.flows.insert(name.to_owned(), flow.clone());
    Ok(Op::RemoveFlow {
        name: name.to_owned(),
    })
}

/// Quita un flujo que ya no pasa por ninguna zona.
pub fn apply_remove(document: &mut Document, name: &str) -> Result<Op, OpError> {
    let Some(flow) = document.flows.get(name) else {
        return Err(OpError::FlowNotFound {
            name: name.to_owned(),
        });
    };

    if !flow.zones.is_empty() {
        return Err(OpError::FlowInUse {
            name: name.to_owned(),
            zones: flow.zones.clone(),
        });
    }

    let flow = flow.clone();
    document.flows.remove(name);
    Ok(Op::CreateFlow {
        name: name.to_owned(),
        flow,
    })
}

/// Pone una zona en la cadena de un flujo, en la posición que se diga o al
/// final.
///
/// Si la zona ya estaba en otra cadena —o en otro sitio de la misma—, sale
/// de donde estuviera: una zona está en una cadena y una sola vez.
pub fn apply_link(
    document: &mut Document,
    flow: &str,
    zone: &str,
    index: Option<usize>,
) -> Result<Op, OpError> {
    check_zone(document, zone)?;
    if !document.flows.contains_key(flow) {
        return Err(OpError::FlowNotFound {
            name: flow.to_owned(),
        });
    }

    let undo = match place_of(document, zone) {
        Some((from, at)) => Op::LinkZone {
            flow: from,
            zone: zone.to_owned(),
            index: Some(at),
        },
        None => Op::UnlinkZone {
            zone: zone.to_owned(),
            to: flow.to_owned(),
        },
    };

    unlink_everywhere(document, zone);
    if let Some(one) = document.flows.get_mut(flow) {
        let at = index.unwrap_or(one.zones.len()).min(one.zones.len());
        one.zones.insert(at, zone.to_owned());
    }
    set_flow_of(document, zone, flow);

    Ok(undo)
}

/// Saca una zona de su cadena y la pasa a un flujo suyo, que se crea aquí:
/// `to` es cómo se va a llamar.
pub fn apply_unlink(document: &mut Document, zone: &str, to: &str) -> Result<Op, OpError> {
    check_zone(document, zone)?;
    if document.flows.contains_key(to) {
        return Err(OpError::FlowNameTaken {
            name: to.to_owned(),
        });
    }

    let Some((from, at)) = place_of(document, zone) else {
        return Err(OpError::NotApplicable {
            id: zone.to_owned(),
            kind: "flow",
            what: "Desenlazar".to_owned(),
        });
    };

    // El flujo nuevo hereda el estilo, no el texto: el texto se queda en la
    // cadena de la que sale la zona.
    let Some(style) = document.flows.get(&from).map(|one| one.style.clone()) else {
        return Err(OpError::FlowNotFound { name: from });
    };
    document.flows.insert(
        to.to_owned(),
        Flow {
            content: Vec::new(),
            style,
            zones: vec![zone.to_owned()],
        },
    );

    unlink_from(document, &from, zone);
    set_flow_of(document, zone, to);

    Ok(Op::Batch {
        ops: vec![
            Op::LinkZone {
                flow: from,
                zone: zone.to_owned(),
                index: Some(at),
            },
            Op::RemoveFlow {
                name: to.to_owned(),
            },
        ],
    })
}

/// Mete texto en el texto de un flujo.
///
/// Deshacer es [`Op::RestoreFlow`], como en un bloque de texto: se guarda lo
/// que había en vez de calcular el cambio contrario, que con los tramos
/// normalizados no siempre sería el mismo.
pub fn apply_insert_text(
    document: &mut Document,
    name: &str,
    at: usize,
    insertion: &str,
) -> Result<Op, OpError> {
    let before = restore(document, name)?;
    let flow = flow_mut(document, name)?;
    text::insert(&mut flow.content, at, insertion)?;
    Ok(before)
}

/// Borra el tramo `[from, to)` del texto de un flujo.
pub fn apply_delete_text(
    document: &mut Document,
    name: &str,
    from: usize,
    to: usize,
) -> Result<Op, OpError> {
    let before = restore(document, name)?;
    let flow = flow_mut(document, name)?;
    text::remove(&mut flow.content, from, to)?;
    Ok(before)
}

/// Cambia el formato del tramo `[from, to)` del texto de un flujo.
pub fn apply_format_text(
    document: &mut Document,
    name: &str,
    from: usize,
    to: usize,
    format: &Format,
) -> Result<Op, OpError> {
    let before = restore(document, name)?;
    let flow = flow_mut(document, name)?;
    text::format(&mut flow.content, from, to, format)?;
    Ok(before)
}

/// Deja un flujo tal como estaba.
pub fn apply_restore(document: &mut Document, name: &str, flow: &Flow) -> Result<Op, OpError> {
    let before = restore(document, name)?;
    document.flows.insert(name.to_owned(), flow.clone());
    Ok(before)
}

/// El comando que devuelve el flujo a como está ahora.
fn restore(document: &Document, name: &str) -> Result<Op, OpError> {
    let flow = document
        .flows
        .get(name)
        .ok_or_else(|| OpError::FlowNotFound {
            name: name.to_owned(),
        })?;

    Ok(Op::RestoreFlow {
        name: name.to_owned(),
        flow: flow.clone(),
    })
}

fn flow_mut<'a>(document: &'a mut Document, name: &str) -> Result<&'a mut Flow, OpError> {
    document
        .flows
        .get_mut(name)
        .ok_or_else(|| OpError::FlowNotFound {
            name: name.to_owned(),
        })
}

/// Saca una zona de la cadena en la que esté, sin tocar nada más.
///
/// La usa [`Op::Delete`]: al borrar una zona, su cadena no puede quedarse
/// nombrándola.
pub fn unlink_everywhere(document: &mut Document, zone: &str) {
    for one in document.flows.values_mut() {
        one.zones.retain(|other| other != zone);
    }
}

/// En qué cadena está una zona y en qué posición.
pub fn place_of(document: &Document, zone: &str) -> Option<(String, usize)> {
    document.flows.iter().find_map(|(name, one)| {
        one.position_of(zone)
            .map(|position| (name.clone(), position))
    })
}

fn unlink_from(document: &mut Document, flow: &str, zone: &str) {
    if let Some(one) = document.flows.get_mut(flow) {
        one.zones.retain(|other| other != zone);
    }
}

/// Cambia a qué flujo dice pertenecer una zona.
fn set_flow_of(document: &mut Document, zone: &str, to: &str) {
    for page in &mut document.pages {
        for element in &mut page.elements {
            if let Element::Flow { base, flow } = element
                && base.id == zone
            {
                *flow = to.to_owned();
                return;
            }
        }
    }
}

/// El elemento existe y es una zona.
fn check_zone(document: &Document, zone: &str) -> Result<(), OpError> {
    let element = document
        .element(zone)
        .ok_or_else(|| OpError::ElementNotFound {
            id: zone.to_owned(),
        })?;

    if !matches!(element, Element::Flow { .. }) {
        return Err(OpError::NotApplicable {
            id: zone.to_owned(),
            kind: element.type_name(),
            what: "Enlazar".to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TextStyle;
    use crate::model::flow::flow_of;
    use crate::ops::Op;

    /// Dos zonas enlazadas en un flujo, y una tercera suelta en otro.
    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Flujo" },
              "flows": {
                "cuerpo": {
                  "content": [{ "text": "Un texto que sigue" }],
                  "style": { "font": "Inter", "size": 11, "color": "#000000" },
                  "zones": ["z1", "z2"]
                },
                "nota": {
                  "content": [],
                  "style": { "font": "Inter", "size": 9, "color": "#666666" },
                  "zones": ["z3"]
                }
              },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z1", "type": "flow", "x": 20, "y": 20, "w": 80, "h": 100,
                      "flow": "cuerpo" },
                    { "id": "z3", "type": "flow", "x": 20, "y": 140, "w": 80, "h": 40,
                      "flow": "nota" },
                    { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                      "fill": null, "stroke": null }
                  ] },
                { "id": "p2", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z2", "type": "flow", "x": 20, "y": 20, "w": 80, "h": 100,
                      "flow": "cuerpo" }
                  ] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    fn zones(document: &Document, flow: &str) -> Vec<String> {
        document.flows[flow].zones.clone()
    }

    fn flow_field(document: &Document, zone: &str) -> String {
        flow_of(document.element(zone).expect("está"))
            .expect("es una zona")
            .to_owned()
    }

    /// El criterio de la tarea: enlazar es un comando, y se deshace.
    #[test]
    fn linking_moves_a_zone_from_one_chain_to_another() {
        let applied = Op::LinkZone {
            flow: "cuerpo".to_owned(),
            zone: "z3".to_owned(),
            index: Some(1),
        }
        .apply(&document())
        .expect("se enlaza");

        assert_eq!(zones(&applied.document, "cuerpo"), vec!["z1", "z3", "z2"]);
        assert!(zones(&applied.document, "nota").is_empty());
        // La zona dice a qué flujo pertenece, y también cambia.
        assert_eq!(flow_field(&applied.document, "z3"), "cuerpo");
        applied.document.validate().expect("sigue valiendo");

        let back = applied.undo.apply(&applied.document).expect("se deshace");
        assert_eq!(back.document, document());
    }

    #[test]
    fn linking_without_an_index_puts_the_zone_at_the_end() {
        let applied = Op::LinkZone {
            flow: "cuerpo".to_owned(),
            zone: "z3".to_owned(),
            index: None,
        }
        .apply(&document())
        .expect("se enlaza");

        assert_eq!(zones(&applied.document, "cuerpo"), vec!["z1", "z2", "z3"]);
    }

    /// Enlazar una zona que ya está en la cadena la cambia de sitio, no la
    /// repite: una zona está una sola vez.
    #[test]
    fn linking_a_zone_of_the_same_chain_moves_it() {
        let applied = Op::LinkZone {
            flow: "cuerpo".to_owned(),
            zone: "z2".to_owned(),
            index: Some(0),
        }
        .apply(&document())
        .expect("se enlaza");

        assert_eq!(zones(&applied.document, "cuerpo"), vec!["z2", "z1"]);
        applied.document.validate().expect("sigue valiendo");
    }

    /// El criterio de la tarea: desenlazar es un comando, y se deshace.
    #[test]
    fn unlinking_leaves_the_zone_in_a_flow_of_its_own() {
        let applied = Op::UnlinkZone {
            zone: "z2".to_owned(),
            to: "cuerpo-2".to_owned(),
        }
        .apply(&document())
        .expect("se desenlaza");

        assert_eq!(zones(&applied.document, "cuerpo"), vec!["z1"]);
        assert_eq!(zones(&applied.document, "cuerpo-2"), vec!["z2"]);
        assert_eq!(flow_field(&applied.document, "z2"), "cuerpo-2");
        // El texto se queda donde estaba; el estilo se hereda.
        assert!(applied.document.flows["cuerpo-2"].content.is_empty());
        assert_eq!(applied.document.flows["cuerpo-2"].style.size, 11.0);
        assert_eq!(
            applied.document.flows["cuerpo"].content[0].text,
            "Un texto que sigue"
        );
        applied.document.validate().expect("sigue valiendo");

        let back = applied.undo.apply(&applied.document).expect("se deshace");
        assert_eq!(back.document, document());
    }

    #[test]
    fn a_flow_can_be_created_and_removed() {
        let flow = Flow {
            content: Vec::new(),
            style: TextStyle {
                font: "Inter".to_owned(),
                size: 10.0,
                color: "#000000".to_owned(),
                align: Default::default(),
                leading: 0.65,
                spacing: None,
            },
            zones: Vec::new(),
        };

        let applied = Op::CreateFlow {
            name: "pie".to_owned(),
            flow: flow.clone(),
        }
        .apply(&document())
        .expect("se crea");
        assert_eq!(applied.document.flows["pie"], flow);

        let back = applied.undo.apply(&applied.document).expect("se deshace");
        assert_eq!(back.document, document());

        // Y uno por el que todavía pasan zonas no se quita.
        let error = Op::RemoveFlow {
            name: "cuerpo".to_owned(),
        }
        .apply(&document())
        .expect_err("todavía pasa por zonas");
        assert!(matches!(error, OpError::FlowInUse { .. }), "{error:?}");
    }

    #[test]
    fn a_flow_that_is_not_there_and_a_name_that_is_taken() {
        let error = Op::LinkZone {
            flow: "nada".to_owned(),
            zone: "z1".to_owned(),
            index: None,
        }
        .apply(&document())
        .expect_err("no hay flujo");
        assert!(matches!(error, OpError::FlowNotFound { .. }), "{error:?}");

        let error = Op::UnlinkZone {
            zone: "z1".to_owned(),
            to: "nota".to_owned(),
        }
        .apply(&document())
        .expect_err("el nombre está cogido");
        assert!(matches!(error, OpError::FlowNameTaken { .. }), "{error:?}");
    }

    #[test]
    fn only_a_zone_can_be_linked() {
        let error = Op::LinkZone {
            flow: "cuerpo".to_owned(),
            zone: "r1".to_owned(),
            index: None,
        }
        .apply(&document())
        .expect_err("un rectángulo no es una zona");
        assert!(
            matches!(error, OpError::NotApplicable { kind: "rect", .. }),
            "{error:?}"
        );
    }

    /// El criterio de la tarea: el texto del flujo se edita como uno solo,
    /// sin importar por qué zona vaya cada parte.
    #[test]
    fn the_text_of_a_flow_is_written_as_one() {
        let start = document();
        let applied = Op::InsertFlowText {
            flow: "cuerpo".to_owned(),
            at: 2,
            text: " mismo".to_owned(),
        }
        .apply(&start)
        .expect("se escribe");

        assert_eq!(
            applied.document.flows["cuerpo"].content[0].text,
            "Un mismo texto que sigue"
        );
        let back = applied.undo.apply(&applied.document).expect("se deshace");
        assert_eq!(back.document, start);
    }

    #[test]
    fn deleting_and_formatting_go_the_same_way() {
        let start = document();
        let applied = Op::DeleteFlowText {
            flow: "cuerpo".to_owned(),
            from: 0,
            to: 3,
        }
        .apply(&start)
        .expect("se borra");
        assert_eq!(
            applied.document.flows["cuerpo"].content[0].text,
            "texto que sigue"
        );

        let bold = Op::FormatFlowText {
            flow: "cuerpo".to_owned(),
            from: 0,
            to: 5,
            format: crate::model::text::Format {
                bold: Some(true),
                ..Default::default()
            },
        }
        .apply(&applied.document)
        .expect("se da formato");
        assert!(bold.document.flows["cuerpo"].content[0].bold);

        let back = bold.undo.apply(&bold.document).expect("se deshace");
        assert_eq!(back.document, applied.document);
    }

    #[test]
    fn writing_in_a_flow_that_is_not_there_says_so() {
        let error = Op::InsertFlowText {
            flow: "nada".to_owned(),
            at: 0,
            text: "x".to_owned(),
        }
        .apply(&document())
        .expect_err("no hay flujo");
        assert!(matches!(error, OpError::FlowNotFound { .. }), "{error:?}");
    }

    /// Borrar una zona la saca de su cadena, y deshacerlo la devuelve a su
    /// sitio: una cadena nunca nombra lo que no existe.
    #[test]
    fn deleting_a_zone_takes_it_out_of_the_chain() {
        let applied = Op::Delete {
            id: "z1".to_owned(),
        }
        .apply(&document())
        .expect("se borra");

        assert_eq!(zones(&applied.document, "cuerpo"), vec!["z2"]);
        applied.document.validate().expect("sigue valiendo");

        let back = applied.undo.apply(&applied.document).expect("se deshace");
        assert_eq!(back.document, document());
    }
}
