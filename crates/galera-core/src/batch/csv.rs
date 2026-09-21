//! Leer un CSV para generar documentos en lote.
//!
//! Un CSV es una tabla: la primera fila son los nombres de las columnas y
//! cada fila de debajo, un documento. Lo que hace falta antes de generar
//! nada es **leerlo bien** —separadores, comillas, saltos de línea dentro de
//! un campo— y **saber qué columna va a qué variable**.
//!
//! # Lo que se adivina, y se puede cambiar
//!
//! - **El separador**: coma, punto y coma, tabulador o barra vertical. Se
//!   cuenta cuál aparece más veces por fila fuera de comillas, que es lo que
//!   distingue un CSV de verdad de uno con comas dentro de los campos.
//! - **La codificación**: UTF-8, con o sin BOM; si los bytes no son UTF-8
//!   válido, se lee como ISO-8859-1, que es lo que sale de una hoja de
//!   cálculo vieja en español y nunca falla.
//!
//! Las dos se pueden decir a mano: adivinar está bien mientras acierte.
//!
//! # Comillas
//!
//! Como manda la costumbre (RFC 4180): un campo entre comillas puede llevar
//! el separador, saltos de línea y comillas, escritas dos veces.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{Document, Variable};
use crate::variables;

/// Los separadores que se prueban, por orden de preferencia.
const SEPARATORS: [char; 4] = [',', ';', '\t', '|'];

/// Cuántas filas se leen para adivinar el separador.
const SNIFF_ROWS: usize = 5;

/// Cómo estaba escrito el archivo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    /// UTF-8, con o sin BOM.
    #[default]
    Utf8,
    /// ISO-8859-1, que es lo que sale de una hoja de cálculo vieja.
    Latin1,
}

/// Una tabla leída de un CSV.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct Csv {
    /// Con qué se separan las columnas.
    pub separator: String,
    /// Cómo estaba escrito.
    pub encoding: Encoding,
    /// Los nombres de las columnas, de la primera fila.
    pub headers: Vec<String>,
    /// Las filas de datos, cada una con un valor por columna.
    pub rows: Vec<Vec<String>>,
}

/// Lee un CSV.
///
/// `separator` y `encoding` se adivinan si no se dicen.
///
/// Una tabla sin filas de datos no es un error: es una tabla con sus
/// columnas y nada que generar todavía.
pub fn parse(bytes: &[u8], separator: Option<char>, encoding: Option<Encoding>) -> Csv {
    let (text, encoding) = decode(bytes, encoding);
    let separator = separator.unwrap_or_else(|| guess_separator(&text));
    let mut table = split(&text, separator);

    let headers = if table.is_empty() {
        Vec::new()
    } else {
        table.remove(0)
    };
    // Una fila vacía al final —el salto de línea del archivo— no es una fila.
    table.retain(|row| row.iter().any(|value| !value.trim().is_empty()));

    Csv {
        separator: separator.to_string(),
        encoding,
        headers,
        rows: table,
    }
}

/// El texto del archivo y con qué codificación se leyó.
///
/// Sin decir cuál: UTF-8 si los bytes lo son, y si no ISO-8859-1, donde
/// cualquier byte es un carácter y por eso nunca falla.
pub fn decode(bytes: &[u8], encoding: Option<Encoding>) -> (String, Encoding) {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match encoding {
        Some(Encoding::Latin1) => (latin1(bytes), Encoding::Latin1),
        Some(Encoding::Utf8) => (String::from_utf8_lossy(bytes).into_owned(), Encoding::Utf8),
        None => match std::str::from_utf8(bytes) {
            Ok(text) => (text.to_owned(), Encoding::Utf8),
            Err(_) => (latin1(bytes), Encoding::Latin1),
        },
    }
}

/// Cada byte, su carácter: eso es ISO-8859-1.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
}

