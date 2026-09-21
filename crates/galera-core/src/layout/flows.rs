//! Qué parte del texto de un flujo quedó en cada zona.
//!
//! El reparto lo hace Typst al componer (ver [`crate::codegen`]), y cada
//! zona deja escrito en el documento compuesto **qué rango del texto le
//! tocó**, con un `metadata` dentro de su marca. Aquí se recoge.
//!
//! ```text
//! TagStart(place <el-z1>)
//!   TagStart(metadata((from: 0, to: 120)))   ← lo que se lee aquí
//!   Group  ← el texto de la zona
//! TagEnd
//! ```
//!
//! Los rangos son de **caracteres del texto del modelo**, no del código
//! compuesto: lo que hace falta para llevar el cursor de una zona a otra y
//! para saber qué sobra después de la última.

use typst::foundations::Value;
use typst::introspection::{MetadataElem, Tag};
use typst::layout::{Frame, FrameItem};
use typst_layout::PagedDocument;

use serde::Serialize;

use crate::compile::Compiled;
use crate::error::{Diagnostic, Severity};
use crate::model::Document;

use super::element_id;

/// Qué parte del texto de un flujo quedó en una zona.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "layout.ts"))]
pub struct FlowRange {
    /// El id de la zona.
    pub zone: String,
    /// La página donde quedó, contando desde 0.
    pub page: usize,
    /// El primer carácter del texto del flujo que se compuso aquí.
    pub from: usize,
    /// El primero que ya no. Si es igual que `from`, la zona quedó vacía.
    pub to: usize,
}

impl Compiled {
    /// Qué rango del texto de su flujo quedó en cada zona, en el orden en
    /// que se dibujan.
    pub fn flows(&self) -> Vec<FlowRange> {
        ranges(self.paged())
    }
}

/// Los avisos de los flujos cuyo texto no cabe en su cadena.
///
/// Lo que sobra después de la última zona **no se dibuja en ninguna parte**:
/// a diferencia de un texto que se sale de su caja, aquí no hay nada que
/// mirar en el lienzo, así que hay que decirlo.
pub fn overflowing(document: &Document, ranges: &[FlowRange]) -> Vec<Diagnostic> {
    let mut found = Vec::new();

    for (name, flow) in &document.flows {
        let length = crate::codegen::flow_length(flow);
        let last = flow.zones.last();

        // Lo que llegó al final de la cadena: el `to` de su última zona.
        let composed = last
            .and_then(|zone| ranges.iter().find(|range| &range.zone == zone))
            .map_or(0, |range| range.to);

        if composed < length {
            found.push(Diagnostic {
                severity: Severity::Warning,
                message: format!(
                    "al texto de {name:?} le sobran {} caracteres después de su última zona",
                    length - composed
                ),
                hints: vec!["enlaza otra zona al flujo, o agranda las que tiene".to_owned()],
                element_id: last.cloned(),
            });
        }
    }

    found
}

fn ranges(document: &PagedDocument) -> Vec<FlowRange> {
    document
        .pages()
        .iter()
        .enumerate()
        .flat_map(|(page, content)| page_ranges(page, &content.frame))
        .collect()
}

fn page_ranges(page: usize, frame: &Frame) -> Vec<FlowRange> {
    let mut found = Vec::new();
    walk(page, frame, None, &mut found);
    found
}

/// Recorre un marco buscando los `metadata` de las zonas.
///
/// El rango es de la zona que esté abierta: el `metadata` va dentro de su
/// marca, que es lo que ata un rango a una zona sin contar por orden.
///
/// El `metadata` no está al lado de la marca sino dentro del marco que
/// dibuja la zona, así que la zona abierta baja con la recursión: sin eso,
/// el rango aparecería sin dueño.
fn walk(page: usize, frame: &Frame, inside: Option<&str>, found: &mut Vec<FlowRange>) {
    let mut zone: Option<String> = inside.map(str::to_owned);

    for (_, item) in frame.items() {
        match item {
            FrameItem::Tag(Tag::Start(content, _)) => {
                if let Some(id) = element_id(content) {
                    zone = Some(id);
                } else if let Some(metadata) = content.to_packed::<MetadataElem>()
                    && let Some(id) = &zone
                    && let Some((from, to)) = range_of(&metadata.value)
                {
                    found.push(FlowRange {
                        zone: id.clone(),
                        page,
                        from,
                        to,
                    });
                }
            }
            FrameItem::Tag(Tag::End(..)) => {}
            FrameItem::Group(group) => walk(page, &group.frame, zone.as_deref(), found),
            _ => {}
        }
    }
}

