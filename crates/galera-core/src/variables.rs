//! Las variables del documento: dónde se usan y qué valores admiten.
//!
//! Una variable se usa escribiendo **`{{nombre}}`** dentro del texto de un
//! bloque o del código de un bloque de código. Sustituirlas al generar el
//! código es de F6-02; lo que hay aquí es lo que hace falta para
//! manejarlas: saber **dónde se usa cada una**, cambiarles el nombre sin
//! dejar el documento señalando a una que ya no está, y decir si un valor
//! vale para el tipo que se le ha dado.
//!
//! # Los tipos
//!
//! El tipo no cambia cómo se sustituye —lo que entra en el documento es
//! siempre texto—, pero sí qué valores se admiten:
//!
//! - **Texto**: cualquier cosa.
//! - **Número**: con punto decimal, como los del documento (`-12.5`).
//! - **Fecha**: `AAAA-MM-DD`, y tiene que existir en el calendario: el 31 de
//!   febrero no vale, y el 29 solo en año bisiesto.
//! - **Imagen**: la clave de un recurso del documento, que tiene que estar.
//!
//! Un valor vacío no es un error: una variable recién creada está vacía, y
//! lo que se dice de ella es que no tiene valor, no que sea inválida.

use crate::model::{Document, Element, Variable, VariableKind};

/// Cómo se escribe una variable dentro de un texto: `{{nombre}}`.
pub fn reference(name: &str) -> String {
    format!("{{{{{name}}}}}")
}

/// Los elementos que usan la variable, por su id y en orden del documento.
///
/// Se mira el texto de los bloques de texto y el código de los bloques de
/// código, también dentro de los grupos.
pub fn uses(document: &Document, name: &str) -> Vec<String> {
    let needle = reference(name);
    document
        .elements()
        .filter(|element| match element {
            Element::Text { content, .. } => content.iter().any(|run| run.text.contains(&needle)),
            Element::Code { source, .. } => source.contains(&needle),
            _ => false,
        })
        .map(|element| element.id().to_owned())
        .collect()
}

/// Cambia `{{from}}` por `{{to}}` en todo el documento.
///
/// Devuelve cuántos sitios se han cambiado.
pub fn rename_in(document: &mut Document, from: &str, to: &str) -> usize {
    let (needle, replacement) = (reference(from), reference(to));
    let mut changed = 0;

    fn walk(elements: &mut [Element], needle: &str, replacement: &str, changed: &mut usize) {
        for element in elements {
            match element {
                Element::Text { content, .. } => {
                    for run in content {
                        if run.text.contains(needle) {
                            run.text = run.text.replace(needle, replacement);
                            *changed += 1;
                        }
                    }
                }
                Element::Code { source, .. } => {
                    if source.contains(needle) {
                        *source = source.replace(needle, replacement);
                        *changed += 1;
                    }
                }
                Element::Group { children, .. } => {
                    walk(children, needle, replacement, changed);
                }
                _ => {}
            }
        }
    }

    for page in &mut document.pages {
        walk(&mut page.elements, &needle, &replacement, &mut changed);
    }
    changed
}

/// Por qué un valor no vale para el tipo de su variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Invalid {
    /// No es un número.
    NotANumber,
    /// No es una fecha del calendario, `AAAA-MM-DD`.
    NotADate,
    /// No hay ningún recurso con esa clave.
    UnknownAsset,
}

/// Si el valor de la variable vale para su tipo.
///
/// Un valor vacío siempre vale: una variable sin valor está sin rellenar,
/// que no es lo mismo que estar mal.
///
/// # Errores
///
/// [`Invalid`] con lo que le pasa al valor.
pub fn check(document: &Document, variable: &Variable) -> Result<(), Invalid> {
    if variable.value.is_empty() {
        return Ok(());
    }
    match variable.kind {
        VariableKind::Text => Ok(()),
        VariableKind::Number => variable
            .value
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite())
            .map(|_| ())
            .ok_or(Invalid::NotANumber),
        VariableKind::Date => is_date(&variable.value)
            .then_some(())
            .ok_or(Invalid::NotADate),
        VariableKind::Image => document
            .assets
            .contains_key(&variable.value)
            .then_some(())
            .ok_or(Invalid::UnknownAsset),
    }
}

/// Si el texto es una fecha `AAAA-MM-DD` que existe en el calendario.
fn is_date(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<i32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    (1..=12).contains(&month) && (1..=days_in(year, month)).contains(&day)
}

