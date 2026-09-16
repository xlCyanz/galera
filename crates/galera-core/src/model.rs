//! Modelo del documento.
//!
//! Estos tipos son la fuente de verdad de Galera (principio 1 del README).
//! Todo lo demás —el código Typst, el PDF, el SVG, lo que se ve en el
//! lienzo— se deriva de aquí. Typst nunca se lee de vuelta.
//!
//! # Forma canónica
//!
//! Al serializar se emiten **todos** los campos, incluidos los que tienen
//! valor por defecto y los que valen `null`. Así, dos documentos iguales
//! producen exactamente los mismos bytes, que es lo que necesita el formato
//! de archivo de la tarea F0-11 para llevarse bien con git.
//!
//! Al deserializar sí se aceptan campos ausentes: un elemento sin
//! `rotation` se lee como `0.0`, y un documento sin `variables` como un
//! mapa vacío.
//!
//! # Sistema de coordenadas
//!
//! El origen está en la esquina superior izquierda de la página y las
//! unidades son milímetros. El margen de página es cero, así que las
//! coordenadas del documento son coordenadas absolutas sobre el papel.

use std::collections::BTreeMap;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};

use crate::DOCUMENT_VERSION;

/// Un documento completo de Galera.
///
/// Es lo que se guarda como `document.json` dentro de un proyecto `.galera`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    /// Versión del formato. Solo se acepta [`DOCUMENT_VERSION`].
    ///
    /// Se valida al deserializar en vez de dejarlo para más tarde: un
    /// documento de una versión futura se rechaza entero antes de que nadie
    /// lo interprete a medias.
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,

    /// Metadatos del documento.
    pub meta: Meta,

    /// Archivos de fuente que el proyecto empaqueta, relativos a su raíz.
    ///
    /// Las fuentes viajan con el documento (principio 4): nunca se usan las
    /// que haya instaladas en la máquina.
    #[serde(default)]
    pub fonts: Vec<String>,

    /// Imágenes del proyecto, de clave a ruta relativa a la raíz.
    ///
    /// Los elementos [`Element::Image`] se refieren a la clave, no a la
    /// ruta, para poder mover un archivo sin tocar cada elemento.
    #[serde(default)]
    pub assets: BTreeMap<String, String>,

    /// Variables del documento, para plantillas y generación en lote.
    #[serde(default)]
    pub variables: BTreeMap<String, String>,

    /// Páginas, en el orden en que se imprimen.
    #[serde(default)]
    pub pages: Vec<Page>,
}

impl Document {
    /// Lee un documento desde una cadena JSON.
    ///
    /// Falla si el JSON está mal formado, si falta un campo obligatorio o si
    /// la versión del formato no es la que entiende este núcleo.
    pub fn from_json_str(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Escribe el documento como JSON compacto.
    pub fn to_json_string(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Escribe el documento como JSON indentado, que es como se guarda en
    /// disco para que los cambios se lean bien en un diff.
    pub fn to_json_string_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Busca un elemento por su id, en cualquier página.
    pub fn element(&self, id: &str) -> Option<&Element> {
        self.pages
            .iter()
            .flat_map(|page| &page.elements)
            .find(|element| element.id() == id)
    }
}

/// Metadatos del documento.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    /// Título, que también da el nombre por defecto al exportar.
    pub title: String,
}

/// Una página del documento.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    /// Identificador único dentro del documento.
    pub id: String,

    /// Tamaño del papel.
    pub size: PageSize,

    /// Elementos de la página, **en orden de capas**: el último del arreglo
    /// es el que queda encima de todos.
    #[serde(default)]
    pub elements: Vec<Element>,
}

/// Tamaño de una página.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageSize {
    /// Ancho, en [`PageSize::unit`].
    pub width: f64,
    /// Alto, en [`PageSize::unit`].
    pub height: f64,
    /// Unidad de las dos medidas.
    #[serde(default)]
    pub unit: Unit,
}

/// Unidad de medida.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    /// Milímetros. Es la unidad de trabajo de Galera.
    #[default]
    Mm,
    /// Centímetros.
    Cm,
    /// Pulgadas.
    In,
    /// Puntos tipográficos (1/72 de pulgada).
    Pt,
}

