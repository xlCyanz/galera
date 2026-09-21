//! Generación de código Typst a partir del documento.
//!
//! El sentido de este módulo es de ida y solo de ida: el documento entra,
//! el código `.typ` sale. Galera no lee Typst ni lo interpreta, con la única
//! excepción del elemento [`Element::Code`], cuyo código se evalúa tal cual
//! sin mirarlo (principio 1 del README).
//!
//! # Forma del archivo generado
//!
//! ```typst
//! #set page(width: 210mm, height: 297mm, margin: 0pt)
//!
//! // p1
//! #place(top + left, dx: 0mm, dy: 0mm)[…] <el-r1>
//! #place(top + left, dx: 20mm, dy: 30mm)[…] <el-t1>
//! ```
//!
//! Tres decisiones sostienen todo lo demás:
//!
//! 1. **Margen cero.** Las coordenadas del JSON son coordenadas absolutas
//!    sobre el papel, así que la página no puede tener margen propio: lo que
//!    dice el modelo es lo que se dibuja.
//! 2. **Todo va en `place`.** Cada elemento se coloca por desplazamiento
//!    desde la esquina superior izquierda, fuera del flujo. Un documento de
//!    Galera no fluye: es un lienzo.
//! 3. **Cada elemento lleva su etiqueta `<el-ID>`.** Es el único hilo que
//!    une el JSON con lo que Typst dibujó. De ahí saldrán las cajas reales
//!    de la tarea F2-01, y sin él no hay selección fiel.
//!
//! # Piezas
//!
//! - [`escape`](mod@escape): convierte texto del usuario en texto literal para Typst.
//!   Es la pieza de la que depende la seguridad de todo lo demás.
//! - [`generate`]: la cabecera, las páginas y la envoltura de cada elemento.
//! - `shapes`: el cuerpo de los rectángulos, las elipses y las líneas.
//! - `text`: el cuerpo de los bloques de texto.
//! - `image`: el cuerpo de las imágenes, resolviendo la clave del recurso.
//! - `code`: el cuerpo de los bloques de código personalizado, evaluados con
//!   `eval` para que un error en ellos no rompa el resto del documento.
//!
//! # Comprobado contra el compilador
//!
//! La prueba `typst_compiles_a_generated_document_with_this_world`, en
//! `world.rs`, compila con Typst 0.15.1 un documento de dos páginas de
//! tamaños distintos generado por este módulo. Confirma que:
//!
//! - el código generado compila sin errores ni avisos;
//! - `#pagebreak()` seguido de `#set page(...)` da exactamente una página
//!   por página del modelo, sin ninguna en blanco, cada una con su tamaño;
//! - el texto escapado, con `#linebreak();` delante de una línea que empieza
//!   por `(`, y el bloque de código evaluado con `eval`, compilan.
//!
//! # Pendiente de comprobar
//!
//! - Que una etiqueta puesta detrás de un `place` se pueda localizar después
//!   y devuelva la posición del contenido colocado. Es F2-01.

mod code;
pub mod escape;
mod flow;
pub use flow::length as flow_length;
pub(crate) use flow::{PieceSpan as FlowPieceSpan, piece_spans as flow_piece_spans};
mod group;
mod image;
mod shapes;
mod text;

pub use escape::{escape, escape_into};
pub(crate) use group::GROUP_PREFIX;

use serde::Serialize;

use crate::model::{Document, Element, Page, PageSize, is_valid_color, is_valid_id};

