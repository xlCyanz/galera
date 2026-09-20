//! Validación del documento.
//!
//! Un JSON puede estar bien formado y aun así describir un documento
//! incoherente: dos elementos con el mismo id, una imagen que apunta a un
//! recurso que no existe, un ancho negativo. Validar antes de compilar hace
//! que el error diga **qué elemento** falla y **por qué**, en vez de dejar
//! que salga, tres capas más abajo, como un mensaje de Typst incomprensible.
//!
//! # Dos pasos
//!
//! - [`Document::validate`] comprueba todo lo que se puede saber mirando solo
//!   el modelo. No toca el disco ni Typst.
//! - [`Document::validate_font_families`] comprueba que cada familia
//!   tipográfica que usa un estilo la proporciona alguna de las fuentes que
//!   el documento declara. Eso no se puede saber sin leer los archivos de
//!   fuente —`fonts` guarda rutas, no familias—, así que recibe las familias
//!   ya cargadas.
//!
//! Los dos devuelven **todos** los problemas, no solo el primero: quien
//! arregla un documento prefiere verlos de una vez.
//!
//! # Las reglas de ids y colores viven aquí
//!
//! [`is_valid_id`] y [`is_valid_color`] son también las que usa el codegen
//! como última línea de defensa. Una sola definición: validación y codegen no
//! pueden discrepar.

use std::collections::HashSet;
use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::model::{Document, Element, ElementBox, MAX_LIST_LEVEL, Stroke};

/// Dónde está el problema.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Location {
    /// En una página, identificada por su id.
    Page {
        /// El id de la página.
        id: String,
    },
    /// En un elemento, identificado por su id.
    Element {
        /// El id del elemento.
        id: String,
    },
}

impl fmt::Display for Location {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Location::Page { id } => write!(f, "página {id:?}"),
            Location::Element { id } => write!(f, "elemento {id:?}"),
        }
    }
}

/// Qué está mal.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Problem {
    /// Otro elemento o página ya usa este id.
    DuplicateId,
    /// El id tiene caracteres que no se admiten.
    InvalidId,
    /// Una imagen se refiere a una clave que no está en `assets`.
    UnknownAsset {
        /// La clave que no se encontró.
        key: String,
    },
    /// Ninguna fuente declarada proporciona esta familia.
    UnknownFontFamily {
        /// La familia que se pidió.
        family: String,
    },
    /// Una medida que tiene que ser mayor que cero no lo es.
    NotPositive {
        /// Qué medida, como se llama en el JSON.
        field: &'static str,
        /// El valor que tenía.
        value: f64,
    },
    /// Una medida que no puede ser negativa lo es.
    Negative {
        /// Qué medida, como se llama en el JSON.
        field: &'static str,
        /// El valor que tenía.
        value: f64,
    },
    /// Hay estilos de línea para líneas que no existen.
    TooManyLines {
        /// Cuántos estilos hay.
        lines: usize,
        /// Cuántas líneas tiene el texto.
        text: usize,
    },
    /// Una lista se anida más de lo que se admite.
    ListTooDeep {
        /// El nivel que se pidió.
        level: u8,
    },
    /// Un enlace no lleva a la web ni al correo.
    InvalidLink {
        /// El destino tal como está en el JSON.
        value: String,
    },

    /// Un color no tiene forma de color hexadecimal.
    InvalidColor {
        /// Qué color, como se llama en el JSON.
        field: &'static str,
        /// El valor que tenía.
        value: String,
    },
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Problem::DuplicateId => write!(f, "el id ya lo usa otro elemento o página"),
            Problem::InvalidId => write!(
                f,
                "el id solo puede tener letras y dígitos ASCII, guion y guion bajo"
            ),
            Problem::UnknownAsset { key } => {
                write!(f, "usa el recurso {key:?}, que no está declarado en assets")
            }
            Problem::UnknownFontFamily { family } => write!(
                f,
                "usa la familia {family:?}, que no la proporciona ninguna fuente declarada en fonts"
            ),
            Problem::NotPositive { field, value } => {
                write!(f, "{field} tiene que ser mayor que cero, y es {value}")
            }
            Problem::Negative { field, value } => {
                write!(f, "{field} no puede ser negativo, y es {value}")
            }
            Problem::TooManyLines { lines, text } => write!(
                f,
                "lines tiene {lines} entradas y el texto tiene {text} líneas"
            ),
            Problem::ListTooDeep { level } => write!(
                f,
                "una lista no se puede anidar hasta el nivel {level}: el máximo es {MAX_LIST_LEVEL}"
            ),
            Problem::InvalidLink { value } => write!(
                f,
                "el enlace {value:?} no vale: solo http://, https:// y mailto:"
            ),
            Problem::InvalidColor { field, value } => write!(
                f,
                "{field} = {value:?} no es un color: se espera #RGB, #RGBA, #RRGGBB o #RRGGBBAA"
            ),
        }
    }
}