/// El `(from, to)` de un valor `(from: N, to: M)` de Typst.
fn range_of(value: &Value) -> Option<(usize, usize)> {
    let Value::Dict(dict) = value else {
        return None;
    };
    let number = |key| match dict.get(key) {
        Ok(Value::Int(value)) if *value >= 0 => usize::try_from(*value).ok(),
        _ => None,
    };
    Some((number("from")?, number("to")?))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::model::Run;
    use crate::project::Project;

    /// Tres zonas en dos páginas: dos en la primera y una en la segunda.
    fn document(text: &str) -> Document {
        let mut document = Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Flujo" },
              "fonts": ["fonts/Inter-Regular.ttf", "fonts/Inter-Bold.ttf"],
              "flows": {
                "cuerpo": {
                  "content": [],
                  "style": { "font": "Inter", "size": 10, "color": "#000000" },
                  "zones": ["z1", "z2", "z3"]
                }
              },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z1", "type": "flow", "x": 20, "y": 20, "w": 70, "h": 40,
                      "flow": "cuerpo" },
                    { "id": "z2", "type": "flow", "x": 110, "y": 20, "w": 70, "h": 40,
                      "flow": "cuerpo" }
                  ] },
                { "id": "p2", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z3", "type": "flow", "x": 20, "y": 20, "w": 70, "h": 40,
                      "flow": "cuerpo" }
                  ] }
              ]
            }"##,
        )
        .expect("es un documento");
        document
            .flows
            .get_mut("cuerpo")
            .expect("está")
            .content
            .push(Run::plain(text));
        document
    }

    fn project() -> Project {
        Project::open(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures"))
            .expect("fixtures/ es un proyecto")
    }

    fn ranges_of(document: &Document) -> Vec<FlowRange> {
        crate::compile(document, &project())
            .expect("compila")
            .flows()
    }

    /// El criterio de la tarea: un texto largo se reparte entre las zonas
    /// enlazadas, y el layout dice qué rango quedó en cada una.
    #[test]
    fn a_long_text_is_split_between_the_zones() {
        let document = document(&"palabra ".repeat(120));
        let found = ranges_of(&document);

        assert_eq!(found.len(), 3, "{found:#?}");
        assert_eq!(
            found
                .iter()
                .map(|range| range.zone.as_str())
                .collect::<Vec<_>>(),
            vec!["z1", "z2", "z3"]
        );
        // Las zonas de la primera página están en la 0; la tercera, en la 1.
        assert_eq!(found[0].page, 0);
        assert_eq!(found[2].page, 1);

        // Los rangos van seguidos: lo que acaba una empieza la siguiente.
        assert_eq!(found[0].from, 0);
        assert_eq!(found[1].from, found[0].to);
        assert_eq!(found[2].from, found[1].to);
        // Y cada una se lleva algo, que para eso hay texto de sobra.
        assert!(found[0].to > 0, "{found:#?}");
        assert!(found[1].to > found[1].from, "{found:#?}");
    }

    /// El corte lo decide Typst: con la misma zona más alta cabe más texto,
    /// sin que Galera cuente nada.
    #[test]
    fn a_taller_zone_takes_more_text() {
        let short = ranges_of(&document(&"palabra ".repeat(120)));

        let mut taller = document(&"palabra ".repeat(120));
        if let Some(base) = taller.pages[0].elements[0].base_mut() {
            base.h = Some(80.0);
        }
        let tall = ranges_of(&taller);

        assert!(
            tall[0].to > short[0].to,
            "{} vs {}",
            tall[0].to,
            short[0].to
        );
    }

    /// El criterio de la tarea: si el texto sobra tras la última zona, se
    /// marca como desbordado.
    #[test]
    fn what_does_not_fit_in_the_chain_is_reported() {
        let document = document(&"palabra ".repeat(400));
        let found = ranges_of(&document);
        let warnings = overflowing(&document, &found);

        assert_eq!(warnings.len(), 1, "{warnings:#?}");
        assert_eq!(warnings[0].element_id.as_deref(), Some("z3"));
        assert!(warnings[0].message.contains("sobran"), "{warnings:#?}");
    }

    #[test]
    fn a_text_that_fits_does_not_warn() {
        let document = document("Dos palabras");
        let found = ranges_of(&document);

        assert_eq!(found[0].to, "Dos palabras".chars().count());
        // Las demás zonas quedan vacías, pero no sobra nada.
        assert_eq!(found[1].from, found[1].to);
        assert!(overflowing(&document, &found).is_empty());
    }
}