/// Algo del documento impide generar código Typst.
///
/// La validación ([`Document::validate`]) detecta antes todos estos casos;
/// aquí quedan como última línea de defensa, porque el codegen escribe los
/// valores en un sitio donde no hay forma de escaparlos.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CodegenError {
    /// El id de un elemento no puede escribirse como etiqueta de Typst.
    ///
    /// Los ids acaban dentro del código generado como `<el-ID>`. Si se
    /// aceptara cualquier cadena, un id venido de un archivo ajeno podría
    /// cerrar la etiqueta y escribir código detrás. Ver `SECURITY.md`.
    #[error(
        "el id de elemento {id:?} no es válido: solo se admiten letras y dígitos ASCII, guion y guion bajo"
    )]
    UnsafeElementId {
        /// El id tal como venía en el documento.
        id: String,
    },

    /// El id de una página no puede escribirse en el código generado.
    ///
    /// Va dentro de un comentario (`// p1`). Un id con un salto de línea
    /// cerraría el comentario y escribiría código detrás.
    #[error(
        "el id de página {id:?} no es válido: solo se admiten letras y dígitos ASCII, guion y guion bajo"
    )]
    UnsafePageId {
        /// El id tal como venía en el documento.
        id: String,
    },

    /// Un color no tiene forma de color hexadecimal.
    ///
    /// Los colores se escriben dentro de una cadena de Typst, como
    /// `rgb("#1e40af")`. Aceptar cualquier texto dejaría cerrar la cadena y
    /// escribir código detrás.
    #[error("el color {value:?} no es válido: se espera #RGB, #RGBA, #RRGGBB o #RRGGBBAA")]
    InvalidColor {
        /// El color tal como venía en el documento.
        value: String,
    },

    /// Un enlace no lleva a la web ni al correo.
    ///
    /// El destino acaba en el PDF como una acción del lector: aceptar
    /// cualquier esquema dejaría escribir `javascript:` ahí.
    #[error("el enlace {value:?} no vale: solo http://, https:// y mailto:")]
    InvalidLink {
        /// El destino tal como venía en el documento.
        value: String,
    },

    /// Una imagen se refiere a una clave que no está en `assets`.
    #[error("la imagen {element_id:?} usa el recurso {key:?}, que no está declarado en assets")]
    UnknownAsset {
        /// El id de la imagen que la usa.
        element_id: String,
        /// La clave que no se encontró.
        key: String,
    },
}

/// Traduce un documento entero a código Typst.
///
/// # Errores
///
/// Falla si algún elemento tiene un id que no puede escribirse como etiqueta.
///
/// # Ejemplos
///
/// ```
/// use galera_core::{codegen, Document};
///
/// let json = r#"{
///   "version": 1,
///   "meta": { "title": "Vacío" },
///   "pages": [{ "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" } }]
/// }"#;
///
/// let document = Document::from_json_str(json).unwrap();
/// let typst = codegen::generate(&document).unwrap();
///
/// assert!(typst.contains("#set page(width: 210mm, height: 297mm, margin: 0pt)"));
/// ```
pub fn generate(document: &Document) -> Result<String, CodegenError> {
    let mut out = String::with_capacity(512);

    out.push_str("// Generado por Galera a partir de document.json.\n");
    out.push_str("// No editar a mano: este archivo se reescribe entero en cada compilación.\n");

    // El título acaba en los metadatos del PDF, que es lo que enseñan los
    // lectores en la barra de la ventana y en las propiedades del archivo.
    if !document.meta.title.is_empty() {
        out.push_str(&format!(
            "#set document(title: {})\n",
            typst_string(&document.meta.title)
        ));
    }

    // Lo que necesitan los flujos va antes de las páginas: una zona de la
    // página 1 usa lo mismo que una de la 7.
    flow::emit_prelude(document, &mut out)?;

    let mut previous_size: Option<&PageSize> = None;
    for (index, page) in document.pages.iter().enumerate() {
        emit_page(page, index, previous_size, document, &mut out)?;
        previous_size = Some(&page.size);
    }

    Ok(out)
}

/// Emite una página: el salto, su tamaño si cambia, y sus elementos.
fn emit_page(
    page: &Page,
    index: usize,
    previous_size: Option<&PageSize>,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    let size_changed = previous_size != Some(&page.size);

    if index > 0 {
        // Salto explícito antes de tocar el tamaño. El número de páginas del
        // PDF tiene que ser exactamente el del modelo, y no depender de si un
        // `set page` a media altura rompe página por su cuenta. Comprobado
        // con Typst 0.15.1: no deja ninguna página en blanco.
        out.push_str("\n#pagebreak()\n");
    }

    if size_changed {
        out.push_str(&format!(
            "#set page(width: {}, height: {}, margin: 0pt)\n",
            millimeters(page.size.unit.to_millimeters(page.size.width)),
            millimeters(page.size.unit.to_millimeters(page.size.height)),
        ));
    }

    // El id acaba dentro de un comentario, y un salto de línea lo cerraría:
    // la misma regla que para los ids de elemento.
    if !is_valid_id(&page.id) {
        return Err(CodegenError::UnsafePageId {
            id: page.id.clone(),
        });
    }
    out.push_str(&format!("\n// {}\n", page.id));

    // Un elemento oculto no se emite: ni se dibuja, ni se exporta, ni
    // tiene caja en el layout.
    for element in page
        .elements
        .iter()
        .filter(|element| !element.layer().is_hidden())
    {
        emit_element(element, document, out)?;
    }

    Ok(())
}