/// Un problema concreto del documento, con el sitio donde está.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidationError {
    /// La página o el elemento que lo provoca.
    pub location: Location,
    /// Qué está mal.
    pub problem: Problem,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.location, self.problem)
    }
}

/// Se serializa con el mensaje ya redactado, además de los datos, para que la
/// interfaz pueda enseñarlo tal cual o usar los campos.
impl Serialize for ValidationError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut error = serializer.serialize_struct("ValidationError", 3)?;
        error.serialize_field("location", &self.location)?;
        error.serialize_field("problem", &self.problem)?;
        error.serialize_field("message", &self.problem.to_string())?;
        error.end()
    }
}

/// Todos los problemas de un documento. Nunca está vacío.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ValidationErrors(pub Vec<ValidationError>);

impl ValidationErrors {
    /// Los problemas, en el orden en que aparecen en el documento.
    pub fn iter(&self) -> impl Iterator<Item = &ValidationError> {
        self.0.iter()
    }

    /// Cuántos problemas hay.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Siempre `false`: un `ValidationErrors` vacío no se construye.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Display for ValidationErrors {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self.0.len();
        write!(
            f,
            "el documento tiene {count} {}",
            if count == 1 { "problema" } else { "problemas" }
        )?;
        for error in &self.0 {
            write!(f, "\n  - {error}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ValidationErrors {}

/// ¿Es un id aceptable para una página o un elemento?
///
/// Letras y dígitos ASCII, guion y guion bajo, y al menos un carácter. Es
/// deliberadamente estricto: los ids acaban escritos en el código generado,
/// dentro de etiquetas `<el-ID>` y de comentarios, donde no hay forma de
/// escapar nada. La app los genera así; uno que no lo cumpla viene de un
/// archivo editado a mano.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// ¿Es un color aceptable?
///
/// Las cuatro formas hexadecimales que entiende `rgb()` de Typst: `#RGB`,
/// `#RGBA`, `#RRGGBB` y `#RRGGBBAA`. Nada más: el color acaba dentro de una
/// cadena de Typst, y aceptar cualquier texto dejaría cerrarla.
pub fn is_valid_color(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };

    matches!(digits.len(), 3 | 4 | 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

/// ¿Es un destino de enlace aceptable?
///
/// Solo la web y el correo: `http://`, `https://` y `mailto:`. Nada de
/// `javascript:` ni `file:`, que en un lector de PDF no son ir a una página
/// sino hacer algo en el ordenador de quien lo abre. Un documento de Galera
/// es lo que se ve, no lo que hace (principio 6).
///
/// Tampoco se aceptan espacios ni caracteres de control: el destino acaba
/// dentro de una cadena de Typst y en el PDF.
pub fn is_valid_link(value: &str) -> bool {
    let known = ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| value.len() > scheme.len() && value.starts_with(scheme));
    known && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}

impl Document {
    /// Comprueba todo lo que se puede saber del documento sin leer archivos.
    ///
    /// - Ids de página y de elemento válidos y únicos en todo el documento.
    /// - Toda imagen se refiere a una clave de `assets`.
    /// - Anchos, altos, tamaños de página, tamaños de fuente y grosores de
    ///   trazo mayores que cero; radios no negativos.
    /// - Colores con forma hexadecimal.
    ///
    /// # Errores
    ///
    /// Todos los problemas encontrados, cada uno con la página o el elemento
    /// que lo provoca.
    pub fn validate(&self) -> Result<(), ValidationErrors> {
        let mut report = Report::default();
        let mut seen_ids = HashSet::new();

        for page in &self.pages {
            let at_page = || Location::Page {
                id: page.id.clone(),
            };

            report.check_id(&page.id, &mut seen_ids, at_page);
            report.positive("size.width", page.size.width, at_page);
            report.positive("size.height", page.size.height, at_page);

            for element in &page.elements {
                let at = || Location::Element {
                    id: element.id().to_owned(),
                };

                report.check_id(element.id(), &mut seen_ids, at);

                if let Some(base) = element.base() {
                    report.check_box(base, at);
                }

                match element {
                    Element::Rect {
                        fill,
                        stroke,
                        radius,
                        ..
                    } => {
                        report.optional_color("fill", fill.as_deref(), at);
                        report.optional_stroke(stroke.as_ref(), at);
                        report.not_negative("radius", *radius, at);
                    }
                    Element::Ellipse { fill, stroke, .. } => {
                        report.optional_color("fill", fill.as_deref(), at);
                        report.optional_stroke(stroke.as_ref(), at);
                    }
                    Element::Line { stroke, .. } => {
                        report.optional_stroke(Some(stroke), at);
                    }
                    Element::Text {
                        style,
                        content,
                        lines,
                        ..
                    } => {
                        report.positive("style.size", style.size, at);
                        report.color("style.color", &style.color, at);

                        // Los estilos de línea van por número de línea: no
                        // puede haber más que líneas.
                        let text: usize = content
                            .iter()
                            .map(|run| run.text.replace("\r\n", "\n").matches('\n').count())
                            .sum::<usize>()
                            + 1;
                        if lines.len() > text {
                            report.push(
                                at(),
                                Problem::TooManyLines {
                                    lines: lines.len(),
                                    text,
                                },
                            );
                        }
                        for line in lines {
                            if line.level > MAX_LIST_LEVEL {
                                report.push(at(), Problem::ListTooDeep { level: line.level });
                            }
                        }
                        for run in content {
                            report.optional_color("content.color", run.color.as_deref(), at);
                            if let Some(link) = &run.link
                                && !is_valid_link(link)
                            {
                                report.push(
                                    at(),
                                    Problem::InvalidLink {
                                        value: link.clone(),
                                    },
                                );
                            }
                        }
                    }
                    Element::Image { asset, .. } => {
                        if !self.assets.contains_key(asset) {
                            report.push(at(), Problem::UnknownAsset { key: asset.clone() });
                        }
                    }
                    Element::Code { .. } => {}
                }
            }
        }

        report.finish()
    }

    /// Comprueba que cada familia tipográfica que usa un estilo la
    /// proporciona alguna de las fuentes cargadas.
    ///
    /// `available` son las familias de las fuentes que declara el documento,
    /// ya leídas de sus archivos. Se comparan sin distinguir mayúsculas, como
    /// hace Typst.
    ///
    /// Sin esta comprobación, Typst no falla: avisa y compone el texto con
    /// otra fuente. Es justo el cambio silencioso que el principio 4 quiere
    /// evitar.
    ///
    /// # Errores
    ///
    /// Un problema por cada elemento de texto cuya familia no está.
    pub fn validate_font_families(&self, available: &[String]) -> Result<(), ValidationErrors> {
        let available: HashSet<String> = available
            .iter()
            .map(|family| family.to_lowercase())
            .collect();

        let mut report = Report::default();
        for element in self.pages.iter().flat_map(|page| &page.elements) {
            if let Element::Text { style, .. } = element
                && !available.contains(&style.font.to_lowercase())
            {
                report.push(
                    Location::Element {
                        id: element.id().to_owned(),
                    },
                    Problem::UnknownFontFamily {
                        family: style.font.clone(),
                    },
                );
            }
        }

        report.finish()
    }
}

/// Acumula problemas mientras se recorre el documento.
#[derive(Default)]
struct Report(Vec<ValidationError>);

impl Report {
    fn push(&mut self, location: Location, problem: Problem) {
        self.0.push(ValidationError { location, problem });
    }

    fn finish(self) -> Result<(), ValidationErrors> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(ValidationErrors(self.0))
        }
    }

    fn check_id(&mut self, id: &str, seen: &mut HashSet<String>, at: impl Fn() -> Location) {
        if !is_valid_id(id) {
            self.push(at(), Problem::InvalidId);
        }
        // Páginas y elementos comparten espacio de nombres: un id identifica
        // una sola cosa en todo el documento.
        if !seen.insert(id.to_owned()) {
            self.push(at(), Problem::DuplicateId);
        }
    }

    fn check_box(&mut self, base: &ElementBox, at: impl Fn() -> Location) {
        self.positive("w", base.w, &at);
        if let Some(height) = base.h {
            self.positive("h", height, &at);
        }
    }

    fn positive(&mut self, field: &'static str, value: f64, at: impl Fn() -> Location) {
        if value <= 0.0 {
            self.push(at(), Problem::NotPositive { field, value });
        }
    }

    fn not_negative(&mut self, field: &'static str, value: f64, at: impl Fn() -> Location) {
        if value < 0.0 {
            self.push(at(), Problem::Negative { field, value });
        }
    }

    fn color(&mut self, field: &'static str, value: &str, at: impl Fn() -> Location) {
        if !is_valid_color(value) {
            self.push(
                at(),
                Problem::InvalidColor {
                    field,
                    value: value.to_owned(),
                },
            );
        }
    }

    fn optional_color(
        &mut self,
        field: &'static str,
        value: Option<&str>,
        at: impl Fn() -> Location,
    ) {
        if let Some(value) = value {
            self.color(field, value, at);
        }
    }

    fn optional_stroke(&mut self, stroke: Option<&Stroke>, at: impl Fn() -> Location) {
        if let Some(stroke) = stroke {
            self.color("stroke.color", &stroke.color, &at);
            self.positive("stroke.width", stroke.width, &at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un documento válido de una página con los elementos que se pasen.
    fn with_elements(elements: &str) -> Document {
        Document::from_json_str(&format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Validación" }},
              "assets": {{ "logo": "assets/logo.png" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{elements}]
              }}]
            }}"##
        ))
        .expect("el documento de prueba debe deserializar")
    }

    fn problems(document: &Document) -> Vec<ValidationError> {
        document
            .validate()
            .err()
            .map(|errors| errors.0)
            .unwrap_or_default()
    }

    fn element(id: &str, problem: Problem) -> ValidationError {
        ValidationError {
            location: Location::Element { id: id.to_owned() },
            problem,
        }
    }

    const RECT: &str = r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                              "fill": "#000000", "stroke": null }"##;

    const TEXT: &str = r##"{ "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                              "content": [{ "text": "x" }],
                              "style": { "font": "Inter", "size": 12, "color": "#000000" } }"##;

    #[test]
    fn a_valid_document_has_no_problems() {
        let document = with_elements(&format!(
            r##"{RECT}, {TEXT},
            {{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null, "asset": "logo" }},
            {{ "id": "l1", "type": "line", "x": 0, "y": 0, "x2": 10, "y2": 0,
               "stroke": {{ "color": "#000", "width": 0.5 }} }},
            {{ "id": "c1", "type": "code", "x": 0, "y": 0, "w": 10, "h": null, "source": "" }}"##
        ));
        assert_eq!(document.validate(), Ok(()));
    }

    // ── Regla 1: ids únicos en todo el documento ────────────────────────

    #[test]
    fn a_duplicate_element_id_is_reported_on_the_second_one() {
        let document = with_elements(&format!("{RECT}, {RECT}"));
        assert_eq!(problems(&document), [element("r1", Problem::DuplicateId)]);
    }

    #[test]
    fn element_ids_must_be_unique_across_pages() {
        let document = Document::from_json_str(&format!(
            r#"{{
              "version": 1,
              "meta": {{ "title": "x" }},
              "pages": [
                {{ "id": "p1", "size": {{ "width": 210, "height": 297, "unit": "mm" }}, "elements": [{RECT}] }},
                {{ "id": "p2", "size": {{ "width": 210, "height": 297, "unit": "mm" }}, "elements": [{RECT}] }}
              ]
            }}"#
        ))
        .expect("debe deserializar");
        assert_eq!(problems(&document), [element("r1", Problem::DuplicateId)]);
    }

    #[test]
    fn page_ids_must_be_unique() {
        let document = Document::from_json_str(
            r#"{
              "version": 1,
              "meta": { "title": "x" },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" } },
                { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" } }
              ]
            }"#,
        )
        .expect("debe deserializar");
        assert_eq!(
            problems(&document),
            [ValidationError {
                location: Location::Page {
                    id: "p1".to_owned()
                },
                problem: Problem::DuplicateId,
            }]
        );
    }

    /// Páginas y elementos comparten espacio de nombres.
    #[test]
    fn a_page_and_an_element_cannot_share_an_id() {
        let document = with_elements(&RECT.replace("\"r1\"", "\"p1\""));
        assert_eq!(problems(&document), [element("p1", Problem::DuplicateId)]);
    }

    #[test]
    fn an_id_with_forbidden_characters_is_reported() {
        for id in ["con espacio", "p1\\n#import \\\"x\\\"", "", "ñ"] {
            let document = with_elements(&RECT.replace("\"r1\"", &format!("\"{id}\"")));
            let found = problems(&document);
            assert!(
                found
                    .iter()
                    .any(|error| error.problem == Problem::InvalidId),
                "{id:?} debería rechazarse: {found:?}"
            );
        }
    }

    // ── Regla 2: toda imagen apunta a un recurso declarado ──────────────

    #[test]
    fn an_image_with_an_unknown_asset_is_reported() {
        let document = with_elements(
            r#"{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null, "asset": "portada" }"#,
        );
        assert_eq!(
            problems(&document),
            [element(
                "i1",
                Problem::UnknownAsset {
                    key: "portada".to_owned()
                }
            )]
        );
    }

    // ── Regla 3: toda familia usada la proporciona una fuente cargada ───

    #[test]
    fn a_font_family_that_no_loaded_font_provides_is_reported() {
        let document = with_elements(TEXT);
        let result = document.validate_font_families(&["Libertinus Serif".to_owned()]);
        assert_eq!(
            result.err().map(|errors| errors.0),
            Some(vec![element(
                "t1",
                Problem::UnknownFontFamily {
                    family: "Inter".to_owned()
                }
            )])
        );
    }

    #[test]
    fn font_families_are_compared_without_case() {
        let document = with_elements(TEXT);
        assert_eq!(
            document.validate_font_families(&["inter".to_owned()]),
            Ok(())
        );
        assert_eq!(
            document.validate_font_families(&["INTER".to_owned()]),
            Ok(())
        );
    }

    #[test]
    fn a_document_without_text_needs_no_fonts() {
        let document = with_elements(RECT);
        assert_eq!(document.validate_font_families(&[]), Ok(()));
    }

    // ── Regla 4: medidas positivas ──────────────────────────────────────

    #[test]
    fn a_zero_or_negative_width_is_reported() {
        for value in ["0", "-5"] {
            let document = with_elements(&RECT.replace("\"w\": 10", &format!("\"w\": {value}")));
            assert_eq!(
                problems(&document),
                [element(
                    "r1",
                    Problem::NotPositive {
                        field: "w",
                        value: value.parse().expect("número")
                    }
                )]
            );
        }
    }

    #[test]
    fn a_zero_or_negative_height_is_reported() {
        let document = with_elements(&RECT.replace("\"h\": 10", "\"h\": 0"));
        assert_eq!(
            problems(&document),
            [element(
                "r1",
                Problem::NotPositive {
                    field: "h",
                    value: 0.0
                }
            )]
        );
    }

    /// `h: null` es altura automática, no altura cero.
    #[test]
    fn a_null_height_is_fine() {
        let document = with_elements(&RECT.replace("\"h\": 10", "\"h\": null"));
        assert_eq!(document.validate(), Ok(()));
    }

    #[test]
    fn a_zero_or_negative_font_size_is_reported() {
        let document = with_elements(&TEXT.replace("\"size\": 12", "\"size\": -1"));
        assert_eq!(
            problems(&document),
            [element(
                "t1",
                Problem::NotPositive {
                    field: "style.size",
                    value: -1.0
                }
            )]
        );
    }

    #[test]
    fn a_zero_page_size_is_reported() {
        let document = Document::from_json_str(
            r#"{ "version": 1, "meta": { "title": "x" },
                 "pages": [{ "id": "p1", "size": { "width": 0, "height": 297, "unit": "mm" } }] }"#,
        )
        .expect("debe deserializar");
        assert_eq!(
            problems(&document),
            [ValidationError {
                location: Location::Page {
                    id: "p1".to_owned()
                },
                problem: Problem::NotPositive {
                    field: "size.width",
                    value: 0.0
                },
            }]
        );
    }

    #[test]
    fn a_zero_stroke_width_and_a_negative_radius_are_reported() {
        let document = with_elements(
            r##"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                 "fill": null, "stroke": { "color": "#000", "width": 0 }, "radius": -2 }"##,
        );
        assert_eq!(
            problems(&document),
            [
                element(
                    "r1",
                    Problem::NotPositive {
                        field: "stroke.width",
                        value: 0.0
                    }
                ),
                element(
                    "r1",
                    Problem::Negative {
                        field: "radius",
                        value: -2.0
                    }
                ),
            ]
        );
    }

    // ── Colores ─────────────────────────────────────────────────────────

    #[test]
    fn an_invalid_colour_is_reported_with_its_field() {
        let document = with_elements(&TEXT.replace("\"#000000\"", "\"negro\""));
        assert_eq!(
            problems(&document),
            [element(
                "t1",
                Problem::InvalidColor {
                    field: "style.color",
                    value: "negro".to_owned()
                }
            )]
        );
    }

    #[test]
    fn colour_and_id_rules_match_what_codegen_accepts() {
        for valid in ["#abc", "#abcd", "#1e40af", "#1e40afcc"] {
            assert!(is_valid_color(valid), "{valid}");
        }
        for invalid in ["", "#", "#12345", "rojo", "#zzzzzz", "1e40af"] {
            assert!(!is_valid_color(invalid), "{invalid}");
        }
        for valid in ["r1", "el_2", "bloque-principal", "0"] {
            assert!(is_valid_id(valid), "{valid}");
        }
    }

    // ── Todos los problemas, con su elemento ────────────────────────────

    #[test]
    fn every_problem_is_reported_not_just_the_first() {
        let document = with_elements(
            r#"{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": -1, "h": 0,
                 "fill": "azul", "stroke": null },
               { "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null, "asset": "nada" }"#,
        );
        assert_eq!(problems(&document).len(), 4);
    }

    /// El criterio de la tarea: cada error dice qué elemento lo provoca.
    #[test]
    fn the_message_names_the_element() {
        let document = with_elements(&RECT.replace("\"w\": 10", "\"w\": -3"));
        let message = document.validate().expect_err("debe fallar").to_string();
        assert_eq!(
            message,
            "el documento tiene 1 problema\n  - elemento \"r1\": w tiene que ser mayor que cero, y es -3"
        );
    }
}
