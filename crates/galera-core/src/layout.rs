//! Layout: la caja real de cada elemento, tal como la compuso Typst.
//!
//! La caja que declara el documento no siempre es la que Typst dibuja: un
//! texto con alto automático (`h: null`) mide lo que midan sus líneas, y eso
//! solo lo sabe Typst (principio 3). Este módulo lee el documento compilado y
//! devuelve, por cada elemento, dónde quedó de verdad.
//!
//! Es uno de los tres módulos donde se permite usar Typst (principio 5 del
//! README), junto con `world` y `compile`. Hacia fuera solo salen
//! [`LayoutBox`] en milímetros.
//!
//! # Cómo se encuentra cada elemento
//!
//! **Por su etiqueta, no por orden ni por heurística.** El codegen coloca
//! cada elemento con `#place(…)[…] <el-ID>`, y Typst deja en el frame de la
//! página una marca de inicio con ese `place` etiquetado y otra de fin. Lo
//! que dibuja el elemento queda entre las dos, en el primer nivel de la
//! página:
//!
//! ```text
//! TagStart(place <el-r1>)          ← empieza r1
//!   Shape      en (10, 20) mm       ← un rectángulo: su geometría
//! TagEnd
//! TagStart(place <el-t1>)
//!   Group      en (50, 60) mm, 80 × 14,74 mm   ← un bloque de texto: su frame
//!     Text …
//! TagEnd
//! TagStart(place <el-g1>)
//!   Group      en (100, 150) mm, 40 × 20 mm, girado 30°   ← `rotate`
//! TagEnd
//! ```
//!
//! La caja del elemento es la unión de lo que hay entre sus marcas: el frame
//! de cada grupo, la geometría de cada forma (sin el grosor del trazo, como
//! en el documento) y el tamaño de cada imagen.
//!
//! # Elementos girados
//!
//! El codegen gira con `rotate(…, origin: center + horizon)` sin recolocar,
//! así que el grupo conserva la caja **sin girar** —que es la del documento—
//! y el giro va en su transformación. De ahí salen las dos cajas de
//! [`LayoutBox`]: `x`, `y`, `w`, `h` sin girar más `rotation`, y `bounds`, la
//! que ocupa en la página ya girado.
//!
//! # Del punto al elemento
//!
//! [`hit`] decide qué elemento hay bajo un punto de la página a partir de
//! estas cajas.
//!
//! # Dentro de un texto
//!
//! [`glyphs`] baja un nivel más: dónde quedó cada glifo de un bloque de
//! texto, para dibujar el cursor y la selección donde de verdad está el
//! texto.

pub mod glyphs;
pub mod hit;

use serde::{Deserialize, Serialize};
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Frame, FrameItem, Point, Size, Transform};
use typst::visualize::Geometry;
use typst_layout::PagedDocument;

use crate::compile::{Compiled, compile};
use crate::error::{Diagnostic, Result, Severity};
use crate::model::Document;
use crate::project::Project;

/// Prefijo de las etiquetas que pone el codegen: `<el-ID>`.
const LABEL_PREFIX: &str = "el-";

/// Un rectángulo en milímetros, con el origen arriba a la izquierda de la
/// página.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "layout.ts"))]
pub struct MmRect {
    /// Distancia desde el borde izquierdo.
    pub x: f64,
    /// Distancia desde el borde superior.
    pub y: f64,
    /// Ancho.
    pub w: f64,
    /// Alto.
    pub h: f64,
}

/// Un segmento, en milímetros, con el origen arriba a la izquierda de la
/// página.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "layout.ts"))]
pub struct MmSegment {
    /// Primer extremo.
    pub x1: f64,
    /// Primer extremo.
    pub y1: f64,
    /// Segundo extremo.
    pub x2: f64,
    /// Segundo extremo.
    pub y2: f64,
}

/// Dónde quedó un elemento al componer el documento.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "layout.ts"))]
pub struct LayoutBox {
    /// El id del elemento.
    pub id: String,
    /// La página, contando desde 0.
    pub page: usize,
    /// Esquina superior izquierda de la caja **sin girar**, en mm.
    pub x: f64,
    /// Esquina superior izquierda de la caja sin girar, en mm.
    pub y: f64,
    /// Ancho sin girar, en mm.
    pub w: f64,
    /// Alto sin girar, en mm. En un texto con alto automático, el que midió
    /// Typst.
    pub h: f64,
    /// Giro en grados, en sentido horario alrededor del centro de la caja,
    /// entre -180 y 180. 0 si no está girado.
    pub rotation: f64,
    /// La caja que ocupa en la página tal como se dibuja, ya girada,
    /// alineada con los bordes de la página. Sin giro, es la misma.
    pub bounds: MmRect,
    /// Si lo que dibuja el elemento es una sola línea, sus dos extremos
    /// **sin girar**, en mm. Su caja no dice en qué diagonal está: esto sí.
    pub line: Option<MmSegment>,
    /// Cuánto se sale el contenido por debajo de la caja, en mm, o 0 si
    /// cabe.
    ///
    /// Solo pasa con un alto fijo: con `h: null` la caja la mide Typst y
    /// siempre cabe. Lo que sobra no se recorta, se dibuja fuera del marco
    /// —también en el PDF—, así que hay que avisarlo (ver
    /// [`overflowing`]).
    pub overflow: f64,
}