/// Emite un elemento: su cuerpo, su rotación, su posición y su etiqueta.
///
/// Las coordenadas de un elemento se cuentan desde la esquina de lo que lo
/// contiene: la página, o el bloque de su grupo.
pub(super) fn emit_element(
    element: &Element,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    let id = element.id();
    if !is_valid_id(id) {
        return Err(CodegenError::UnsafeElementId { id: id.to_owned() });
    }

    let mut body = String::new();
    emit_body(element, document, &mut body)?;

    // La rotación envuelve al cuerpo, dentro del `place`: así el elemento
    // gira sobre su propio centro y su esquina sigue anclada donde dice el
    // modelo. Girar el `place` movería el elemento además de rotarlo.
    let rotation = element.rotation();
    if rotation != 0.0 {
        body = format!(
            "#rotate({}, origin: center + horizon)[{body}]",
            degrees(rotation)
        );
    }

    let (x, y) = element.position();

    // La etiqueta va detrás del `place`, que es como Typst asocia una
    // etiqueta con el elemento que la precede. Si al leer el layout en
    // F2-01 resulta que conviene que envuelva al cuerpo en vez de al
    // `place`, se cambia aquí y en las instantáneas.
    out.push_str(&format!(
        "#place(top + left, dx: {}, dy: {})[{body}] <el-{id}>",
        millimeters(x),
        millimeters(y),
    ));

    out.push('\n');
    Ok(())
}

/// Dónde está el código de un elemento dentro del código generado.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "codegen.ts"))]
pub struct CodeSpan {
    /// El elemento, por su id.
    pub id: String,
    /// Dónde empieza su código, en bytes desde el principio.
    pub start: usize,
    /// Dónde acaba, sin incluirlo.
    pub end: usize,
}

/// Dónde está el código de cada elemento dentro del código generado.
///
/// No es leer Typst, que el editor no hace nunca (principio 1): es volver a
/// leer **lo que acaba de escribir este módulo**, que emite cada elemento
/// como un `#place(…)` que empieza una línea y acaba con su etiqueta
/// `<el-ID>`. Los hijos de un grupo van en sus propias líneas dentro, y por
/// eso el recorrido lleva una pila.
///
/// Sirve para enseñar el código y señalar en él el elemento seleccionado.
pub fn spans(code: &str) -> Vec<CodeSpan> {
    let mut found = Vec::new();
    let mut open: Vec<usize> = Vec::new();
    let mut at = 0;

    for line in code.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed.trim_start().starts_with("#place(") {
            open.push(at);
        }
        if let Some(id) = label(trimmed)
            && let Some(start) = open.pop()
        {
            found.push(CodeSpan {
                id,
                start,
                end: at + trimmed.len(),
            });
        }
        at += line.len();
    }

    found
}

/// El id de la etiqueta `<el-ID>` con la que acaba la línea, si acaba así.
fn label(line: &str) -> Option<String> {
    let rest = line.trim_end().strip_suffix('>')?;
    let at = rest.rfind("<el-")?;
    let id = &rest[at + 4..];
    (!id.is_empty() && is_valid_id(id)).then(|| id.to_owned())
}

/// Escribe el cuerpo del elemento, según su tipo.
fn emit_body(element: &Element, document: &Document, out: &mut String) -> Result<(), CodegenError> {
    match element {
        Element::Rect {
            base,
            fill,
            stroke,
            radius,
        } => shapes::emit_rect(base, fill.as_deref(), stroke.as_ref(), *radius, out),
        Element::Ellipse { base, fill, stroke } => {
            shapes::emit_ellipse(base, fill.as_deref(), stroke.as_ref(), out)
        }
        Element::Line {
            x,
            y,
            x2,
            y2,
            stroke,
            ..
        } => shapes::emit_line(*x, *y, *x2, *y2, stroke, out),
        Element::Text {
            base,
            content,
            style,
            lines,
        } => text::emit_text(base, content, style, lines, &document.variables, out),
        Element::Image { base, asset } => image::emit_image(base, asset, document, out),
        Element::Code { base, source } => {
            code::emit_code(base, source, out);
            Ok(())
        }
        Element::Flow { base, flow: name } => {
            flow::emit_zone(base, name, document, out);
            Ok(())
        }
        Element::Group { base, children } => group::emit_group(base, children, document, out),
    }
}