impl Unit {
    /// Convierte una medida de esta unidad a milímetros.
    ///
    /// El núcleo trabaja siempre en milímetros: la unidad del documento es
    /// cosa de cómo se le enseña a la persona, no de la geometría.
    pub fn to_millimeters(self, value: f64) -> f64 {
        match self {
            Unit::Mm => value,
            Unit::Cm => value * 10.0,
            Unit::In => value * 25.4,
            Unit::Pt => value * 25.4 / 72.0,
        }
    }
}

/// Datos comunes a casi todos los elementos: identidad, posición y tamaño.
///
/// Se aplana dentro de cada variante de [`Element`], así que en el JSON
/// estos campos aparecen al mismo nivel que los propios del tipo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElementBox {
    /// Identificador único dentro del documento.
    ///
    /// Es también la etiqueta `<el-ID>` que el codegen deja en el código
    /// Typst para poder encontrar el elemento en el layout compilado.
    pub id: String,

    /// Distancia desde el borde izquierdo de la página, en milímetros.
    pub x: f64,

    /// Distancia desde el borde superior de la página, en milímetros.
    pub y: f64,

    /// Ancho, en milímetros.
    pub w: f64,

    /// Alto en milímetros, o `None` para que lo mida Typst.
    ///
    /// La altura automática es lo normal en textos e imágenes: lo que ocupan
    /// depende de la composición, y solo Typst la conoce (principio 3).
    pub h: Option<f64>,

    /// Rotación en grados, en sentido horario, alrededor del centro.
    #[serde(default)]
    pub rotation: f64,
}

/// Un elemento colocado sobre una página.
///
/// En el JSON, el campo `type` elige la variante y el resto de campos
/// aparecen todos al mismo nivel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Element {
    /// Un bloque de texto con formato.
    Text {
        /// Identidad, posición y tamaño.
        #[serde(flatten)]
        base: ElementBox,
        /// Contenido, partido en tramos con el mismo formato.
        content: Vec<Run>,
        /// Estilo que se aplica a todo el bloque.
        style: TextStyle,
    },

    /// Un rectángulo, opcionalmente con esquinas redondeadas.
    Rect {
        /// Identidad, posición y tamaño.
        #[serde(flatten)]
        base: ElementBox,
        /// Color de relleno `#RRGGBB` o `#RRGGBBAA`, o `None` para no rellenar.
        fill: Option<String>,
        /// Borde, o `None` para no dibujarlo.
        stroke: Option<Stroke>,
        /// Radio de las esquinas, en milímetros.
        #[serde(default)]
        radius: f64,
    },

    /// Una elipse inscrita en la caja del elemento.
    Ellipse {
        /// Identidad, posición y tamaño.
        #[serde(flatten)]
        base: ElementBox,
        /// Color de relleno, o `None` para no rellenar.
        fill: Option<String>,
        /// Borde, o `None` para no dibujarlo.
        stroke: Option<Stroke>,
    },

    /// Un segmento recto entre dos puntos.
    ///
    /// Es el único elemento que no usa [`ElementBox`]: una línea se define
    /// por sus dos extremos, y un ancho y un alto no dirían en qué diagonal
    /// de la caja está dibujada.
    Line {
        /// Identificador único dentro del documento.
        id: String,
        /// Coordenada X del primer extremo, en milímetros.
        x: f64,
        /// Coordenada Y del primer extremo, en milímetros.
        y: f64,
        /// Coordenada X del segundo extremo, en milímetros.
        x2: f64,
        /// Coordenada Y del segundo extremo, en milímetros.
        y2: f64,
        /// Rotación en grados alrededor del punto medio.
        #[serde(default)]
        rotation: f64,
        /// Trazo con el que se dibuja.
        stroke: Stroke,
    },

    /// Una imagen del proyecto.
    Image {
        /// Identidad, posición y tamaño.
        #[serde(flatten)]
        base: ElementBox,
        /// Clave dentro de [`Document::assets`].
        asset: String,
    },

    /// Código Typst escrito a mano.
    ///
    /// Es una **caja opaca**: el editor no lo lee ni lo modifica, y se evalúa
    /// tal cual, aislado del resto del documento y sin acceso a disco. Es la
    /// única excepción al principio 1, y por eso un documento de origen
    /// desconocido no es contenido de confianza; ver `SECURITY.md`.
    Code {
        /// Identidad, posición y tamaño.
        #[serde(flatten)]
        base: ElementBox,
        /// Código Typst, literal.
        source: String,
    },
}

