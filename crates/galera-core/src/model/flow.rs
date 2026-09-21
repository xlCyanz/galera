//! Texto que fluye: un contenido repartido entre varias zonas enlazadas.
//!
//! Un editor de cajas sueltas obliga a cortar el texto a mano cuando no
//! cabe. Aquí no: un **flujo** es un texto que vive en el documento y una
//! **cadena de zonas** por las que pasa, en orden. Lo que no cabe en una
//! sigue en la siguiente, y las zonas pueden estar en páginas distintas.
//!
//! ```text
//! flows: { "cuerpo": { content: [...], zones: ["z1", "z2", "z3"] } }
//!                                          │     │      │
//! página 1:  ┌──────┐ z1 ──────────────────┘     │      │
//! página 2:  ┌──────┐ z2 ────────────────────────┘      │
//! página 7:  ┌──────┐ z3 ───────────────────────────────┘
//! ```
//!
//! # Por qué el contenido no vive en la zona
//!
//! Porque es **uno solo**: si cada zona guardara su parte, escribir al
//! principio obligaría a repartir el texto otra vez a mano, y quién tiene
//! qué parte dependería de la última composición. Aquí las zonas solo dicen
//! **dónde** cabe el texto; cuánto entra en cada una lo decide Typst al
//! componer (principio 3).
//!
//! # Qué es una cadena válida
//!
//! - Cada zona ([`crate::Element::Flow`]) nombra su flujo, y ese flujo la
//!   lleva en su cadena: ni zonas huérfanas ni cadenas que nombran lo que no
//!   existe.
//! - Una zona está en **una** cadena y **una sola vez**: una zona repetida
//!   sería texto que vuelve sobre sí mismo.
//! - El orden de la cadena es el orden del texto, y no tiene por qué ser el
//!   de las páginas: un flujo puede volver atrás si alguien lo quiere así.
//!
//! Lo comprueba [`crate::Document::validate`]; aquí están las consultas que
//! usan tanto la validación como los comandos de enlazar y desenlazar.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Element, Run, TextStyle};

/// Un texto que fluye por una cadena de zonas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "model.ts"))]
pub struct Flow {
    /// El texto entero, partido en tramos con el mismo formato.
    ///
    /// Es de todo el flujo, no de una zona: dónde se corta lo decide la
    /// composición.
    #[serde(default)]
    pub content: Vec<Run>,
    /// Estilo que se aplica a todo el flujo.
    ///
    /// Va aquí y no en cada zona por lo mismo que el contenido: es un texto
    /// solo, y no cambiaría de fuente al pasar de página.
    pub style: TextStyle,
    /// Las zonas por las que pasa, **en orden**.
    #[serde(default)]
    pub zones: Vec<String>,
}

impl Flow {
    /// Dónde está una zona en la cadena, contando desde 0.
    pub fn position_of(&self, zone: &str) -> Option<usize> {
        self.zones.iter().position(|one| one == zone)
    }
}

/// El flujo al que dice pertenecer una zona, si el elemento es una zona.
pub fn flow_of(element: &Element) -> Option<&str> {
    match element {
        Element::Flow { flow, .. } => Some(flow),
        _ => None,
    }
}