/// Escribe un color del modelo como un color de Typst.
///
/// # Errores
///
/// Falla si el valor no tiene forma de color hexadecimal. Es deliberado: el
/// color acaba dentro de una cadena de Typst y aceptar cualquier texto
/// dejaría cerrarla y escribir código detrás.
pub(crate) fn color(value: &str) -> Result<String, CodegenError> {
    if !is_valid_color(value) {
        return Err(CodegenError::InvalidColor {
            value: value.to_owned(),
        });
    }

    Ok(format!("rgb(\"{value}\")"))
}

/// Escribe una cadena como literal de cadena de Typst, entre comillas.
///
/// Sirve para valores que van en posición de argumento, como el nombre de
/// una fuente o la ruta de una imagen. **No** sirve para contenido de marcado: para eso está
/// [`escape_into`]. Son dos sintaxis distintas con dos escapes distintos.
///
/// Dentro de una cadena de Typst solo son especiales la barra invertida y la
/// comilla doble, más los caracteres de control, que se escriben con su
/// secuencia para que el literal quepa siempre en una línea.
pub(crate) fn typst_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');

    for character in value.chars() {
        match character {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if control.is_control() => {
                out.push_str(&format!("\\u{{{:x}}}", control as u32));
            }
            other => out.push(other),
        }
    }

    out.push('"');
    out
}

/// Escribe un número en forma estable.
///
/// Las instantáneas comparan texto, así que `20.0` tiene que salir siempre
/// como `20` y nunca como `20.0000`. Cuatro decimales: más precisión que esa
/// no la imprime ninguna impresora.
fn number(value: f64) -> String {
    let mut text = format!("{value:.4}");

    if text.contains('.') {
        text = text.trim_end_matches('0').trim_end_matches('.').to_owned();
    }

    // `-0` es el mismo punto que `0`, y en el código generado sería ruido.
    if text == "-0" {
        text = "0".to_owned();
    }

    text
}

/// Una medida en milímetros, tal como la entiende Typst.
fn millimeters(value: f64) -> String {
    format!("{}mm", number(value))
}

