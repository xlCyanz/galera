//! Cuerpo de las imágenes.
//!
//! Un elemento de imagen no guarda la ruta del archivo sino una **clave** del
//! mapa [`Document::assets`]. Aquí se resuelve la clave a la ruta y se emite
//! la función `image()` de Typst:
//!
//! ```typst
//! #image("assets/logo.png", width: 80mm)
//! ```
//!
//! # Proporción
//!
//! - Solo ancho (`h: null`): Typst calcula el alto conservando la proporción
//!   original de la imagen. Es el caso normal.
//! - Ancho y alto: la imagen llena el marco y Typst recorta lo que sobra,
//!   que es su `fit` por defecto (`"cover"`). El modelo todavía no tiene un
//!   campo para elegir otro ajuste; si hace falta, llegará con el inspector
//!   de imagen.
//!
//! # Lo que este módulo no comprueba, a propósito
//!
//! **Que la ruta no se salga de la carpeta del proyecto.** Esa comprobación
//! es de `World` (F0-11), no del codegen, por una razón concreta: `World` es
//! el único sitio por el que pasa *todo* acceso a archivos, incluidas las
//! rutas escritas a mano dentro de un bloque de código personalizado, que el
//! codegen copia sin mirar. Una comprobación aquí se podría saltar por ese
//! lado y daría una seguridad que no existe.
//!
//! Lo que sí se garantiza aquí es que la ruta no puede cerrar su cadena y
//! escribir código detrás: va escrita con [`typst_string`].

use crate::model::{Document, ElementBox};

use super::{CodegenError, millimeters, typst_string};

/// Escribe una imagen.
///
/// # Errores
///
/// Falla si la clave no está declarada en [`Document::assets`]. Mejor aquí,
/// con el id del elemento y la clave, que dejar que Typst se queje de un
/// archivo que no encuentra.
pub(super) fn emit_image(
    base: &ElementBox,
    asset: &str,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    let Some(path) = document.assets.get(asset) else {
        return Err(CodegenError::UnknownAsset {
            element_id: base.id.clone(),
            key: asset.to_owned(),
        });
    };

    out.push_str(&format!(
        "#image({}, width: {}",
        typst_string(path),
        millimeters(base.w)
    ));

    if let Some(height) = base.h {
        out.push_str(&format!(", height: {}", millimeters(height)));
    }

    out.push(')');
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::codegen::{CodegenError, generate};
    use crate::model::Document;

    fn document(assets: &str, element: &str) -> Document {
        let json = format!(
            r#"{{
              "version": 1,
              "meta": {{ "title": "Imagen" }},
              "assets": {assets},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{element}]
              }}]
            }}"#
        );
        Document::from_json_str(&json).expect("el documento debe deserializar")
    }

    fn generate_with(assets: &str, element: &str) -> String {
        generate(&document(assets, element)).expect("el documento debe generar código")
    }

    const LOGO: &str = r#"{ "logo": "assets/logo.png" }"#;

    const IMAGE: &str =
        r#"{ "id": "i1", "type": "image", "x": 20, "y": 60, "w": 80, "h": null, "asset": "logo" }"#;

    #[test]
    fn the_key_resolves_to_the_declared_path() {
        let typst = generate_with(LOGO, IMAGE);
        assert!(
            typst.contains(r#"#image("assets/logo.png", width: 80mm)"#),
            "{typst}"
        );
    }

    /// Con solo el ancho, Typst conserva la proporción de la imagen.
    #[test]
    fn a_null_height_keeps_the_original_proportion() {
        let typst = generate_with(LOGO, IMAGE);
        assert!(
            !typst.contains("#image(\"assets/logo.png\", width: 80mm, height:"),
            "{typst}"
        );
    }

    #[test]
    fn a_fixed_height_is_written() {
        let typst = generate_with(
            LOGO,
            r#"{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 80, "h": 40, "asset": "logo" }"#,
        );
        assert!(
            typst.contains(r#"#image("assets/logo.png", width: 80mm, height: 40mm)"#),
            "{typst}"
        );
    }

    #[test]
    fn every_format_is_emitted_the_same_way() {
        for path in [
            "assets/foto.jpg",
            "assets/foto.jpeg",
            "assets/icono.svg",
            "assets/logo.png",
        ] {
            let assets = format!(r#"{{ "a": "{path}" }}"#);
            let typst = generate_with(
                &assets,
                r#"{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null, "asset": "a" }"#,
            );
            assert!(
                typst.contains(&format!(r#"#image("{path}""#)),
                "{path}: {typst}"
            );
        }
    }

    /// El criterio de la tarea: una clave que no existe es un error claro
    /// con el id del elemento, no un archivo que Typst no encuentra.
    #[test]
    fn an_unknown_key_is_a_clear_error() {
        let document = document(
            LOGO,
            r#"{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null, "asset": "portada" }"#,
        );

        let error = generate(&document).expect_err("una clave inexistente debe fallar");
        assert_eq!(
            error,
            CodegenError::UnknownAsset {
                element_id: "i1".to_owned(),
                key: "portada".to_owned(),
            }
        );

        let message = error.to_string();
        assert!(
            message.contains("i1"),
            "el mensaje debe nombrar el elemento: {message}"
        );
        assert!(
            message.contains("portada"),
            "el mensaje debe nombrar la clave: {message}"
        );
    }

    #[test]
    fn a_document_without_assets_rejects_any_image() {
        let document = document("{}", IMAGE);
        assert!(matches!(
            generate(&document),
            Err(CodegenError::UnknownAsset { .. })
        ));
    }

    /// La ruta va en una cadena de Typst y no puede cerrarla.
    #[test]
    fn a_path_cannot_break_out_of_its_string() {
        let path = r#"a.png") #import "evil.typ" #image(""#;
        let assets = format!(
            r#"{{ "a": {} }}"#,
            serde_json::to_string(path).expect("un str siempre serializa")
        );
        let typst = generate_with(
            &assets,
            r#"{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null, "asset": "a" }"#,
        );
        assert!(
            typst.contains(r#"#image("a.png\") #import \"evil.typ\" #image(\"", width: 10mm)"#),
            "{typst}"
        );
    }

    #[test]
    fn a_rotated_image_is_wrapped_in_rotate() {
        let typst = generate_with(
            LOGO,
            r#"{ "id": "i1", "type": "image", "x": 0, "y": 0, "w": 10, "h": null,
                 "rotation": 90, "asset": "logo" }"#,
        );
        assert!(
            typst.contains("#rotate(90deg, origin: center + horizon)[#image("),
            "{typst}"
        );
    }

    #[test]
    fn image_snapshot() {
        insta::assert_snapshot!(generate_with(LOGO, IMAGE));
    }
}