/// Con qué se separan las columnas, mirando las primeras filas.
///
/// Gana el que aparezca el mismo número de veces en todas las filas y más
/// veces por fila; las comillas no cuentan, que es donde se esconden las
/// comas que no separan nada.
pub fn guess_separator(text: &str) -> char {
    let mut best = (0usize, SEPARATORS[0]);
    for candidate in SEPARATORS {
        let rows = split(text, candidate);
        let counts: Vec<usize> = rows
            .iter()
            .take(SNIFF_ROWS)
            .filter(|row| row.iter().any(|value| !value.trim().is_empty()))
            .map(Vec::len)
            .collect();
        let Some(first) = counts.first().copied() else {
            continue;
        };
        // Todas las filas con el mismo número de columnas, y más de una.
        if first > 1 && counts.iter().all(|count| *count == first) && first > best.0 {
            best = (first, candidate);
        }
    }
    best.1
}

/// Parte el texto en filas y campos, con las comillas de la costumbre.
fn split(text: &str, separator: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = text.chars().peekable();

    while let Some(character) = characters.next() {
        if quoted {
            if character == '"' {
                // Dos comillas seguidas son una comilla del campo.
                if characters.peek() == Some(&'"') {
                    characters.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(character);
            }
            continue;
        }
        match character {
            '"' if field.is_empty() => quoted = true,
            _ if character == separator => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(character),
        }
    }

    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// Qué columna le toca a cada variable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct Mapping {
    /// Por variable, la columna que la rellena, o `null` si ninguna.
    pub columns: BTreeMap<String, Option<usize>>,
}

/// Empareja las columnas con las variables por su nombre.
///
/// Se comparan sin distinguir mayúsculas, tildes ni espacios: la columna
/// «Razón social» rellena la variable `razon_social`. Lo que no encaje se
/// queda sin emparejar, para decirlo a mano.
pub fn match_columns(headers: &[String], variables: &BTreeMap<String, Variable>) -> Mapping {
    let normalized: Vec<String> = headers.iter().map(|header| normalize(header)).collect();
    let columns = variables
        .keys()
        .map(|name| {
            let wanted = normalize(name);
            let at = normalized.iter().position(|header| *header == wanted);
            (name.clone(), at)
        })
        .collect();
    Mapping { columns }
}

/// El nombre sin lo que no distingue: mayúsculas, tildes, espacios y guiones.
fn normalize(text: &str) -> String {
    text.chars()
        .filter_map(|character| {
            let lower = character.to_lowercase().next().unwrap_or(character);
            match lower {
                'á' | 'à' | 'ä' | 'â' => Some('a'),
                'é' | 'è' | 'ë' | 'ê' => Some('e'),
                'í' | 'ì' | 'ï' | 'î' => Some('i'),
                'ó' | 'ò' | 'ö' | 'ô' => Some('o'),
                'ú' | 'ù' | 'ü' | 'û' => Some('u'),
                'ñ' => Some('n'),
                ' ' | '_' | '-' | '.' => None,
                other if other.is_alphanumeric() => Some(other),
                _ => None,
            }
        })
        .collect()
}

/// Lo que le pasa a una fila del CSV.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct RowProblem {
    /// La variable de la que se habla.
    pub variable: String,
    /// Qué le pasa, listo para enseñar.
    pub message: String,
}

/// Una fila del CSV con lo que valdría cada variable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct Row {
    /// Qué fila del archivo es, contando desde 1 sin la cabecera.
    pub number: usize,
    /// Lo que vale cada variable en esta fila.
    pub values: BTreeMap<String, String>,
    /// Lo que le falta o no vale, si algo.
    pub problems: Vec<RowProblem>,
}