/// Desde cuánto se considera que algo se sale, en mm: menos que esto es el
/// ruido de la coma flotante.
const OVERFLOW_TOLERANCE: f64 = 0.01;

/// Los avisos de los elementos cuyo contenido se sale de su caja.
///
/// Van al panel de problemas junto a los de Typst: en el PDF, lo que sobra
/// se dibuja fuera del marco, y quien edita no tiene por qué darse cuenta
/// mirando el lienzo.
pub fn overflowing(boxes: &[LayoutBox]) -> Vec<Diagnostic> {
    boxes
        .iter()
        .filter(|layout_box| layout_box.overflow > OVERFLOW_TOLERANCE)
        .map(|layout_box| Diagnostic {
            severity: Severity::Warning,
            message: format!(
                "el contenido de {:?} se sale {:.1} mm de su caja",
                layout_box.id, layout_box.overflow
            ),
            hints: vec!["quita el alto fijo para que lo mida Typst, o agranda la caja".to_owned()],
            element_id: Some(layout_box.id.clone()),
        })
        .collect()
}

impl Compiled {
    /// La caja real de cada elemento, en el orden en que se dibujan: página a
    /// página y, en cada una, de abajo arriba. Ver el módulo.
    pub fn layout(&self) -> Vec<LayoutBox> {
        boxes(self.paged())
    }
}

/// Compila un documento y devuelve la caja real de cada elemento.
///
/// Es [`compile`] seguido de [`Compiled::layout`]. Si también hace falta el
/// SVG o el PDF, mejor compilar una vez y sacar todo del mismo [`Compiled`].
///
/// # Errores
///
/// Los de [`compile`].
pub fn layout(document: &Document, project: &Project) -> Result<Vec<LayoutBox>> {
    Ok(compile(document, project)?.layout())
}

fn boxes(document: &PagedDocument) -> Vec<LayoutBox> {
    document
        .pages()
        .iter()
        .enumerate()
        .flat_map(|(page, content)| page_boxes(page, &content.frame))
        .collect()
}

/// Un elemento cuyas marcas se han abierto y todavía no se han cerrado.
struct Open {
    id: String,
    location: Option<Location>,
    extent: Extent,
}

fn page_boxes(page: usize, frame: &Frame) -> Vec<LayoutBox> {
    let mut found = Vec::new();
    walk(page, frame, Point::zero(), &mut found);
    found
}

/// Recorre un marco buscando las marcas de los elementos, y baja a los
/// marcos de dentro para encontrar los hijos de los grupos.
///
/// `offset` es dónde está este marco en la página, así que todas las cajas
/// salen en coordenadas de la página aunque estén dentro de un grupo.
///
/// **De un grupo girado no salen las cajas de sus hijos**: lo que dibujan va
/// en las coordenadas sin girar del grupo, y devolverlas como si fueran de
/// la página diría que están donde no están. El grupo sí tiene su caja.
fn walk(page: usize, frame: &Frame, offset: Point, found: &mut Vec<LayoutBox>) {
    let mut open: Option<Open> = None;
    // El siguiente grupo del marco es el bloque de un grupo del documento:
    // lo dice la etiqueta `<grp-ID>` que acaba de aparecer.
    let mut children_inside = false;

    for (position, item) in frame.items() {
        let at = offset + *position;
        match item {
            FrameItem::Tag(Tag::Start(content, _)) => {
                if is_group_block(content) {
                    children_inside = true;
                }
                // Las marcas de dentro de un elemento (una imagen, una tabla
                // de un bloque de código) no abren otro.
                if open.is_none()
                    && let Some(id) = element_id(content)
                {
                    open = Some(Open {
                        id,
                        location: content.location(),
                        extent: Extent::default(),
                    });
                }
            }
            FrameItem::Tag(Tag::End(location, ..)) => {
                if open
                    .as_ref()
                    .is_some_and(|element| element.location == Some(*location))
                    && let Some(element) = open.take()
                    && let Some(layout_box) = element.extent.into_box(element.id, page)
                {
                    found.push(layout_box);
                }
            }
            item => {
                if let Some(element) = open.as_mut() {
                    element.extent.add(at, item);
                }
                // Dentro del bloque de un grupo están las marcas de sus
                // hijos: se baja a buscarlas. En cualquier otro grupo no hay
                // nada que buscar, y una etiqueta escrita a mano en un
                // bloque de código no tiene por qué quitarle la caja a nadie.
                if let FrameItem::Group(group) = item
                    && std::mem::take(&mut children_inside)
                    && group.transform.is_identity()
                {
                    walk(page, &group.frame, at, found);
                }
            }
        }
    }
}

