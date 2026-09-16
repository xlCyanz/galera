//! Cuerpo de los bloques de código personalizado.
//!
//! Es la única excepción al principio 1 del README: aquí sí entra código
//! Typst escrito por una persona, y se ejecuta tal cual.
//!
//! # Por qué este contenido no pasa por `escape_into`
//!
//! Porque es código, no texto. Escaparlo lo convertiría en texto literal y
//! el bloque mostraría `#table(columns: 2)[A][B]` en vez de una tabla. El
//! elemento existe precisamente para que el documento pueda llevar Typst
//! que el editor no sabe generar.
//!
//! La consecuencia es de seguridad y está en `SECURITY.md`: **un documento
//! de origen desconocido trae código que se ejecuta**. Este módulo no lo
//! puede evitar, solo acotar.
//!
//! # Por qué `eval` y no insertarlo a pelo
//!
//! ```typst
//! #block(width: 170mm, height: 40mm, eval("#table(columns: 2)[A][B]", mode: "markup"))
//! ```
//!
//! La forma obvia sería copiar el código dentro de un bloque de contenido:
//! `#block(...)[#table(columns: 2)[A][B]]`. Tiene un fallo grave: el código
//! puede traer corchetes sin cerrar. Un `]` de más cierra la envoltura del
//! elemento antes de tiempo, y a partir de ahí **el resto del documento
//! entero** se analiza mal: las etiquetas `<el-ID>` de los elementos que
//! vienen detrás dejan de estar donde deben y el error aparece lejos de su
//! causa.
//!
//! Eso no es un caso raro sino el caso normal. En F5-09 el bloque se edita
//! en vivo y se recompila con cada tecla, así que el código está a medio
//! escribir casi todo el tiempo: `#table(columns: 2)[A` es un estado por el
//! que pasa cualquiera. Con el código insertado a pelo, cada una de esas
//! pulsaciones dejaría el lienzo entero en error.
//!
//! Con `eval`, el código viaja como **una sola cadena** y Typst lo analiza
//! por separado:
//!
//! - un error de sintaxis se queda dentro de este elemento y el resto del
//!   documento sigue componiéndose;
//! - el error se produce en la línea de este elemento, que es lo que F0-16
//!   necesita para atribuirlo;
//! - las posiciones del error son relativas al propio bloque, que es lo que
//!   el editor de código de F5-09 quiere enseñar.
//!
//! # Lo que `eval` no aísla: las etiquetas
//!
//! El código evaluado sí produce contenido con etiquetas, así que un bloque
//! que contenga `<el-r1>` crea una segunda etiqueta con el id de otro
//! elemento. No es una vía de inyección —no escapa de su cadena— pero
//! confundiría una búsqueda ingenua de cajas por etiqueta. F2-01 tiene que
//! fiarse solo de la etiqueta que va pegada al `place` de cada elemento.
//!
//! # El precio
//!
//! **El código evaluado no tiene acceso a disco.** Dentro de un bloque de
//! código no funcionan `image("...")`, `read("...")` ni `import "..."` de
//! archivos del proyecto. Para imágenes está el elemento de imagen.
//!
//! Visto desde `SECURITY.md` es una ventaja: el código que trae un documento
//! ajeno no puede leer nada del proyecto. Visto desde el producto es un
//! límite real, y si algún día pesa más que lo de arriba, el cambio está
//! entero en [`emit_code`].
//!
//! # Pendiente de comprobar contra el compilador
//!
//! Escrito contra la documentación y el comportamiento conocido de `eval`.
//! Que un error quede contenido y se atribuya a su elemento se comprueba en
//! F0-12 y F0-16.

use crate::model::ElementBox;

use super::{millimeters, typst_string};

/// Escribe un bloque de código personalizado.
///
/// No puede fallar: el código se transporta sin interpretarlo, y sus errores
/// son de Typst, al compilar, no del codegen.
pub(super) fn emit_code(base: &ElementBox, source: &str, out: &mut String) {
    out.push_str(&format!("#block(width: {}", millimeters(base.w)));

    if let Some(height) = base.h {
        out.push_str(&format!(", height: {}", millimeters(height)));
    }

    // `typst_string` no escapa el código en el sentido de neutralizarlo: lo
    // transporta. Lo que Typst evalúa es exactamente `source`, carácter a
    // carácter.
    out.push_str(&format!(
        ", eval({}, mode: \"markup\"))",
        typst_string(source)
    ));
}

#[cfg(test)]
mod tests {
    use crate::codegen::generate;
    use crate::model::Document;