/// Las filas del CSV con los valores que le tocan a cada variable, y lo que
/// le falta a cada una.
///
/// Una fila con un valor que no vale para el tipo de su variable —una fecha
/// que no existe, un número que no lo es, una imagen que no está— se marca
/// aquí, **antes** de generar nada.
pub fn rows(document: &Document, csv: &Csv, mapping: &Mapping) -> Vec<Row> {
    csv.rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let mut values = BTreeMap::new();
            let mut problems = Vec::new();

            for (name, column) in &mapping.columns {
                let Some(column) = column else {
                    problems.push(RowProblem {
                        variable: name.clone(),
                        message: "no hay ninguna columna para esta variable".to_owned(),
                    });
                    continue;
                };
                let value = row.get(*column).cloned().unwrap_or_default();
                if value.trim().is_empty() {
                    problems.push(RowProblem {
                        variable: name.clone(),
                        message: "la fila no trae valor".to_owned(),
                    });
                }
                let kind = document
                    .variables
                    .get(name)
                    .map(|variable| variable.kind)
                    .unwrap_or_default();
                let candidate = Variable {
                    kind,
                    value: value.clone(),
                };
                if let Err(invalid) = variables::check(document, &candidate) {
                    problems.push(RowProblem {
                        variable: name.clone(),
                        message: reason(invalid).to_owned(),
                    });
                }
                values.insert(name.clone(), value);
            }

            Row {
                number: index + 1,
                values,
                problems,
            }
        })
        .collect()
}