/// Si el contenido es el bloque de un grupo, por su etiqueta `<grp-ID>`.
fn is_group_block(content: &typst::foundations::Content) -> bool {
    content.label().is_some_and(|label| {
        label
            .resolve()
            .as_str()
            .starts_with(crate::codegen::GROUP_PREFIX)
    })
}

/// El id del elemento si el contenido es un `place` con etiqueta `<el-ID>`.
fn element_id(content: &typst::foundations::Content) -> Option<String> {
    if content.func().name() != "place" {
        return None;
    }
    let label = content.label()?;
    let label = label.resolve();
    label.as_str().strip_prefix(LABEL_PREFIX).map(str::to_owned)
}

/// Lo que ocupa lo dibujado por un elemento, mientras se recorre.
#[derive(Default)]
struct Extent {
    /// La unión de las cajas sin girar.
    unrotated: Option<Bounds>,
    /// La unión de las cajas ya giradas.
    drawn: Option<Bounds>,
    /// El giro, si algún grupo lo lleva.
    rotation: Option<f64>,
    /// Cuántas cosas ha dibujado.
    pieces: usize,
    /// Las líneas que ha dibujado, sin girar.
    lines: Vec<(Point, Point)>,
    /// Hasta dónde llega por abajo lo que hay **dentro** de los grupos: con
    /// un alto fijo, el texto que no cabe se dibuja fuera y el grupo sigue
    /// midiendo lo que se le dijo.
    bottom: Option<Abs>,
}

impl Extent {
    fn add(&mut self, position: Point, item: &FrameItem) {
        let (local, transform) = match item {
            FrameItem::Group(group) => (
                Bounds::from_size(position, group.frame.size()),
                group.transform,
            ),
            FrameItem::Shape(shape, _) => {
                let rect = shape.geometry.bbox(None);
                (
                    Bounds {
                        min: position + rect.min,
                        max: position + rect.max,
                    },
                    Transform::identity(),
                )
            }
            FrameItem::Image(_, size, _) => {
                (Bounds::from_size(position, *size), Transform::identity())
            }
            // El texto y los enlaces van siempre dentro de un grupo: su caja
            // es la del grupo.
            FrameItem::Text(_) | FrameItem::Link(..) | FrameItem::Tag(_) => return,
        };

        self.pieces += 1;
        match item {
            FrameItem::Shape(shape, _) => self.lines.extend(line_of(position, &shape.geometry)),
            // Una línea girada va dentro del grupo de `rotate`, en sus
            // coordenadas sin girar.
            FrameItem::Group(group) => {
                for (local, inner) in group.frame.items() {
                    if let FrameItem::Shape(shape, _) = inner {
                        self.lines
                            .extend(line_of(position + *local, &shape.geometry));
                    }
                }
            }
            _ => {}
        }

        if let FrameItem::Group(group) = item {
            self.bottom = content_bottom(&group.frame, position).max(self.bottom);
        }

        self.unrotated = Some(Bounds::union(self.unrotated, local));

        if transform.is_identity() {
            self.drawn = Some(Bounds::union(self.drawn, local));
        } else {
            // La transformación de un grupo se aplica respecto a su esquina.
            let corners = [
                Point::zero(),
                Point::with_x(local.width()),
                Point::with_y(local.height()),
                Point::new(local.width(), local.height()),
            ]
            .map(|corner| position + corner.transform(transform));
            let drawn = corners.into_iter().fold(None, |acc, point| {
                Some(Bounds::union(acc, Bounds::point(point)))
            });
            if let Some(drawn) = drawn {
                self.drawn = Some(Bounds::union(self.drawn, drawn));
            }
            self.rotation
                .get_or_insert_with(|| degrees(transform.ky.get(), transform.sx.get()));
        }
    }

    fn into_box(self, id: String, page: usize) -> Option<LayoutBox> {
        let unrotated = self.unrotated?;
        let drawn = self.drawn.unwrap_or(unrotated);
        let line = match self.lines.as_slice() {
            [(start, end)] if self.pieces == 1 => Some(MmSegment {
                x1: start.x.to_mm(),
                y1: start.y.to_mm(),
                x2: end.x.to_mm(),
                y2: end.y.to_mm(),
            }),
            _ => None,
        };
        // Lo que se sale por debajo de la caja. Con la caja girada no se
        // mide: el contenido va en sus coordenadas sin girar, igual que la
        // caja, así que el sobrante es el mismo.
        let overflow = self
            .bottom
            .map_or(0.0, |bottom| (bottom - unrotated.max.y).to_mm())
            .max(0.0);

        Some(LayoutBox {
            id,
            page,
            x: unrotated.min.x.to_mm(),
            y: unrotated.min.y.to_mm(),
            w: unrotated.width().to_mm(),
            h: unrotated.height().to_mm(),
            rotation: self.rotation.unwrap_or(0.0),
            bounds: drawn.to_mm(),
            line,
            overflow,
        })
    }
}