/// Qué flujo lleva una zona en su cadena, mirando las cadenas y no lo que
/// diga la zona.
///
/// Con un documento válido es el mismo que [`flow_of`]; con uno a medio
/// arreglar, no tiene por qué, y por eso se puede preguntar por separado.
pub fn chain_with<'a>(flows: &'a BTreeMap<String, Flow>, zone: &str) -> Option<&'a str> {
    flows
        .iter()
        .find(|(_, flow)| flow.zones.iter().any(|one| one == zone))
        .map(|(name, _)| name.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Document, Problem};

    /// Un flujo que pasa por dos páginas.
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
                }
              },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z1", "type": "flow", "x": 20, "y": 20, "w": 80, "h": 100,
                      "flow": "cuerpo" }
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

    /// Los problemas de un documento, como pares (dónde, qué).
    fn problems(document: &Document) -> Vec<(String, Problem)> {
        match document.validate() {
            Ok(()) => Vec::new(),
            Err(errors) => errors
                .0
                .into_iter()
                .map(|error| (error.location.to_string(), error.problem))
                .collect(),
        }
    }

    /// El criterio de la tarea: una cadena ordenada y un contenido
    /// compartido, con zonas en páginas distintas.
    #[test]
    fn a_flow_has_one_content_and_an_ordered_chain() {
        let document = document();
        let flow = &document.flows["cuerpo"];

        assert_eq!(flow.zones, vec!["z1", "z2"]);
        assert_eq!(flow.content[0].text, "Un texto que sigue");
        assert_eq!(flow.position_of("z2"), Some(1));

        // Las dos zonas están, y en páginas distintas.
        assert_eq!(document.pages[0].elements[0].id(), "z1");
        assert_eq!(document.pages[1].elements[0].id(), "z2");
        assert!(matches!(document.element("z2"), Some(Element::Flow { .. })));
        assert!(problems(&document).is_empty(), "{:#?}", problems(&document));
    }

    #[test]
    fn the_document_survives_a_round_trip() {
        let json = document().to_json_string().expect("se serializa");
        let back = Document::from_json_str(&json).expect("se lee");
        assert_eq!(back, document());
        assert!(json.contains(r#""type":"flow""#), "{json}");
    }

    /// El criterio de la tarea: sin zonas huérfanas.
    #[test]
    fn a_zone_that_no_chain_carries_is_an_orphan() {
        let mut document = document();
        document
            .flows
            .get_mut("cuerpo")
            .expect("está")
            .zones
            .retain(|zone| zone != "z2");

        assert_eq!(
            problems(&document),
            vec![(
                "elemento \"z2\"".to_owned(),
                Problem::ZoneNotLinked {
                    flow: "cuerpo".to_owned()
                }
            )]
        );
    }

    #[test]
    fn a_zone_of_a_flow_that_is_not_declared_says_so() {
        let mut document = document();
        document.flows.clear();
        let found = problems(&document);

        assert_eq!(found.len(), 2, "{found:#?}");
        assert!(found.iter().all(|(_, problem)| matches!(
            problem,
            Problem::UnknownFlow { name } if name == "cuerpo"
        )));
    }

    /// El criterio de la tarea: sin ciclos. Una zona repetida en la cadena
    /// sería texto que vuelve sobre sí mismo.
    #[test]
    fn a_zone_cannot_be_twice_in_the_same_chain() {
        let mut document = document();
        document
            .flows
            .get_mut("cuerpo")
            .expect("está")
            .zones
            .push("z1".to_owned());

        assert_eq!(
            problems(&document),
            vec![(
                "flujo \"cuerpo\"".to_owned(),
                Problem::RepeatedZone {
                    id: "z1".to_owned()
                }
            )]
        );
    }

    #[test]
    fn a_chain_that_names_what_is_not_a_zone_says_so() {
        let mut document = document();
        document
            .flows
            .get_mut("cuerpo")
            .expect("está")
            .zones
            .push("p1".to_owned());

        assert_eq!(
            problems(&document),
            vec![(
                "flujo \"cuerpo\"".to_owned(),
                Problem::UnknownZone {
                    id: "p1".to_owned()
                }
            )]
        );
    }

    /// Dos cadenas no se pueden repartir la misma zona: el orden del texto
    /// dejaría de estar claro.
    #[test]
    fn a_zone_belongs_to_one_chain_only() {
        let mut document = document();
        let other = document.flows["cuerpo"].clone();
        document.flows.insert("aparte".to_owned(), other);

        let found = problems(&document);
        assert!(
            found
                .iter()
                .any(|(where_, problem)| where_ == "flujo \"aparte\""
                    && matches!(problem, Problem::ZoneOfAnotherFlow { id, .. } if id == "z1")),
            "{found:#?}"
        );
    }

    #[test]
    fn the_style_of_a_flow_is_validated_like_the_one_of_a_text() {
        let mut document = document();
        document.flows.get_mut("cuerpo").expect("está").style.size = 0.0;

        assert_eq!(
            problems(&document),
            vec![(
                "flujo \"cuerpo\"".to_owned(),
                Problem::NotPositive {
                    field: "style.size",
                    value: 0.0
                }
            )]
        );
    }

    /// La familia del flujo la lleva el flujo, no la zona: si no está, hay
    /// que decirlo igual (principio 4).
    #[test]
    fn the_font_family_of_a_flow_has_to_be_there() {
        let document = document();
        let errors = document
            .validate_font_families(&["Otra".to_owned()])
            .expect_err("Inter no está");

        assert_eq!(errors.0.len(), 1);
        assert_eq!(errors.0[0].location.to_string(), "flujo \"cuerpo\"");
    }

    #[test]
    fn where_a_zone_is_linked_can_be_asked() {
        let document = document();
        assert_eq!(chain_with(&document.flows, "z2"), Some("cuerpo"));
        assert_eq!(chain_with(&document.flows, "otra"), None);
        assert_eq!(
            flow_of(document.element("z1").expect("está")),
            Some("cuerpo")
        );
    }
}
