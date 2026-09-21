//! Dónde está roto el código de un bloque.
//!
//! Un bloque de código es la única parte del documento donde entra Typst
//! escrito a mano (ver `codegen::code`). Al escribirlo, lo que hace falta es
//! saber **en qué línea** está el error mientras se escribe, y eso la
//! compilación no lo dice: el código viaja dentro de un `eval(...)`, y Typst
//! sitúa lo que falle en esa llamada, no dentro de la cadena.
//!
//! Aquí se le pregunta a **Typst** por las líneas, con su propio analizador
//! y sobre el texto del bloque tal cual. No es leer el código para entender
//! qué dibuja —eso sigue sin hacerse en ningún sitio (principio 1)—: es
//! preguntar dónde está el fallo para poder señalarlo.
//!
//! Lo que sale de aquí son **errores de sintaxis**. Lo que falla al evaluar
//! —una función que no existe, un archivo que no está— no se ve hasta
//! compilar, y llega como cualquier otro diagnóstico, atribuido al bloque.

use serde::Serialize;
use typst::syntax::{DiagSpan, DiagSpanKind, Source};

/// Un error de sintaxis del código de un bloque.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "code.ts"))]
pub struct CodeError {
    /// Lo que dice Typst.
    pub message: String,
    /// En qué línea del código del bloque, contando desde 1.
    pub line: usize,
    /// En qué columna, contando desde 1 y en caracteres.
    pub column: usize,
    /// Sugerencias de Typst para arreglarlo, si las hay.
    pub hints: Vec<String>,
}

/// Los errores de sintaxis del código de un bloque, en orden.
///
/// Con el código a medio escribir casi siempre hay alguno: es lo normal
/// mientras se teclea, y por eso se enseña en su línea y no como un error
/// del documento.
pub fn check_code(source: &str) -> Vec<CodeError> {
    let parsed = Source::detached(source);
    let (errors, _warnings) = parsed.root().errors_and_warnings();
    let mut found: Vec<CodeError> = errors
        .into_iter()
        .map(|error| {
            let at = offset(&parsed, error.span).min(source.len());
            let (line, column) = position(source, at);
            CodeError {
                message: error.message.to_string(),
                line,
                column,
                hints: error.hints.iter().map(|hint| hint.v.to_string()).collect(),
            }
        })
        .collect();
    found.sort_by_key(|error| (error.line, error.column));
    found
}

/// Dónde empieza lo que señala el diagnóstico, en bytes del código.
fn offset(source: &Source, span: DiagSpan) -> usize {
    match span.get() {
        DiagSpanKind::Detached => 0,
        DiagSpanKind::Number { id, num, sub_range } => (id == source.id())
            .then(|| source.range(num, sub_range))
            .flatten()
            .map_or(0, |range| range.start),
        DiagSpanKind::Range { id, range } => {
            if id == source.id() {
                range.start
            } else {
                0
            }
        }
    }
}

/// La línea y la columna del byte `at`, contando desde 1.
fn position(source: &str, at: usize) -> (usize, usize) {
    let before = &source[..at.min(source.len())];
    let line = before.matches('\n').count() + 1;
    let column = before
        .rsplit_once('\n')
        .map_or(before, |(_, last)| last)
        .chars()
        .count()
        + 1;
    (line, column)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El criterio de la tarea: el error sale en la línea que lo provoca.
    #[test]
    fn a_broken_bracket_is_reported_on_its_line() {
        let source = "Una línea\nOtra línea\n#table(columns: 2)[A\nUna más";
        let found = check_code(source);

        assert_eq!(found.len(), 1, "{found:#?}");
        assert_eq!(found[0].line, 3, "{found:#?}");
        assert!(
            found[0].message.contains("unclosed"),
            "{}",
            found[0].message
        );
    }

    #[test]
    fn the_column_counts_characters_and_not_bytes() {
        // El corchete sin cerrar es el carácter 21; la tilde de delante
        // ocupa dos bytes, así que contándolos saldría el 22.
        let found = check_code("ó #table(columns: 2)[A");
        assert_eq!(found.len(), 1, "{found:#?}");
        assert_eq!((found[0].line, found[0].column), (1, 21), "{found:#?}");
    }

    #[test]
    fn code_that_parses_has_no_errors() {
        assert!(check_code("#table(columns: 2)[A][B]").is_empty());
        assert!(check_code("Texto normal, sin nada raro.").is_empty());
        assert!(check_code("").is_empty());
    }

    /// Lo que falla al evaluar no es cosa de la sintaxis: eso se ve al
    /// compilar.
    #[test]
    fn an_unknown_function_is_not_a_syntax_error() {
        assert!(check_code("#funcion_que_no_existe()").is_empty());
    }

    #[test]
    fn several_errors_come_in_order() {
        let found = check_code("#table(\n\n[A\n\n#figure(");
        assert!(found.len() >= 2, "{found:#?}");
        let lines: Vec<usize> = found.iter().map(|error| error.line).collect();
        let mut sorted = lines.clone();
        sorted.sort_unstable();
        assert_eq!(lines, sorted, "{found:#?}");
    }
}
