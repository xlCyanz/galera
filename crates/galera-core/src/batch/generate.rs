//! Generar muchos documentos de uno solo.
//!
//! Con un documento que tiene variables y una tabla con una fila por
//! documento ([`super::csv`]), aquí se hace lo que falta: **poner los
//! valores de cada fila y componer**.
//!
//! # Dos formas de sacarlo
//!
//! - **Un PDF por fila**, en una carpeta, con el nombre que diga un patrón:
//!   `{{empresa}}-2026.pdf`. El patrón se rellena con los valores de la fila
//!   igual que el documento, y lo que no valga como nombre de archivo se
//!   cambia por un guion.
//! - **Un solo PDF con todas**, que no es pegar PDF: es **un documento con
//!   las páginas de todas las filas**, compuesto de una vez. Así el índice,
//!   la numeración y las fuentes son las de un documento normal, y no hay
//!   que pegar archivos por fuera.
//!
//! # Lo que no para el lote
//!
//! Una fila que no compone —porque su valor deja un texto que no cabe, o
//! porque falta un recurso— **no aborta nada**: se apunta y se sigue. Al
//! final se dice cuántas salieron y qué le pasó a cada una de las que no.
//!
//! # Cancelar
//!
//! Quien llama recibe el avance fila a fila y contesta si seguir. Con eso,
//! la interfaz puede enseñar una barra y un botón de cancelar sin que este
//! módulo sepa nada de ventanas.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::compile::cache::Compiler;
use crate::model::{Document, Element, Page, Variable};
use crate::project::Project;
use crate::variables;

use super::csv::Row;

/// Qué se saca del lote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Output {
    /// Un PDF por fila, en `dir`, con el nombre que salga de `pattern`.
    PerRow {
        /// La carpeta donde se dejan.
        dir: PathBuf,
        /// El patrón del nombre, con fichas: `{{empresa}}-2026.pdf`.
        pattern: String,
    },
    /// Un solo PDF con las páginas de todas las filas.
    Combined {
        /// Dónde se deja.
        path: PathBuf,
    },
}

/// Cómo va el lote, fila a fila.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct Progress {
    /// Cuántas filas se han hecho ya, contando las que fallaron.
    pub done: usize,
    /// Cuántas hay en total.
    pub total: usize,
}

/// Lo que le pasó a una fila que no salió.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct Failure {
    /// Qué fila, contando desde 1.
    pub row: usize,
    /// Qué le pasó, listo para enseñar.
    pub message: String,
}

/// Cómo acabó el lote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "batch.ts"))]
pub struct Outcome {
    /// Los archivos que se han escrito, en orden.
    pub written: Vec<PathBuf>,
    /// Las filas que no salieron, con lo que les pasó.
    pub failures: Vec<Failure>,
    /// Si se paró antes de acabar porque se pidió cancelar.
    pub cancelled: bool,
}

/// Genera el lote.
///
/// `progress` recibe el avance después de cada fila y contesta `false` para
/// **parar**: lo que se llevara escrito se queda, y el resultado lo dice.
///
/// No falla: lo que le pase a una fila se apunta en [`Outcome::failures`] y
/// el lote sigue. Lo único que no se intenta es escribir donde no se puede,
/// y eso también sale ahí.
pub fn generate(
    document: &Document,
    project: &Project,
    rows: &[Row],
    output: &Output,
    progress: &mut dyn FnMut(Progress) -> bool,
) -> Outcome {
    match output {
        Output::PerRow { dir, pattern } => per_row(document, project, rows, dir, pattern, progress),
        Output::Combined { path } => combined(document, project, rows, path, progress),
    }
}

/// Un PDF por fila.
fn per_row(
    document: &Document,
    project: &Project,
    rows: &[Row],
    dir: &Path,
    pattern: &str,
    progress: &mut dyn FnMut(Progress) -> bool,
) -> Outcome {
    let mut outcome = Outcome::default();
    // Un compilador para todo el lote: el entorno y las fuentes se preparan
    // una vez y no en cada fila.
    let mut compiler = Compiler::new(project.clone());
    let mut taken: Vec<String> = Vec::new();

    for (index, row) in rows.iter().enumerate() {
        let filled = with_values(document, &row.values);
        let name = file_name(pattern, &row.values, row.number, &mut taken);
        let path = dir.join(&name);

        match compile_pdf(&mut compiler, &filled) {
            Ok(pdf) => match std::fs::write(&path, pdf) {
                Ok(()) => outcome.written.push(path),
                Err(error) => outcome.failures.push(Failure {
                    row: row.number,
                    message: format!("no se puede escribir {}: {error}", path.display()),
                }),
            },
            Err(message) => outcome.failures.push(Failure {
                row: row.number,
                message,
            }),
        }

        if !progress(Progress {
            done: index + 1,
            total: rows.len(),
        }) {
            outcome.cancelled = index + 1 < rows.len();
            break;
        }
    }

    outcome
}