    fn generate_with(source: &str, h: &str) -> String {
        let source = serde_json::to_string(source).expect("un str siempre serializa");
        let json = format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Código" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [
                  {{ "id": "c1", "type": "code", "x": 20, "y": 200, "w": 170, "h": {h},
                     "source": {source} }},
                  {{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                     "fill": null, "stroke": null }}
                ]
              }}]
            }}"##
        );
        let document = Document::from_json_str(&json).expect("el documento debe deserializar");
        generate(&document).expect("el documento debe generar código")
    }

    #[test]
    fn the_source_is_evaluated_as_markup_inside_a_block() {
        let typst = generate_with("#table(columns: 2)[A][B]", "40");
        assert!(
            typst.contains(
                r##"#block(width: 170mm, height: 40mm, eval("#table(columns: 2)[A][B]", mode: "markup"))"##
            ),
            "{typst}"
        );
    }

    #[test]
    fn a_null_height_is_left_for_typst_to_measure() {
        let typst = generate_with("#table(columns: 2)[A][B]", "null");
        assert!(typst.contains("#block(width: 170mm, eval("), "{typst}");
    }

    /// El criterio de la tarea: el código no se escapa como texto. Si lo
    /// hiciera, `#table` saldría como `\#table` y se vería el código en vez
    /// de la tabla.
    #[test]
    fn the_source_is_not_escaped_as_markup() {
        let typst = generate_with("#table(columns: 2)[*A*][_B_]", "null");
        assert!(
            typst.contains(r##"eval("#table(columns: 2)[*A*][_B_]""##),
            "{typst}"
        );
        assert!(!typst.contains(r"\#table"), "{typst}");
        assert!(!typst.contains(r"\*A\*"), "{typst}");
    }

    /// El motivo de usar `eval`: un corchete de más no puede cerrar la
    /// envoltura del elemento, así que el siguiente elemento sigue intacto
    /// y con su etiqueta en su sitio.
    #[test]
    fn unbalanced_brackets_cannot_break_out_of_the_element() {
        let typst = generate_with("#table(columns: 2)[A]] ] #rect() <el-r1>", "null");

        assert!(
            typst.contains(
                r##"eval("#table(columns: 2)[A]] ] #rect() <el-r1>", mode: "markup"))] <el-c1>"##
            ),
            "todo el código tiene que quedar dentro de la cadena: {typst}"
        );
        assert!(
            typst
                .contains("\n#place(top + left, dx: 0mm, dy: 0mm)[#rect(width: 10mm, height: 10mm"),
            "el elemento siguiente tiene que seguir en su propia línea: {typst}"
        );
    }

    /// Lo mismo con código a medio escribir, que en F5-09 es el estado
    /// normal mientras alguien teclea.
    #[test]
    fn half_written_code_stays_inside_its_string() {
        let typst = generate_with("#table(columns: 2)[A", "null");
        assert!(
            typst.contains(r##"eval("#table(columns: 2)[A", mode: "markup"))] <el-c1>"##),
            "{typst}"
        );
    }

    /// Comillas, barras y saltos de línea viajan dentro de la cadena sin
    /// cerrarla, y Typst los devuelve tal cual al evaluarla.
    #[test]
    fn quotes_backslashes_and_newlines_travel_intact() {
        let typst = generate_with("#let saludo = \"hola\"\n#saludo \\ adiós", "null");
        assert!(
            typst.contains(r##"eval("#let saludo = \"hola\"\n#saludo \\ adiós", mode: "markup")"##),
            "{typst}"
        );
    }

    #[test]
    fn an_empty_source_is_an_empty_block() {
        let typst = generate_with("", "null");
        assert!(typst.contains(r##"eval("", mode: "markup")"##), "{typst}");
    }

    #[test]
    fn a_rotated_block_is_wrapped_in_rotate() {
        let json = r##"{
          "version": 1,
          "meta": { "title": "x" },
          "pages": [{
            "id": "p1",
            "size": { "width": 210, "height": 297, "unit": "mm" },
            "elements": [{ "id": "c1", "type": "code", "x": 0, "y": 0, "w": 50, "h": null,
                           "rotation": 45, "source": "#lorem(5)" }]
          }]
        }"##;
        let document = Document::from_json_str(json).expect("debe deserializar");
        let typst = generate(&document).expect("debe generar");
        assert!(
            typst.contains("#rotate(45deg, origin: center + horizon)[#block(width: 50mm, eval("),
            "{typst}"
        );
    }

    #[test]
    fn code_block_snapshot() {
        insta::assert_snapshot!(generate_with(
            "#table(\n  columns: 2,\n  [*Concepto*], [*Importe*],\n  [Cuota \"anual\"], [120 €],\n)",
            "40"
        ));
    }
}