/// Cuántos días tiene ese mes de ese año.
fn days_in(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Variables" },
              "assets": { "logo": "assets/logo.png" },
              "variables": {
                "nombre": "Cooperativa",
                "fecha": { "kind": "date", "value": "2026-09-21" },
                "total": { "kind": "number", "value": "1250.5" },
                "sello": { "kind": "image", "value": "logo" }
              },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 }, "elements": [
                  { "id": "t1", "type": "text", "x": 0, "y": 0, "w": 100, "h": null,
                    "content": [{ "text": "Hola {{nombre}}, " }, { "text": "van {{total}}" }],
                    "style": { "font": "Inter", "size": 12, "color": "#000000" } },
                  { "id": "c1", "type": "code", "x": 0, "y": 50, "w": 100, "h": 20,
                    "source": "#text[{{nombre}}]" },
                  { "id": "r1", "type": "rect", "x": 0, "y": 80, "w": 10, "h": 10,
                    "fill": "#ff0000" }
                ] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    /// Los documentos de antes, sin tipo, se siguen leyendo.
    #[test]
    fn a_variable_written_as_a_bare_value_is_read_as_text() {
        let document = document();
        assert_eq!(document.variables["nombre"], Variable::text("Cooperativa"));
        assert_eq!(document.variables["fecha"].kind, VariableKind::Date);

        // Y al guardarlas quedan todas con su tipo escrito.
        let json = document.to_json_string().expect("serializa");
        assert!(
            json.contains(r#""nombre":{"kind":"text","value":"Cooperativa"}"#),
            "{json}"
        );
        assert!(
            json.contains(r#""fecha":{"kind":"date","value":"2026-09-21"}"#),
            "{json}"
        );
    }

    /// El criterio de la tarea: se ve dónde se usa cada variable.
    #[test]
    fn it_says_where_each_variable_is_used() {
        let document = document();
        assert_eq!(uses(&document, "nombre"), vec!["t1", "c1"]);
        assert_eq!(uses(&document, "total"), vec!["t1"]);
        assert!(uses(&document, "fecha").is_empty());
        assert!(uses(&document, "loquesea").is_empty());
    }

    /// El criterio de la tarea: renombrar cambia todas sus apariciones.
    #[test]
    fn renaming_changes_every_use() {
        let mut document = document();
        assert_eq!(rename_in(&mut document, "nombre", "empresa"), 2);

        assert_eq!(uses(&document, "empresa"), vec!["t1", "c1"]);
        assert!(uses(&document, "nombre").is_empty());
        let Element::Text { content, .. } = document.element("t1").expect("está") else {
            panic!("es un texto");
        };
        assert_eq!(content[0].text, "Hola {{empresa}}, ");
    }

    #[test]
    fn a_number_has_to_be_a_number() {
        let document = document();
        let number = |value: &str| {
            check(
                &document,
                &Variable {
                    kind: VariableKind::Number,
                    value: value.to_owned(),
                },
            )
        };
        assert!(number("1250.5").is_ok());
        assert!(number("-12").is_ok());
        assert!(number("").is_ok(), "sin valor no es un error");
        assert_eq!(number("1.250,5"), Err(Invalid::NotANumber));
        assert_eq!(number("doce"), Err(Invalid::NotANumber));
        assert_eq!(number("inf"), Err(Invalid::NotANumber));
    }

    #[test]
    fn a_date_has_to_exist_in_the_calendar() {
        let document = document();
        let date = |value: &str| {
            check(
                &document,
                &Variable {
                    kind: VariableKind::Date,
                    value: value.to_owned(),
                },
            )
        };
        assert!(date("2026-09-21").is_ok());
        assert!(date("2024-02-29").is_ok(), "bisiesto");
        assert_eq!(date("2026-02-29"), Err(Invalid::NotADate));
        assert_eq!(date("2026-13-01"), Err(Invalid::NotADate));
        assert_eq!(date("2026-9-21"), Err(Invalid::NotADate), "con dos cifras");
        assert_eq!(date("21/09/2026"), Err(Invalid::NotADate));
        assert_eq!(date("ayer"), Err(Invalid::NotADate));
    }

    #[test]
    fn an_image_has_to_be_a_resource_of_the_document() {
        let document = document();
        let image = |value: &str| {
            check(
                &document,
                &Variable {
                    kind: VariableKind::Image,
                    value: value.to_owned(),
                },
            )
        };
        assert!(image("logo").is_ok());
        assert_eq!(image("otro"), Err(Invalid::UnknownAsset));
    }

    #[test]
    fn a_text_takes_anything() {
        let document = document();
        assert!(check(&document, &Variable::text("lo que sea, 12/13/2026")).is_ok());
    }
}