/// Qué le pasa al valor, en español.
fn reason(invalid: variables::Invalid) -> &'static str {
    match invalid {
        variables::Invalid::NotANumber => "no es un número: se escribe con punto decimal",
        variables::Invalid::NotADate => "no es una fecha AAAA-MM-DD que exista",
        variables::Invalid::UnknownAsset => "no hay ningún recurso del documento con esa clave",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Lote" },
              "variables": {
                "empresa": { "kind": "text", "value": "" },
                "fecha": { "kind": "date", "value": "" },
                "total": { "kind": "number", "value": "" }
              },
              "pages": [ { "id": "p1", "size": { "width": 210, "height": 297 } } ]
            }"##,
        )
        .expect("es un documento")
    }

    #[test]
    fn it_reads_a_plain_csv() {
        let table = parse(
            b"empresa,fecha\nUna,2026-09-21\nOtra,2026-09-22\n",
            None,
            None,
        );

        assert_eq!(table.separator, ",");
        assert_eq!(table.encoding, Encoding::Utf8);
        assert_eq!(table.headers, vec!["empresa", "fecha"]);
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[1], vec!["Otra", "2026-09-22"]);
    }

    /// El criterio de la tarea: comillas, comas dentro y saltos de línea.
    #[test]
    fn quotes_hold_separators_newlines_and_quotes() {
        let table = parse(
            b"empresa,nota\n\"Coop, S.L.\",\"Dice \"\"hola\"\"\"\n\"Con\nsalto\",normal\n",
            None,
            None,
        );

        assert_eq!(table.headers, vec!["empresa", "nota"]);
        assert_eq!(table.rows[0], vec!["Coop, S.L.", "Dice \"hola\""]);
        assert_eq!(table.rows[1], vec!["Con\nsalto", "normal"]);
    }

    /// El criterio de la tarea: el separador se detecta.
    #[test]
    fn the_separator_is_the_one_that_holds_the_table_together() {
        // Con punto y coma, aunque haya comas dentro de los campos.
        let table = parse(
            "empresa;nota\nCoop, S.L.;Una nota, con coma\nOtra;Otra nota\n".as_bytes(),
            None,
            None,
        );
        assert_eq!(table.separator, ";");
        assert_eq!(table.headers, vec!["empresa", "nota"]);
        assert_eq!(table.rows[0], vec!["Coop, S.L.", "Una nota, con coma"]);

        // Y con tabuladores.
        let tabs = parse(b"a\tb\n1\t2\n", None, None);
        assert_eq!(tabs.separator, "\t");

        // Diciéndolo a mano manda lo que se diga.
        let forced = parse(b"a;b\n1;2\n", Some(','), None);
        assert_eq!(forced.headers, vec!["a;b"]);
    }

    /// El criterio de la tarea: la codificación se detecta.
    #[test]
    fn it_reads_utf8_with_and_without_bom_and_falls_back_to_latin1() {
        let utf8 = parse("empresa\nCooperativa Agrícola\n".as_bytes(), None, None);
        assert_eq!(utf8.encoding, Encoding::Utf8);
        assert_eq!(utf8.rows[0], vec!["Cooperativa Agrícola"]);

        let with_bom = parse(
            &[&[0xEF, 0xBB, 0xBF][..], "a\nb\n".as_bytes()].concat(),
            None,
            None,
        );
        assert_eq!(with_bom.headers, vec!["a"], "el BOM no entra en el nombre");

        // «Agrícola» en ISO-8859-1: el byte 0xED no es UTF-8 válido.
        let latin = parse(b"empresa\nAgr\xEDcola\n", None, None);
        assert_eq!(latin.encoding, Encoding::Latin1);
        assert_eq!(latin.rows[0], vec!["Agrícola"]);

        // Y se puede forzar.
        let forced = parse("a\ná\n".as_bytes(), None, Some(Encoding::Latin1));
        assert_eq!(forced.rows[0], vec!["Ã¡"]);
    }

    #[test]
    fn a_csv_with_only_headers_has_nothing_to_generate() {
        let table = parse(b"empresa,fecha\n", None, None);
        assert_eq!(table.headers.len(), 2);
        assert!(table.rows.is_empty());
        assert!(parse(b"", None, None).headers.is_empty());
    }

    /// El criterio de la tarea: las columnas se emparejan por su nombre.
    #[test]
    fn columns_find_their_variable_by_name() {
        let headers = vec![
            "Empresa".to_owned(),
            "Fecha ".to_owned(),
            "otra cosa".to_owned(),
        ];
        let mapping = match_columns(&headers, &document().variables);

        assert_eq!(mapping.columns["empresa"], Some(0));
        assert_eq!(mapping.columns["fecha"], Some(1));
        assert_eq!(mapping.columns["total"], None, "no hay columna para ella");
    }

    #[test]
    fn accents_and_underscores_do_not_get_in_the_way() {
        let mut variables = BTreeMap::new();
        variables.insert("razon_social".to_owned(), Variable::text(""));
        let mapping = match_columns(&["Razón Social".to_owned()], &variables);
        assert_eq!(mapping.columns["razon_social"], Some(0));
    }

    /// El criterio de la tarea: las filas con datos que no valen se marcan.
    #[test]
    fn rows_with_missing_or_invalid_data_are_marked() {
        let document = document();
        let csv = parse(
            b"empresa,fecha,total\nUna,2026-09-21,1250.5\n,2026-02-31,doce\n",
            None,
            None,
        );
        let mapping = match_columns(&csv.headers, &document.variables);
        let found = rows(&document, &csv, &mapping);

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].number, 1);
        assert!(found[0].problems.is_empty(), "{:#?}", found[0].problems);
        assert_eq!(found[0].values["total"], "1250.5");

        let bad = &found[1];
        let names: Vec<&str> = bad
            .problems
            .iter()
            .map(|problem| problem.variable.as_str())
            .collect();
        assert_eq!(names, vec!["empresa", "fecha", "total"]);
        assert!(bad.problems[0].message.contains("no trae valor"));
        assert!(bad.problems[1].message.contains("fecha"));
        assert!(bad.problems[2].message.contains("número"));
    }

    #[test]
    fn a_variable_without_a_column_is_a_problem_of_every_row() {
        let document = document();
        let csv = parse(b"empresa\nUna\n", None, None);
        let mapping = match_columns(&csv.headers, &document.variables);
        let found = rows(&document, &csv, &mapping);

        let missing: Vec<&str> = found[0]
            .problems
            .iter()
            .map(|problem| problem.variable.as_str())
            .collect();
        assert_eq!(missing, vec!["fecha", "total"]);
    }

    #[test]
    fn a_row_with_fewer_fields_than_columns_is_not_a_crash() {
        let document = document();
        let csv = parse(b"empresa,fecha,total\nUna\n", None, None);
        let mapping = match_columns(&csv.headers, &document.variables);
        let found = rows(&document, &csv, &mapping);

        assert_eq!(found[0].values["fecha"], "");
        assert!(!found[0].problems.is_empty());
    }
}