/// Un ángulo en grados, tal como lo entiende Typst.
fn degrees(value: f64) -> String {
    format!("{}deg", number(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El documento de ejemplo de la sección 4 de `guide.md`.
    const EXAMPLE: &str = include_str!("../../../../fixtures/informe.json");

    fn example() -> Document {
        Document::from_json_str(EXAMPLE).expect("el ejemplo de guide.md debe deserializar")
    }

    fn generate_str(json: &str) -> String {
        let document = Document::from_json_str(json).expect("el documento debe deserializar");
        generate(&document).expect("el documento debe generar código")
    }

    #[test]
    fn the_title_goes_into_the_document_metadata() {
        let typst = generate(&example()).expect("debe generar");
        assert!(
            typst.contains(r#"#set document(title: "Informe anual 2026")"#),
            "{typst}"
        );
    }

    #[test]
    fn an_empty_title_is_not_written() {
        let typst = generate_str(r#"{ "version": 1, "meta": { "title": "" }, "pages": [] }"#);
        assert!(!typst.contains("#set document"), "{typst}");
    }

    #[test]
    fn a_title_cannot_break_out_of_its_string() {
        let typst = generate_str(
            r#"{ "version": 1, "meta": { "title": "x\") #import \"evil.typ\" #(\"" }, "pages": [] }"#,
        );
        assert!(
            typst.contains(r#"#set document(title: "x\") #import \"evil.typ\" #(\"")"#),
            "{typst}"
        );
    }

    #[test]
    fn the_page_has_no_margin_of_its_own() {
        let typst = generate(&example()).expect("debe generar");
        assert!(
            typst.contains("margin: 0pt"),
            "sin margen cero, las coordenadas del JSON dejan de ser absolutas: {typst}"
        );
    }

    #[test]
    fn a_page_keeps_its_exact_size() {
        let typst = generate(&example()).expect("debe generar");
        assert!(
            typst.contains("#set page(width: 210mm, height: 297mm, margin: 0pt)"),
            "{typst}"
        );
    }

    #[test]
    fn two_pages_produce_two_pages() {
        let typst = generate_str(
            r#"{
              "version": 1,
              "meta": { "title": "Dos" },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" } },
                { "id": "p2", "size": { "width": 148, "height": 210, "unit": "mm" } }
              ]
            }"#,
        );

        assert_eq!(typst.matches("#pagebreak()").count(), 1);
        assert!(typst.contains("#set page(width: 210mm, height: 297mm, margin: 0pt)"));
        assert!(typst.contains("#set page(width: 148mm, height: 210mm, margin: 0pt)"));
    }

    /// Repetir el mismo `set page` en cada página es ruido en el archivo
    /// generado y una instantánea más larga sin motivo.
    #[test]
    fn the_page_size_is_only_set_again_when_it_changes() {
        let typst = generate_str(
            r#"{
              "version": 1,
              "meta": { "title": "Tres iguales" },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" } },
                { "id": "p2", "size": { "width": 210, "height": 297, "unit": "mm" } },
                { "id": "p3", "size": { "width": 210, "height": 297, "unit": "mm" } }
              ]
            }"#,
        );

        assert_eq!(typst.matches("#set page(").count(), 1);
        assert_eq!(typst.matches("#pagebreak()").count(), 2);
    }

    #[test]
    fn page_sizes_in_other_units_become_millimeters() {
        let typst = generate_str(
            r#"{
              "version": 1,
              "meta": { "title": "Carta" },
              "pages": [{ "id": "p1", "size": { "width": 8.5, "height": 11, "unit": "in" } }]
            }"#,
        );

        assert!(
            typst.contains("#set page(width: 215.9mm, height: 279.4mm, margin: 0pt)"),
            "{typst}"
        );
    }

    #[test]
    fn every_element_is_placed_from_the_top_left_corner() {
        let typst = generate(&example()).expect("debe generar");

        assert!(
            typst.contains("#place(top + left, dx: 0mm, dy: 0mm)"),
            "{typst}"
        );
        assert!(
            typst.contains("#place(top + left, dx: 20mm, dy: 30mm)"),
            "{typst}"
        );
        assert!(
            typst.contains("#place(top + left, dx: 20mm, dy: 60mm)"),
            "{typst}"
        );
        assert!(
            typst.contains("#place(top + left, dx: 20mm, dy: 200mm)"),
            "{typst}"
        );
    }

    #[test]
    fn every_element_carries_its_label() {
        let typst = generate(&example()).expect("debe generar");

        for id in ["r1", "t1", "i1", "c1"] {
            assert!(
                typst.contains(&format!("<el-{id}>")),
                "falta la etiqueta de {id}, y sin ella F2-01 no puede encontrar su caja: {typst}"
            );
        }
    }

    #[test]
    fn a_line_is_placed_at_its_first_endpoint() {
        let typst = generate_str(
            r##"{
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
            }"##,
        );

        assert!(
            typst.contains("#place(top + left, dx: 10mm, dy: 20mm)[#line("),
            "{typst}"
        );
        assert!(typst.contains("<el-l1>"), "{typst}");
    }

    /// Un id acaba escrito dentro de `<el-ID>`, donde no hay escapes que
    /// valgan: o es seguro o no se genera nada.
    #[test]
    fn an_id_that_would_break_out_of_its_label_is_rejected() {
        for id in [
            "malo id",
            "id>",
            "id> #import \"evil.typ\"",
            "id\n",
            "",
            "acentuado-ñ",
            "id#",
        ] {
            let id_json = serde_json::to_string(id).expect("un str siempre serializa");
            let json = format!(
                r#"{{
                  "version": 1,
                  "meta": {{ "title": "x" }},
                  "pages": [{{
                    "id": "p1",
                    "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                    "elements": [{{ "id": {id_json}, "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                                    "fill": null, "stroke": null }}]
                  }}]
                }}"#
            );

            let document = Document::from_json_str(&json).expect("el JSON debe deserializar");
            assert_eq!(
                generate(&document),
                Err(CodegenError::UnsafeElementId { id: id.to_owned() }),
                "el id {id:?} debe rechazarse"
            );
        }
    }

    /// Encontrado revisando las instantáneas de F0-15: el id de página va en
    /// un comentario, y un salto de línea lo cerraba.
    #[test]
    fn a_page_id_that_would_break_out_of_its_comment_is_rejected() {
        for id in ["p1\n#import \"evil.typ\"", "p1\r#x", "página 1", ""] {
            let id_json = serde_json::to_string(id).expect("un str siempre serializa");
            let json = format!(
                r#"{{
                  "version": 1,
                  "meta": {{ "title": "x" }},
                  "pages": [{{ "id": {id_json}, "size": {{ "width": 210, "height": 297, "unit": "mm" }} }}]
                }}"#
            );
            let document = Document::from_json_str(&json).expect("el JSON debe deserializar");
            assert_eq!(
                generate(&document),
                Err(CodegenError::UnsafePageId { id: id.to_owned() }),
                "el id de página {id:?} debe rechazarse"
            );
        }
    }

    #[test]
    fn ordinary_ids_are_accepted() {
        for id in ["r1", "el_2", "bloque-principal", "A1", "0"] {
            assert!(is_valid_id(id), "{id:?} debería valer");
        }
    }

    /// Dentro de una cadena de Typst solo son especiales `\` y `"`, más los
    /// caracteres de control. Lo demás, incluido lo que no es ASCII, pasa.
    #[test]
    fn a_typst_string_cannot_be_broken_out_of() {
        assert_eq!(typst_string("Inter"), r#""Inter""#);
        assert_eq!(typst_string("Source Sans 3"), r#""Source Sans 3""#);
        assert_eq!(
            typst_string("Noto Sans CJK 日本語"),
            r#""Noto Sans CJK 日本語""#
        );
        assert_eq!(
            typst_string(r#"Inter") #import "evil.typ" #text(""#),
            r#""Inter\") #import \"evil.typ\" #text(\"""#
        );
        assert_eq!(typst_string(r"C:\fuentes"), r#""C:\\fuentes""#);
        assert_eq!(typst_string("dos\nlíneas"), r#""dos\nlíneas""#);
        assert_eq!(typst_string("\u{7}"), r#""\u{7}""#);
    }

    #[test]
    fn measurements_are_written_in_a_stable_form() {
        assert_eq!(millimeters(20.0), "20mm");
        assert_eq!(millimeters(0.0), "0mm");
        assert_eq!(millimeters(-0.0), "0mm");
        assert_eq!(millimeters(0.5), "0.5mm");
        assert_eq!(millimeters(210.0), "210mm");
        assert_eq!(millimeters(-12.25), "-12.25mm");
        // Se corta en cuatro decimales: más precisión que eso no la imprime
        // ninguna impresora y estropearía las instantáneas.
        assert_eq!(millimeters(1.0 / 3.0), "0.3333mm");
    }

    #[test]
    fn an_empty_document_generates_only_the_header() {
        let typst = generate_str(r#"{ "version": 1, "meta": { "title": "Vacío" }, "pages": [] }"#);
        assert!(!typst.contains("#set page("));
        assert!(!typst.contains("#place("));
    }

    /// El criterio de la tarea: cada elemento sabe dónde está su código.
    #[test]
    fn every_element_has_its_place_in_the_code() {
        let document = Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Spans" },
              "pages": [ { "id": "p1", "size": { "width": 210, "height": 297 }, "elements": [
                { "id": "r1", "type": "rect", "x": 10, "y": 10, "w": 20, "h": 10,
                  "fill": "#ff0000" },
                { "id": "g1", "type": "group", "x": 0, "y": 0, "w": 100, "h": 100,
                  "children": [
                    { "id": "r2", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                      "fill": "#00ff00" }
                  ] }
              ] } ]
            }"##,
        )
        .expect("es un documento");
        let code = generate(&document).expect("genera");
        let found = spans(&code);

        let ids: Vec<&str> = found.iter().map(|one| one.id.as_str()).collect();
        // El hijo se cierra antes que su grupo.
        assert_eq!(ids, vec!["r1", "r2", "g1"]);

        for span in &found {
            let fragment = &code[span.start..span.end];
            assert!(
                fragment.starts_with("#place(") || fragment.trim_start().starts_with("#place("),
                "{}: {fragment:?}",
                span.id
            );
            assert!(
                fragment.ends_with(&format!("<el-{}>", span.id)),
                "{}: {fragment:?}",
                span.id
            );
        }

        // El del grupo contiene al de su hijo.
        let group = found.iter().find(|one| one.id == "g1").expect("está");
        let child = found.iter().find(|one| one.id == "r2").expect("está");
        assert!(group.start < child.start && child.end < group.end);
    }

    #[test]
    fn code_without_elements_has_no_spans() {
        let document = Document::from_json_str(
            r##"{ "version": 1, "meta": { "title": "x" },
                  "pages": [ { "id": "p1", "size": { "width": 210, "height": 297 } } ] }"##,
        )
        .expect("es un documento");
        assert!(spans(&generate(&document).expect("genera")).is_empty());
    }

    /// Una etiqueta escrita a mano en un bloque de código no abre nada: sin
    /// un `#place(` al principio de su línea, no hay elemento que señalar.
    #[test]
    fn a_label_without_its_place_is_not_an_element() {
        assert!(spans("algo <el-r1>\n").is_empty());
        assert_eq!(spans("#place(top + left)[x] <el-r1>\n").len(), 1);
    }
}