/// Hasta dónde llega por abajo lo que dibuja un marco, con sus marcos de
/// dentro, en coordenadas de la página.
///
/// El texto se mide **hasta su línea base**, que es donde Typst pone el
/// borde de abajo de un bloque medido: así un texto con el alto automático
/// no se sale nunca, y lo que sobresale es de verdad una línea que no cabe
/// y no el rabo de una «p».
fn content_bottom(frame: &Frame, offset: Point) -> Option<Abs> {
    let mut bottom: Option<Abs> = None;
    for (position, item) in frame.items() {
        let at = offset + *position;
        let found = match item {
            FrameItem::Group(group) => content_bottom(&group.frame, at),
            FrameItem::Text(_) => Some(at.y),
            FrameItem::Shape(shape, _) => Some(at.y + shape.geometry.bbox(None).max.y),
            FrameItem::Image(_, size, _) => Some(at.y + size.y),
            FrameItem::Link(..) | FrameItem::Tag(_) => None,
        };
        bottom = found.max(bottom);
    }
    bottom
}

/// Los extremos de una forma si es una línea.
fn line_of(position: Point, geometry: &Geometry) -> Option<(Point, Point)> {
    match geometry {
        Geometry::Line(end) => Some((position, position + *end)),
        _ => None,
    }
}

/// El ángulo de una rotación, en grados entre -180 y 180, a partir de su
/// seno (`ky`) y su coseno (`sx`). Positivo es sentido horario, porque el eje
/// y de la página va hacia abajo.
fn degrees(sin: f64, cos: f64) -> f64 {
    let angle = sin.atan2(cos).to_degrees();
    // Sin el ruido de coma flotante de los giros exactos: 90 y no 89,999…
    let rounded = (angle * 1e9).round() / 1e9;
    if rounded <= -180.0 {
        rounded + 360.0
    } else {
        rounded + 0.0
    }
}

/// Un rectángulo en unidades de Typst, de esquina a esquina.
#[derive(Clone, Copy)]
struct Bounds {
    min: Point,
    max: Point,
}

impl Bounds {
    fn from_size(position: Point, size: Size) -> Self {
        Self {
            min: position,
            max: position + size.to_point(),
        }
    }

    fn point(point: Point) -> Self {
        Self {
            min: point,
            max: point,
        }
    }

    fn union(acc: Option<Self>, other: Self) -> Self {
        match acc {
            None => other,
            Some(acc) => Self {
                min: acc.min.min(other.min),
                max: acc.max.max(other.max),
            },
        }
    }

    fn width(self) -> Abs {
        self.max.x - self.min.x
    }

    fn height(self) -> Abs {
        self.max.y - self.min.y
    }