impl Element {
    /// Identificador del elemento, sea cual sea su tipo.
    pub fn id(&self) -> &str {
        match self {
            Element::Text { base, .. }
            | Element::Rect { base, .. }
            | Element::Ellipse { base, .. }
            | Element::Image { base, .. }
            | Element::Code { base, .. } => &base.id,
            Element::Line { id, .. } => id,
        }
    }

    /// Nombre del tipo, tal como aparece en el campo `type` del JSON.
    pub fn type_name(&self) -> &'static str {
        match self {
            Element::Text { .. } => "text",
            Element::Rect { .. } => "rect",
            Element::Ellipse { .. } => "ellipse",
            Element::Line { .. } => "line",
            Element::Image { .. } => "image",
            Element::Code { .. } => "code",
        }
    }

    /// Esquina superior izquierda del elemento, en milímetros.
    ///
    /// En una línea es su primer extremo.
    pub fn position(&self) -> (f64, f64) {
        match self {
            Element::Text { base, .. }
            | Element::Rect { base, .. }
            | Element::Ellipse { base, .. }
            | Element::Image { base, .. }
            | Element::Code { base, .. } => (base.x, base.y),
            Element::Line { x, y, .. } => (*x, *y),
        }
    }

    /// Rotación del elemento en grados, sea cual sea su tipo.
    pub fn rotation(&self) -> f64 {
        match self {
            Element::Text { base, .. }
            | Element::Rect { base, .. }
            | Element::Ellipse { base, .. }
            | Element::Image { base, .. }
            | Element::Code { base, .. } => base.rotation,
            Element::Line { rotation, .. } => *rotation,
        }
    }

    /// Caja del elemento, o `None` si es una línea.
    pub fn base(&self) -> Option<&ElementBox> {
        match self {
            Element::Text { base, .. }
            | Element::Rect { base, .. }
            | Element::Ellipse { base, .. }
            | Element::Image { base, .. }
            | Element::Code { base, .. } => Some(base),
            Element::Line { .. } => None,
        }
    }
}

/// Un tramo de texto con el mismo formato.
///
/// El contenido de un bloque de texto es una lista de tramos: "Informe" en
/// negrita seguido de " anual" en redonda son dos tramos.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    /// El texto, en claro.
    ///
    /// Se guarda sin escapar. El escape hacia Typst ocurre al generar el
    /// código, no al guardarlo (principio 6).
    pub text: String,

    /// Negrita.
    #[serde(default)]
    pub bold: bool,

    /// Cursiva.
    #[serde(default)]
    pub italic: bool,

    /// Subrayado.
    #[serde(default)]
    pub underline: bool,
}

impl Run {
    /// Crea un tramo sin formato.
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: false,
            italic: false,
            underline: false,
        }
    }
}

/// Estilo de un bloque de texto completo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextStyle {
    /// Familia tipográfica, entre las que el proyecto empaqueta.
    pub font: String,

    /// Tamaño en puntos.
    pub size: f64,

    /// Color del texto, `#RRGGBB` o `#RRGGBBAA`.
    pub color: String,

    /// Alineación horizontal.
    #[serde(default)]
    pub align: Align,

    /// Interlineado, como múltiplo del tamaño de fuente.
    #[serde(default = "default_leading")]
    pub leading: f64,
}

/// Alineación horizontal del texto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    /// Alineado a la izquierda.
    #[default]
    Left,
    /// Centrado.
    Center,
    /// Alineado a la derecha.
    Right,
    /// Justificado a ambos lados.
    Justify,
}

/// Trazo de un borde o de una línea.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    /// Color, `#RRGGBB` o `#RRGGBBAA`.
    pub color: String,
    /// Grosor en milímetros.
    pub width: f64,
}

/// Interlineado por defecto de Typst, como múltiplo del tamaño de fuente.
fn default_leading() -> f64 {
    0.65
}

