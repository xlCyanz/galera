//! Las zonas de un texto que fluye.
//!
//! Una zona ([`crate::Element::Flow`]) no lleva texto: lo lleva su flujo, y
//! el texto pasa de una zona a la siguiente cuando no cabe. Repartirlo es
//! F7-02; **aquí la zona se compone vacía**, con su caja y su etiqueta, para
//! que se vea dónde está y se pueda seleccionar y mover como cualquier otro
//! elemento.
//!
//! Que se componga vacía no es un apaño silencioso: mientras el reparto no
//! exista, componer la misma cadena en todas las zonas escribiría el texto
//! entero varias veces, que es peor que no escribirlo.

use crate::model::ElementBox;

use super::millimeters;

/// Escribe una zona: un bloque de su tamaño, sin contenido todavía.
pub(super) fn emit_zone(base: &ElementBox, out: &mut String) {
    out.push_str(&format!("#block(width: {}", millimeters(base.w)));
    if let Some(height) = base.h {
        out.push_str(&format!(", height: {}", millimeters(height)));
    }
    out.push(')');
}

#[cfg(test)]
mod tests {
    use crate::codegen::generate;
    use crate::model::Document;

    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Flujo" },
              "flows": {
                "cuerpo": {
                  "content": [{ "text": "Un texto largo" }],
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
                    { "id": "z2", "type": "flow", "x": 20, "y": 20, "w": 80, "h": null,
                      "flow": "cuerpo" }
                  ] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    #[test]
    fn a_zone_is_a_block_of_its_size_with_its_label() {
        let code = generate(&document()).expect("se genera");
        assert!(
            code.contains("#block(width: 80mm, height: 100mm)] <el-z1>"),
            "{code}"
        );
        // Sin alto, el bloque solo lleva el ancho.
        assert!(code.contains("#block(width: 80mm)] <el-z2>"), "{code}");
    }

    /// Hasta F7-02, el texto del flujo no se escribe en ninguna zona: mejor
    /// vacío que repetido en todas.
    #[test]
    fn the_text_of_the_flow_is_not_written_yet() {
        let code = generate(&document()).expect("se genera");
        assert!(!code.contains("Un texto largo"), "{code}");
    }
}