/// Un solo PDF con las páginas de todas las filas.
fn combined(
    document: &Document,
    project: &Project,
    rows: &[Row],
    path: &Path,
    progress: &mut dyn FnMut(Progress) -> bool,
) -> Outcome {
    let mut outcome = Outcome::default();
    let mut whole = document.clone();
    whole.pages.clear();

    for (index, row) in rows.iter().enumerate() {
        whole.pages.extend(pages_of(document, row));

        if !progress(Progress {
            done: index + 1,
            total: rows.len(),
        }) {
            outcome.cancelled = index + 1 < rows.len();
            break;
        }
    }

    if whole.pages.is_empty() {
        return outcome;
    }

    let mut compiler = Compiler::new(project.clone());
    match compile_pdf(&mut compiler, &whole) {
        Ok(pdf) => match std::fs::write(path, pdf) {
            Ok(()) => outcome.written.push(path.to_owned()),
            Err(error) => outcome.failures.push(Failure {
                row: 0,
                message: format!("no se puede escribir {}: {error}", path.display()),
            }),
        },
        Err(message) => outcome.failures.push(Failure { row: 0, message }),
    }

    outcome
}

/// Las páginas de una fila, ya con sus valores puestos y con los ids
/// marcados para que no choquen con los de otra.
///
/// Es lo que lleva el PDF combinado: no son PDF pegados, son **las páginas
/// de todas las filas en un documento**, que se compone de una vez.
pub fn pages_of(document: &Document, row: &Row) -> Vec<Page> {
    renamed(&with_values(document, &row.values), row.number)
}

/// El documento con los valores de una fila puestos en sus variables.
///
/// El tipo de cada variable se queda como estaba: lo que cambia es lo que
/// vale.
fn with_values(document: &Document, values: &BTreeMap<String, String>) -> Document {
    let mut filled = document.clone();
    for (name, value) in values {
        let kind = filled
            .variables
            .get(name)
            .map(|variable| variable.kind)
            .unwrap_or_default();
        filled.variables.insert(
            name.clone(),
            Variable {
                kind,
                value: value.clone(),
            },
        );
    }
    filled
}

/// Las páginas de una fila, con los ids marcados con su número.
///
/// Los ids son únicos en el documento, así que las de la fila 2 no pueden
/// llamarse igual que las de la 1.
fn renamed(document: &Document, row: usize) -> Vec<Page> {
    document
        .pages
        .iter()
        .map(|page| {
            let mut copy = page.clone();
            copy.id = format!("{}-f{row}", page.id);
            for element in &mut copy.elements {
                mark(element, row);
            }
            copy
        })
        .collect()
}

/// Le pone al elemento —y a lo que lleve dentro— el número de su fila.
fn mark(element: &mut Element, row: usize) {
    element.set_id(format!("{}-f{row}", element.id()));
    if let Element::Group { children, .. } = element {
        for child in children {
            mark(child, row);
        }
    }
}

/// Compila a PDF y devuelve lo que salga, o por qué no salió.
fn compile_pdf(compiler: &mut Compiler, document: &Document) -> Result<Vec<u8>, String> {
    compiler
        .compile(document)
        .and_then(|compiled| compiled.to_pdf())
        .map_err(|error| error.to_string())
}