/// Acepta la versión del formato solo si es la que este núcleo entiende.
fn deserialize_version<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: Deserializer<'de>,
{
    let version = u32::deserialize(deserializer)?;
    if version != DOCUMENT_VERSION {
        return Err(D::Error::custom(format!(
            "versión de documento no soportada: {version}; este núcleo entiende la {DOCUMENT_VERSION}"
        )));
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El documento de ejemplo de la sección 4 de `guide.md`, literal.
    const EXAMPLE: &str = r##"{
      "version": 1,
      "meta": { "title": "Informe anual 2026" },
      "fonts": ["fonts/Inter-Regular.ttf", "fonts/Inter-Bold.ttf"],
      "assets": { "logo": "assets/logo.png" },
      "variables": { "nombre": "Cooperativa Agrícola del Este" },
      "pages": [
        {
          "id": "p1",
          "size": { "width": 210, "height": 297, "unit": "mm" },
          "elements": [
            { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 210, "h": 15,
              "rotation": 0, "fill": "#1e40af", "stroke": null, "radius": 0 },
            { "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": null,
              "rotation": 0,
              "content": [ { "text": "Informe anual", "bold": true } ],
              "style": { "font": "Inter", "size": 28, "color": "#1F2733",
                         "align": "left", "leading": 0.65 } },
            { "id": "i1", "type": "image", "x": 20, "y": 60, "w": 80, "h": null,
              "rotation": 0, "asset": "logo" },
            { "id": "c1", "type": "code", "x": 20, "y": 200, "w": 170, "h": 40,
              "source": "#table(columns: 2)[A][B]" }
          ]
        }
      ]
    }"##;

    fn example() -> Document {
        Document::from_json_str(EXAMPLE).expect("el ejemplo de guide.md debe deserializar")
    }

    #[test]
    fn reads_the_guide_example_without_losing_anything() {
        let doc = example();

        assert_eq!(doc.version, 1);
        assert_eq!(doc.meta.title, "Informe anual 2026");
        assert_eq!(
            doc.fonts,
            ["fonts/Inter-Regular.ttf", "fonts/Inter-Bold.ttf"]
        );
        assert_eq!(doc.assets["logo"], "assets/logo.png");
        assert_eq!(doc.variables["nombre"], "Cooperativa Agrícola del Este");

        let page = &doc.pages[0];
        assert_eq!(page.id, "p1");
        assert_eq!(page.size.width, 210.0);
        assert_eq!(page.size.height, 297.0);
        assert_eq!(page.size.unit, Unit::Mm);
        assert_eq!(page.elements.len(), 4);
    }

    #[test]
    fn element_type_selects_the_variant() {
        let doc = example();
        let types: Vec<_> = doc.pages[0]
            .elements
            .iter()
            .map(Element::type_name)
            .collect();
        assert_eq!(types, ["rect", "text", "image", "code"]);
    }

    #[test]
    fn rect_keeps_fill_stroke_and_radius() {
        let doc = example();
        let Element::Rect {
            base,
            fill,
            stroke,
            radius,
        } = &doc.pages[0].elements[0]
        else {
            panic!("el primer elemento del ejemplo es un rect");
        };

        assert_eq!(base.id, "r1");
        assert_eq!((base.x, base.y, base.w), (0.0, 0.0, 210.0));
        assert_eq!(base.h, Some(15.0));
        assert_eq!(base.rotation, 0.0);
        assert_eq!(fill.as_deref(), Some("#1e40af"));
        assert_eq!(*stroke, None);
        assert_eq!(*radius, 0.0);
    }

    #[test]
    fn null_height_means_measured_by_typst() {
        let doc = example();

        let text = doc.element("t1").expect("t1 está en el ejemplo");
        assert_eq!(text.base().expect("un texto tiene caja").h, None);

        let image = doc.element("i1").expect("i1 está en el ejemplo");
        assert_eq!(image.base().expect("una imagen tiene caja").h, None);

        let code = doc.element("c1").expect("c1 está en el ejemplo");
        assert_eq!(
            code.base().expect("un bloque de código tiene caja").h,
            Some(40.0)
        );
    }

    #[test]
    fn text_keeps_its_runs_and_style() {
        let doc = example();
        let Element::Text { content, style, .. } =
            doc.element("t1").expect("t1 está en el ejemplo")
        else {
            panic!("t1 es un texto");
        };

        assert_eq!(content.len(), 1);
        assert_eq!(content[0].text, "Informe anual");
        assert!(content[0].bold);
        // Ausentes en el JSON: se leen como `false`, no como error.
        assert!(!content[0].italic);
        assert!(!content[0].underline);

        assert_eq!(style.font, "Inter");
        assert_eq!(style.size, 28.0);
        assert_eq!(style.color, "#1F2733");
        assert_eq!(style.align, Align::Left);
        assert_eq!(style.leading, 0.65);
    }

    #[test]
    fn code_source_is_kept_verbatim() {
        let doc = example();
        let Element::Code { source, .. } = doc.element("c1").expect("c1 está en el ejemplo")
        else {
            panic!("c1 es un bloque de código");
        };
        assert_eq!(source, "#table(columns: 2)[A][B]");
    }

    #[test]
    fn round_trip_preserves_the_document() {
        let original = example();

        let json = original.to_json_string().expect("debe serializar");
        let again = Document::from_json_str(&json).expect("lo que serializa debe deserializar");

        assert_eq!(original, again);

        // Y la forma canónica es estable: serializar dos veces da los mismos
        // bytes, que es lo que el formato de archivo necesita para que los
        // diffs de git sean legibles.
        assert_eq!(json, again.to_json_string().expect("debe serializar"));
    }

    #[test]
    fn line_round_trips_through_its_two_endpoints() {
        let json = r##"{
          "version": 1,
          "meta": { "title": "Línea" },
          "pages": [{
            "id": "p1",
            "size": { "width": 210, "height": 297, "unit": "mm" },
            "elements": [{
              "id": "l1", "type": "line",
              "x": 10, "y": 20, "x2": 100, "y2": 20,
              "stroke": { "color": "#000000", "width": 0.5 }
            }]
          }]
        }"##;

        let doc = Document::from_json_str(json).expect("debe deserializar");
        let Element::Line { x2, y2, stroke, .. } = &doc.pages[0].elements[0] else {
            panic!("l1 es una línea");
        };
        assert_eq!((*x2, *y2), (100.0, 20.0));
        assert_eq!(stroke.width, 0.5);

        let again = Document::from_json_str(&doc.to_json_string().expect("debe serializar"))
            .expect("debe deserializar");
        assert_eq!(doc, again);
    }

    #[test]
    fn absent_optional_fields_take_their_default() {
        let json = r##"{
          "version": 1,
          "meta": { "title": "Mínimo" },
          "pages": []
        }"##;

        let doc = Document::from_json_str(json).expect("debe deserializar");
        assert!(doc.fonts.is_empty());
        assert!(doc.assets.is_empty());
        assert!(doc.variables.is_empty());
        assert!(doc.pages.is_empty());
    }

    #[test]
    fn rejects_any_version_other_than_one() {
        for version in ["0", "2", "99"] {
            let json =
                format!(r#"{{ "version": {version}, "meta": {{ "title": "x" }}, "pages": [] }}"#);
            let error = Document::from_json_str(&json)
                .expect_err("una versión distinta de la 1 debe rechazarse");
            assert!(
                error
                    .to_string()
                    .contains("versión de documento no soportada"),
                "el mensaje debe explicar el problema, y era: {error}"
            );
        }
    }

    #[test]
    fn rejects_an_unknown_element_type() {
        let json = r##"{
          "version": 1,
          "meta": { "title": "x" },
          "pages": [{
            "id": "p1",
            "size": { "width": 210, "height": 297, "unit": "mm" },
            "elements": [{ "id": "q1", "type": "quasar", "x": 0, "y": 0, "w": 10, "h": 10 }]
          }]
        }"##;

        assert!(
            Document::from_json_str(json).is_err(),
            "un tipo de elemento desconocido no puede leerse en silencio"
        );
    }

    #[test]
    fn units_convert_to_millimeters() {
        assert_eq!(Unit::Mm.to_millimeters(10.0), 10.0);
        assert_eq!(Unit::Cm.to_millimeters(10.0), 100.0);
        assert_eq!(Unit::In.to_millimeters(1.0), 25.4);
        assert_eq!(Unit::Pt.to_millimeters(72.0), 25.4);
    }

    #[test]
    fn element_lookup_finds_by_id_across_pages() {
        let doc = example();
        assert_eq!(doc.element("i1").map(Element::type_name), Some("image"));
        assert_eq!(doc.element("no-existe"), None);
    }
}