    fn to_mm(self) -> MmRect {
        MmRect {
            x: self.min.x.to_mm(),
            y: self.min.y.to_mm(),
            w: self.width().to_mm(),
            h: self.height().to_mm(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Element;
    use crate::testing::{
        PT_PER_MM, fixture, fixtures_dir, pdf_filled_rects, pdf_text_origins, project,
    };

    /// Una milésima de milímetro: Typst trabaja en puntos con coma flotante.
    const TOLERANCE: f64 = 1e-3;

    /// Un documento de una página A4 con estos elementos, y la fuente Inter.
    fn page_with(elements: &str) -> Document {
        Document::from_json_str(&format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Layout" }},
              "fonts": ["fonts/Inter-Regular.ttf"],
              "pages": [{{ "id": "p1", "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                          "elements": [{elements}] }}]
            }}"##
        ))
        .expect("es un documento")
    }

    fn boxes_of(document: &Document) -> Vec<LayoutBox> {
        layout(document, &project()).expect("compila")
    }

    fn find<'a>(boxes: &'a [LayoutBox], id: &str) -> &'a LayoutBox {
        boxes
            .iter()
            .find(|layout_box| layout_box.id == id)
            .unwrap_or_else(|| panic!("no hay caja para {id:?}: {boxes:#?}"))
    }

    fn assert_close(actual: f64, expected: f64, what: &str) {
        assert!(
            (actual - expected).abs() < TOLERANCE,
            "{what}: {actual} y se esperaba {expected}"
        );
    }

    fn assert_box(layout_box: &LayoutBox, (x, y, w, h): (f64, f64, f64, f64)) {
        let id = &layout_box.id;
        assert_close(layout_box.x, x, &format!("{id}: x"));
        assert_close(layout_box.y, y, &format!("{id}: y"));
        assert_close(layout_box.w, w, &format!("{id}: ancho"));
        assert_close(layout_box.h, h, &format!("{id}: alto"));
    }

    /// Cada elemento de cada fixture tiene su caja, en su página y en el
    /// orden del documento. Incluidos los que no dibujan nada: un rectángulo
    /// sin relleno ni borde o un bloque de código vacío. Los ocultos no:
    /// no se emiten.
    #[test]
    fn every_element_of_every_fixture_has_a_box() {
        for entry in std::fs::read_dir(fixtures_dir()).expect("fixtures/") {
            let path = entry.expect("entrada").path();
            if path.extension().is_none_or(|extension| extension != "json") {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .expect("nombre");
            let document = fixture(name);
            // Los hijos de un grupo salen antes que él; los de un grupo
            // girado no salen (ver `walk`).
            fn with_children(element: &Element, page: usize, into: &mut Vec<(String, usize)>) {
                if element.layer().is_hidden() {
                    return;
                }
                if element.rotation() == 0.0 {
                    for child in element.children() {
                        with_children(child, page, into);
                    }
                }
                into.push((element.id().to_owned(), page));
            }

            let mut expected: Vec<(String, usize)> = Vec::new();
            for (page, content) in document.pages.iter().enumerate() {
                for element in &content.elements {
                    with_children(element, page, &mut expected);
                }
            }

            let found: Vec<(String, usize)> = boxes_of(&document)
                .into_iter()
                .map(|layout_box| (layout_box.id, layout_box.page))
                .collect();
            assert_eq!(found, expected, "{name}.json");
        }
    }

    /// Donde el documento fija la caja, la de Typst es la misma.
    #[test]
    fn a_box_fixed_by_the_document_is_the_same_after_layout() {
        for name in [
            "rectangulo",
            "elipse",
            "imagen",
            "codigo",
            "texto",
            "informe",
        ] {
            let document = fixture(name);
            let boxes = boxes_of(&document);
            for element in document.pages.iter().flat_map(|page| &page.elements) {
                let Some(base) = element.base() else {
                    continue;
                };
                let Some(h) = base.h else {
                    continue;
                };
                assert_box(find(&boxes, &base.id), (base.x, base.y, base.w, h));
            }
        }
    }

    /// El criterio de la tarea: el alto de un texto con `h: null` es el que
    /// midió Typst: crece con las líneas, y cada línea más añade lo mismo.
    #[test]
    fn an_automatic_height_is_the_one_typst_measured() {
        let text = |id: &str, y: f64, lines: usize| {
            let content = vec!["línea"; lines].join("\\n");
            format!(
                r##"{{ "id": "{id}", "type": "text", "x": 20, "y": {y}, "w": 60, "h": null,
                      "content": [{{ "text": "{content}" }}],
                      "style": {{ "font": "Inter", "size": 12, "color": "#000000" }} }}"##
            )
        };
        let document = page_with(&format!(
            "{}, {}, {}",
            text("una", 20.0, 1),
            text("dos", 60.0, 2),
            text("tres", 100.0, 3)
        ));
        let boxes = boxes_of(&document);
        let (one, two, three) = (
            find(&boxes, "una"),
            find(&boxes, "dos"),
            find(&boxes, "tres"),
        );

        assert!(one.h > 0.0, "{one:?}");
        assert!(
            two.h > one.h && three.h > two.h,
            "{one:?} {two:?} {three:?}"
        );
        assert_close(three.h - two.h, two.h - one.h, "cada línea añade lo mismo");
        assert_close(one.w, 60.0, "ancho");
    }

    /// El criterio de la tarea: las cajas coinciden con lo que hay en el PDF
    /// de referencia. Los rectángulos, con sus trazados; un texto con alto
    /// automático, con sus líneas: empieza en su borde izquierdo y su última
    /// línea base cae en el borde de abajo de la caja, que es donde Typst
    /// acaba un bloque de texto.
    #[test]
    fn boxes_match_the_reference_pdf() {
        let document = page_with(
            r##"{ "id": "a", "type": "rect", "x": 12.5, "y": 20, "w": 40, "h": 15, "fill": "#ff0000", "stroke": null },
                { "id": "b", "type": "rect", "x": 100, "y": 150.25, "w": 33.3, "h": 70, "fill": "#00ff00", "stroke": null },
                { "id": "t", "type": "text", "x": 30, "y": 60, "w": 70, "h": null,
                  "content": [{ "text": "Un texto con alto automático que ocupa varias líneas en la página." }],
                  "style": { "font": "Inter", "size": 11, "color": "#000000" } }"##,
        );
        let compiled = compile(&document, &project()).expect("compila");
        let boxes = compiled.layout();
        let pdf = compiled.to_pdf().expect("exporta");

        let mut rects = pdf_filled_rects(&pdf);
        rects.sort_by(|a, b| a.0.total_cmp(&b.0));
        assert_eq!(rects.len(), 2, "{rects:?}");
        for (id, (x, y, w, h)) in ["a", "b"].into_iter().zip(rects) {
            assert_box(
                find(&boxes, id),
                (x / PT_PER_MM, y / PT_PER_MM, w / PT_PER_MM, h / PT_PER_MM),
            );
        }

        let text = find(&boxes, "t");
        let lines = pdf_text_origins(&pdf);
        assert!(lines.len() >= 2, "varias líneas: {lines:?}");
        let (first_x, _) = lines[0];
        let (_, last_baseline) =
            lines.iter().cloned().fold(
                (0.0, 0.0),
                |acc, line| if line.1 > acc.1 { line } else { acc },
            );
        assert_close(first_x / PT_PER_MM, text.x, "t: borde izquierdo");
        assert_close(
            last_baseline / PT_PER_MM,
            text.y + text.h,
            "t: última línea base",
        );
    }