/// El nombre del archivo de una fila, con su patrón relleno.
///
/// Lo que no vale en un nombre de archivo se cambia por un guion, y si el
/// nombre se repite o sale vacío, se usa el número de la fila.
fn file_name(
    pattern: &str,
    values: &BTreeMap<String, String>,
    row: usize,
    taken: &mut Vec<String>,
) -> String {
    // Un valor vacío quita la ficha, que en un nombre de archivo es lo que
    // se quiere: `{{empresa}}.pdf` sin empresa no es un nombre.
    let mut filled = String::with_capacity(pattern.len());
    let mut at = 0;
    while at < pattern.len() {
        match variables::reference_at(pattern, at) {
            Some((name, length)) => {
                filled.push_str(values.get(name).map_or("", String::as_str));
                at += length;
            }
            None => {
                let character = pattern[at..].chars().next().unwrap_or(' ');
                filled.push(character);
                at += character.len_utf8();
            }
        }
    }

    let mut name: String = filled
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\n' | '\r' | '\0' => '-',
            other => other,
        })
        .collect();
    name = name.trim().trim_matches('.').to_owned();
    if name.is_empty() || name == ".pdf" {
        name = format!("fila-{row}.pdf");
    }
    if !name.to_lowercase().ends_with(".pdf") {
        name.push_str(".pdf");
    }

    // Dos filas con el mismo nombre no se pisan.
    if taken.contains(&name) {
        let stem = name.trim_end_matches(".pdf").trim_end_matches(".PDF");
        name = format!("{stem}-{row}.pdf");
    }
    taken.push(name.clone());
    name
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::TempDir;

    use super::*;
    use crate::batch::csv;

    /// Un documento con una variable, sin fuentes: compila deprisa.
    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Lote" },
              "variables": { "empresa": { "kind": "text", "value": "" } },
              "pages": [ { "id": "p1", "size": { "width": 100, "height": 100 }, "elements": [
                { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 100, "h": 20,
                  "fill": "#1F2733" }
              ] } ]
            }"##,
        )
        .expect("es un documento")
    }

    fn project() -> Project {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        Project::open(&dir).expect("fixtures/ es un proyecto")
    }

    /// Filas con un valor para `empresa`.
    fn rows(names: &[&str]) -> Vec<Row> {
        names
            .iter()
            .enumerate()
            .map(|(index, name)| Row {
                number: index + 1,
                values: BTreeMap::from([("empresa".to_owned(), (*name).to_owned())]),
                problems: Vec::new(),
            })
            .collect()
    }

    /// Un avance que no cancela nunca.
    fn go_on() -> impl FnMut(Progress) -> bool {
        |_| true
    }

    /// El criterio de la tarea: un PDF por fila, con su patrón de nombre.
    #[test]
    fn one_pdf_per_row_named_by_the_pattern() {
        let dir = TempDir::new().expect("carpeta temporal");
        let outcome = generate(
            &document(),
            &project(),
            &rows(&["Una", "Otra"]),
            &Output::PerRow {
                dir: dir.path().to_owned(),
                pattern: "{{empresa}}-2026.pdf".to_owned(),
            },
            &mut go_on(),
        );

        assert!(outcome.failures.is_empty(), "{:#?}", outcome.failures);
        assert_eq!(outcome.written.len(), 2);
        assert!(dir.path().join("Una-2026.pdf").is_file());
        assert!(dir.path().join("Otra-2026.pdf").is_file());
        let pdf = std::fs::read(dir.path().join("Una-2026.pdf")).expect("se lee");
        assert!(pdf.starts_with(b"%PDF"), "es un PDF");
    }

    /// El criterio de la tarea: un solo PDF con todas.
    #[test]
    fn all_the_rows_in_one_pdf() {
        let dir = TempDir::new().expect("carpeta temporal");
        let path = dir.path().join("todas.pdf");
        let outcome = generate(
            &document(),
            &project(),
            &rows(&["Una", "Otra", "Tercera"]),
            &Output::Combined { path: path.clone() },
            &mut go_on(),
        );

        assert!(outcome.failures.is_empty(), "{:#?}", outcome.failures);
        assert_eq!(outcome.written, vec![path.clone()]);
        let pdf = std::fs::read(&path).expect("se lee");
        assert!(pdf.starts_with(b"%PDF"));

        // Tres filas de una página son tres páginas, con ids que no chocan.
        let rows = rows(&["Una", "Otra", "Tercera"]);
        let pages: Vec<Page> = rows
            .iter()
            .flat_map(|row| pages_of(&document(), row))
            .collect();
        assert_eq!(pages.len(), 3);
        let ids: Vec<&str> = pages.iter().map(|page| page.id.as_str()).collect();
        assert_eq!(ids, vec!["p1-f1", "p1-f2", "p1-f3"]);
        assert_eq!(pages[1].elements[0].id(), "r1-f2");
    }

    /// El criterio de la tarea: un fallo no aborta el lote.
    #[test]
    fn a_row_that_does_not_go_through_does_not_stop_the_others() {
        let dir = TempDir::new().expect("carpeta temporal");
        // Una variable de fecha: un 31 de febrero no pasa la validación.
        let mut dated = document();
        dated.variables.insert(
            "empresa".to_owned(),
            Variable {
                kind: crate::model::VariableKind::Date,
                value: String::new(),
            },
        );

        let outcome = generate(
            &dated,
            &project(),
            &rows(&["2026-02-31", "2026-09-21"]),
            &Output::PerRow {
                dir: dir.path().to_owned(),
                pattern: "{{empresa}}.pdf".to_owned(),
            },
            &mut go_on(),
        );

        // La primera fila no pasa; la segunda sí, y se escribe.
        assert_eq!(outcome.failures.len(), 1, "{outcome:#?}");
        assert_eq!(outcome.failures[0].row, 1);
        assert_eq!(outcome.written.len(), 1);
        assert!(dir.path().join("2026-09-21.pdf").is_file());
    }

    /// El criterio de la tarea: se puede cancelar.
    #[test]
    fn it_stops_when_it_is_told_to() {
        let dir = TempDir::new().expect("carpeta temporal");
        let mut seen = Vec::new();
        let outcome = generate(
            &document(),
            &project(),
            &rows(&["Una", "Otra", "Tercera"]),
            &Output::PerRow {
                dir: dir.path().to_owned(),
                pattern: "{{empresa}}.pdf".to_owned(),
            },
            &mut |progress| {
                seen.push(progress.done);
                // Se cancela después de la primera.
                progress.done < 1
            },
        );

        assert!(outcome.cancelled);
        assert_eq!(seen, vec![1]);
        assert_eq!(outcome.written.len(), 1, "lo hecho se queda");
    }

    #[test]
    fn a_name_that_repeats_or_does_not_work_gets_one_that_does() {
        let mut taken = Vec::new();
        let values = |value: &str| BTreeMap::from([("empresa".to_owned(), value.to_owned())]);

        // Las barras no valen en un nombre de archivo.
        assert_eq!(
            file_name("{{empresa}}.pdf", &values("Coop/S.L."), 1, &mut taken),
            "Coop-S.L..pdf"
        );
        // Sin extensión, se le pone.
        assert_eq!(
            file_name("{{empresa}}", &values("Una"), 2, &mut taken),
            "Una.pdf"
        );
        // Repetido, se distingue con el número de fila.
        assert_eq!(
            file_name("{{empresa}}", &values("Una"), 3, &mut taken),
            "Una-3.pdf"
        );
        // Y sin nada que poner, el número de fila.
        assert_eq!(
            file_name("{{empresa}}", &values(""), 4, &mut taken),
            "fila-4.pdf"
        );
    }

    /// El criterio de la tarea: cien filas.
    #[test]
    fn a_hundred_rows_come_out() {
        let dir = TempDir::new().expect("carpeta temporal");
        let names: Vec<String> = (1..=100)
            .map(|number| format!("Empresa {number}"))
            .collect();
        let rows: Vec<Row> = names
            .iter()
            .enumerate()
            .map(|(index, name)| Row {
                number: index + 1,
                values: BTreeMap::from([("empresa".to_owned(), name.clone())]),
                problems: Vec::new(),
            })
            .collect();

        let mut last = 0;
        let outcome = generate(
            &document(),
            &project(),
            &rows,
            &Output::PerRow {
                dir: dir.path().to_owned(),
                pattern: "{{empresa}}.pdf".to_owned(),
            },
            &mut |progress| {
                assert_eq!(progress.total, 100);
                last = progress.done;
                true
            },
        );

        assert!(outcome.failures.is_empty(), "{:#?}", outcome.failures);
        assert_eq!(outcome.written.len(), 100);
        assert_eq!(last, 100);
        assert!(dir.path().join("Empresa 100.pdf").is_file());
    }

    /// Lo que viene de un CSV entra tal cual: es el camino de verdad.
    #[test]
    fn it_takes_the_rows_of_a_csv() {
        let dir = TempDir::new().expect("carpeta temporal");
        let document = document();
        let table = csv::parse(b"empresa\nUna\nOtra\n", None, None);
        let mapping = csv::match_columns(&table.headers, &document.variables);
        let rows = csv::rows(&document, &table, &mapping);

        let outcome = generate(
            &document,
            &project(),
            &rows,
            &Output::PerRow {
                dir: dir.path().to_owned(),
                pattern: "{{empresa}}.pdf".to_owned(),
            },
            &mut go_on(),
        );
        assert_eq!(outcome.written.len(), 2, "{outcome:#?}");
    }
}
