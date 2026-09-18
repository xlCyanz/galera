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

use serde::Serialize;
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Frame, FrameItem, Point, Size, Transform};
use typst_layout::PagedDocument;

use crate::compile::{Compiled, compile};
use crate::error::Result;
use crate::model::Document;
use crate::project::Project;

/// Prefijo de las etiquetas que pone el codegen: `<el-ID>`.
const LABEL_PREFIX: &str = "el-";

/// Un rectángulo en milímetros, con el origen arriba a la izquierda de la
/// página.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
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
    let mut open: Option<Open> = None;

    for (position, item) in frame.items() {
        match item {
            FrameItem::Tag(Tag::Start(content, _)) => {
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
                    element.extent.add(*position, item);
                }
            }
        }
    }

    found
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
        Some(LayoutBox {
            id,
            page,
            x: unrotated.min.x.to_mm(),
            y: unrotated.min.y.to_mm(),
            w: unrotated.width().to_mm(),
            h: unrotated.height().to_mm(),
            rotation: self.rotation.unwrap_or(0.0),
            bounds: drawn.to_mm(),
        })
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
    use std::path::{Path, PathBuf};

    use super::*;
    use crate::model::Element;
    use crate::testing::{PT_PER_MM, pdf_filled_rects, pdf_text_origins};

    /// Una milésima de milímetro: Typst trabaja en puntos con coma flotante.
    const TOLERANCE: f64 = 1e-3;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    fn project() -> Project {
        Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto")
    }

    fn fixture(name: &str) -> Document {
        let json = std::fs::read_to_string(fixtures_dir().join(format!("{name}.json")))
            .unwrap_or_else(|error| panic!("{name}.json: {error}"));
        Document::from_json_str(&json).expect("es un documento")
    }

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
    /// sin relleno ni borde o un bloque de código vacío.
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
            let expected: Vec<(String, usize)> = document
                .pages
                .iter()
                .enumerate()
                .flat_map(|(page, content)| {
                    content
                        .elements
                        .iter()
                        .map(move |element| (element.id().to_owned(), page))
                })
                .collect();

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

    /// Una línea ocupa la caja de sus dos extremos, vaya hacia donde vaya.
    #[test]
    fn a_line_box_spans_both_ends() {
        let boxes = boxes_of(&fixture("linea"));
        assert_box(find(&boxes, "horizontal"), (20.0, 20.0, 170.0, 0.0));
        assert_box(find(&boxes, "hacia-atras"), (20.0, 40.0, 170.0, 80.0));
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

    fn normalized(degrees: f64) -> f64 {
        let angle = degrees.rem_euclid(360.0);
        if angle > 180.0 { angle - 360.0 } else { angle }
    }

    /// Sin giro, la caja dibujada es la misma y el ángulo es 0.
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
                "bounds": { "x": 0.0, "y": 0.0, "w": 210.0, "h": 15.0 }
            })
        );
    }
}