    /// El criterio de la tarea: las cajas se encuentran por su etiqueta. Un
    /// bloque de código que pinta algo con la misma etiqueta que otro
    /// elemento no le quita la caja.
    #[test]
    fn boxes_are_found_by_label_not_by_order_or_shape() {
        let document = page_with(
            r##"{ "id": "c1", "type": "code", "x": 10, "y": 10, "w": 50, "h": 20,
                  "source": "#place(dx: 150mm, dy: 250mm)[#rect(width: 5mm, height: 5mm, fill: red)] <el-r1>" },
                { "id": "r1", "type": "rect", "x": 80, "y": 90, "w": 30, "h": 10, "fill": "#0000ff", "stroke": null }"##,
        );
        let boxes = boxes_of(&document);
        assert_eq!(
            boxes
                .iter()
                .filter(|layout_box| layout_box.id == "r1")
                .count(),
            1,
            "{boxes:#?}"
        );
        assert_box(find(&boxes, "r1"), (80.0, 90.0, 30.0, 10.0));
        // Y el bloque de código se mide entero, con lo que pinte dentro.
        assert_box(find(&boxes, "c1"), (10.0, 10.0, 50.0, 20.0));
    }

    /// Una línea ocupa la caja de sus dos extremos, vaya hacia donde vaya, y
    /// además dice cuáles son: la caja sola no dice en qué diagonal está.
    #[test]
    fn a_line_box_spans_both_ends_and_keeps_them() {
        let boxes = boxes_of(&fixture("linea"));
        assert_box(find(&boxes, "horizontal"), (20.0, 20.0, 170.0, 0.0));
        assert_box(find(&boxes, "hacia-atras"), (20.0, 40.0, 170.0, 80.0));

        let ends = |id: &str| {
            let line = find(&boxes, id)
                .line
                .unwrap_or_else(|| panic!("{id} es una línea"));
            [line.x1, line.y1, line.x2, line.y2]
        };
        for (id, expected) in [
            ("horizontal", [20.0, 20.0, 190.0, 20.0]),
            ("hacia-atras", [190.0, 120.0, 20.0, 40.0]),
            // La girada, sin girar: sale de su primer extremo.
            ("girada", [20.0, 150.0, 120.0, 150.0]),
        ] {
            for (value, want) in ends(id).into_iter().zip(expected) {
                assert_close(value, want, id);
            }
        }

        // Lo que no es una línea no tiene extremos.
        assert!(
            boxes_of(&fixture("rectangulo"))
                .iter()
                .all(|b| b.line.is_none())
        );
    }

    /// El criterio de la tarea: un elemento girado devuelve su caja sin
    /// girar, el ángulo y la caja que ocupa ya girado.
    #[test]
    fn a_rotated_element_keeps_its_unrotated_box_and_angle() {
        let cases: [(&str, &str); 4] = [
            ("rectangulo", "girado"),
            ("elipse", "girada"),
            ("imagen", "girada"),
            ("linea", "girada"),
        ];
        for (name, id) in cases {
            let document = fixture(name);
            let element = document.element(id).expect("existe");
            let boxes = boxes_of(&document);
            let layout_box = find(&boxes, id);

            assert_close(
                layout_box.rotation,
                normalized(element.rotation()),
                &format!("{name}/{id}: ángulo"),
            );

            let (x, y, w, h) = match element {
                Element::Line { x, y, x2, .. } => (*x, *y, (x2 - x).abs(), 0.0),
                _ => {
                    let base = element.base().expect("tiene caja");
                    (base.x, base.y, base.w, layout_box.h)
                }
            };
            assert_box(layout_box, (x, y, w, h));

            // La caja girada: mismo centro, y el tamaño que da el giro.
            let angle = layout_box.rotation.to_radians();
            let (sin, cos) = (angle.sin().abs(), angle.cos().abs());
            let bounds = layout_box.bounds;
            assert_close(
                bounds.w,
                w * cos + h * sin,
                &format!("{name}/{id}: ancho girado"),
            );
            assert_close(
                bounds.h,
                w * sin + h * cos,
                &format!("{name}/{id}: alto girado"),
            );
            assert_close(
                bounds.x + bounds.w / 2.0,
                x + w / 2.0,
                &format!("{name}/{id}: centro x"),
            );
            assert_close(
                bounds.y + bounds.h / 2.0,
                y + h / 2.0,
                &format!("{name}/{id}: centro y"),
            );
        }
    }

    /// Lo que enseña la interfaz mientras se gira (F2-07) es la caja de antes
    /// girada sobre su centro. Para que coincida con lo que sale al
    /// recompilar, girar con `Op::Rotate` no puede mover ni cambiar la caja
    /// sin girar: solo el ángulo. También con el alto automático de un texto.
    #[test]
    fn rotating_keeps_the_unrotated_box_and_only_changes_the_angle() {
        let document = page_with(
            r##"{ "id": "r1", "type": "rect", "x": 30, "y": 40, "w": 60, "h": 20, "fill": "#ff0000", "stroke": null },
                { "id": "t1", "type": "text", "x": 100, "y": 10, "w": 50, "h": null,
                  "content": [{ "text": "Un texto que ocupa varias líneas al girarlo" }],
                  "style": { "font": "Inter", "size": 12, "color": "#000000", "align": "left", "leading": 0.65 } }"##,
        );
        let before = boxes_of(&document);

        for rotation in [15.0, 37.5, 90.0, -165.0, 180.0, 270.0] {
            for id in ["r1", "t1"] {
                let rotated = crate::ops::Op::Rotate {
                    id: id.to_owned(),
                    rotation,
                }
                .apply(&document)
                .expect("se aplica")
                .document;
                let boxes = boxes_of(&rotated);
                let unrotated = find(&before, id);
                let layout_box = find(&boxes, id);
                assert_box(
                    layout_box,
                    (unrotated.x, unrotated.y, unrotated.w, unrotated.h),
                );
                assert_close(
                    layout_box.rotation,
                    normalized(rotation),
                    &format!("{id} a {rotation}°"),
                );
            }
        }
    }

    fn normalized(degrees: f64) -> f64 {
        let angle = degrees.rem_euclid(360.0);
        if angle > 180.0 { angle - 360.0 } else { angle }
    }

    /// Sin giro, la caja dibujada es la misma y el ángulo es 0.
    /// El criterio de la tarea: un texto que no cabe en su caja se marca, y
    /// se dice cuánto sobra.
    #[test]
    fn a_text_that_does_not_fit_says_how_much_sticks_out() {
        let text = |id: &str, height: &str, lines: usize| {
            let content = vec!["línea"; lines].join("\\n");
            format!(
                r##"{{ "id": "{id}", "type": "text", "x": 20, "y": 20, "w": 60, "h": {height},
                      "content": [{{ "text": "{content}" }}],
                      "style": {{ "font": "Inter", "size": 12, "color": "#000000",
                                 "leading": 0.65 }} }}"##
            )
        };

        // Lo que mide de verdad un texto de cuatro líneas.
        let measured = find(&boxes_of(&page_with(&text("medido", "null", 4))), "medido").h;

        let boxes = boxes_of(&page_with(&format!(
            "{}, {}",
            text("cabe", "40", 4),
            text("no-cabe", "10", 4)
        )));
        let fits = find(&boxes, "cabe");
        let overflows = find(&boxes, "no-cabe");

        assert_eq!(fits.overflow, 0.0, "en 40 mm caben: {fits:?}");
        assert_eq!(fits.h, 40.0, "la caja es la que se pidió");

        assert_eq!(overflows.h, 10.0, "la caja sigue siendo la que se pidió");
        assert_close(
            overflows.overflow,
            measured - 10.0,
            "lo que sobra es lo que no cabe",
        );
    }

    /// Con el alto automático nunca sobra nada: la caja la mide Typst.
    #[test]
    fn an_automatic_height_never_overflows() {
        for name in ["texto", "informe", "formato", "listas"] {
            for layout_box in boxes_of(&fixture(name)) {
                assert_eq!(layout_box.overflow, 0.0, "{name}: {layout_box:?}");
            }
        }
    }

    /// El criterio de la tarea: lo que se sale sale también en el panel de
    /// problemas, con su elemento.
    #[test]
    fn what_does_not_fit_becomes_a_warning() {
        let document = page_with(
            r##"{ "id": "apretado", "type": "text", "x": 20, "y": 20, "w": 60, "h": 6,
                  "content": [{ "text": "una\nlínea\nde más" }],
                  "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##,
        );
        let boxes = boxes_of(&document);
        let warnings = overflowing(&boxes);

        assert_eq!(warnings.len(), 1, "{boxes:?}");
        let warning = &warnings[0];
        assert_eq!(warning.severity, Severity::Warning);
        assert_eq!(warning.element_id.as_deref(), Some("apretado"));
        assert!(warning.message.contains("se sale"), "{warning:?}");
        assert!(!warning.hints.is_empty(), "dice qué hacer");

        // Y lo que cabe no avisa de nada.
        assert!(overflowing(&boxes_of(&fixture("texto"))).is_empty());
    }

    #[test]
    fn an_unrotated_element_has_the_same_bounds() {
        let boxes = boxes_of(&fixture("informe"));
        for layout_box in &boxes {
            assert_eq!(layout_box.rotation, 0.0, "{layout_box:?}");
            assert_eq!(
                layout_box.bounds,
                MmRect {
                    x: layout_box.x,
                    y: layout_box.y,
                    w: layout_box.w,
                    h: layout_box.h
                }
            );
        }
    }

    #[test]
    fn angles_are_between_minus_180_and_180() {
        assert_close(degrees(1.0, 0.0), 90.0, "90");
        assert_close(degrees(-0.5, 3f64.sqrt() / 2.0), -30.0, "-30");
        assert_close(degrees(0.0, -1.0), 180.0, "180");
        assert_close(degrees(-1e-12, -1.0), 180.0, "-180 pasa a 180");
        assert_eq!(degrees(0.0, 1.0), 0.0);
    }

    #[test]
    fn a_box_serializes_with_its_bounds() {
        let boxes = boxes_of(&fixture("informe"));
        let json = serde_json::to_value(find(&boxes, "r1")).expect("serializa");
        assert_eq!(
            json,
            serde_json::json!({
                "id": "r1", "page": 0, "x": 0.0, "y": 0.0, "w": 210.0, "h": 15.0, "rotation": 0.0,
                "bounds": { "x": 0.0, "y": 0.0, "w": 210.0, "h": 15.0 },
                "line": null, "overflow": 0.0
            })
        );
    }

    /// El criterio de la tarea: el layout devuelve la caja del grupo y las
    /// de sus hijos, todas en coordenadas de la página.
    #[test]
    fn a_group_has_a_box_and_so_do_its_children() {
        let document = page_with(
            r##"{ "id": "g1", "type": "group", "x": 20, "y": 30, "w": 80, "h": 40, "children": [
                  { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 20, "h": 10, "fill": "#ff0000" },
                  { "id": "r2", "type": "rect", "x": 50, "y": 20, "w": 20, "h": 10, "fill": "#00ff00" }
                ] }"##,
        );
        let boxes = boxes_of(&document);

        assert_box(find(&boxes, "g1"), (20.0, 30.0, 80.0, 40.0));
        // Los hijos van en coordenadas de la página: 20+0 y 20+50.
        assert_box(find(&boxes, "r1"), (20.0, 30.0, 20.0, 10.0));
        assert_box(find(&boxes, "r2"), (70.0, 50.0, 20.0, 10.0));
        // Y el grupo se dibuja después de sus hijos, que es lo que hace que
        // el clic acierte el grupo y no lo que lleva dentro.
        let order: Vec<&str> = boxes.iter().map(|one| one.id.as_str()).collect();
        assert_eq!(order, vec!["r1", "r2", "g1"]);
    }

    #[test]
    fn a_group_inside_another_group_also_has_its_boxes() {
        let document = page_with(
            r##"{ "id": "g1", "type": "group", "x": 10, "y": 10, "w": 100, "h": 100, "children": [
                  { "id": "g2", "type": "group", "x": 20, "y": 20, "w": 50, "h": 50, "children": [
                    { "id": "r1", "type": "rect", "x": 5, "y": 5, "w": 10, "h": 10, "fill": "#ff0000" }
                  ] }
                ] }"##,
        );
        let boxes = boxes_of(&document);

        assert_box(find(&boxes, "g1"), (10.0, 10.0, 100.0, 100.0));
        assert_box(find(&boxes, "g2"), (30.0, 30.0, 50.0, 50.0));
        assert_box(find(&boxes, "r1"), (35.0, 35.0, 10.0, 10.0));
    }

    /// De un grupo girado sale su caja, pero no las de sus hijos: lo que
    /// dibujan va en las coordenadas sin girar del grupo.
    #[test]
    fn a_turned_group_keeps_its_children_to_itself() {
        let document = page_with(
            r##"{ "id": "g1", "type": "group", "x": 20, "y": 30, "w": 80, "h": 40, "rotation": 30,
                  "children": [
                  { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 20, "h": 10, "fill": "#ff0000" }
                ] }"##,
        );
        let boxes = boxes_of(&document);

        let group = find(&boxes, "g1");
        assert_box(group, (20.0, 30.0, 80.0, 40.0));
        assert_close(group.rotation, 30.0, "el giro del grupo");
        assert!(
            !boxes.iter().any(|one| one.id == "r1"),
            "sin caja para el hijo: {boxes:#?}"
        );
    }

    /// Un hijo oculto no se emite, igual que en la página.
    #[test]
    fn a_hidden_child_has_no_box() {
        let document = page_with(
            r##"{ "id": "g1", "type": "group", "x": 20, "y": 30, "w": 80, "h": 40, "children": [
                  { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 20, "h": 10, "fill": "#ff0000",
                    "hidden": true },
                  { "id": "r2", "type": "rect", "x": 50, "y": 20, "w": 20, "h": 10, "fill": "#00ff00" }
                ] }"##,
        );
        let boxes = boxes_of(&document);
        assert!(!boxes.iter().any(|one| one.id == "r1"));
        assert_box(find(&boxes, "r2"), (70.0, 50.0, 20.0, 10.0));
    }
}
