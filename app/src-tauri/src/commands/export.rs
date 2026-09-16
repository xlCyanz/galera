//! Exportar el documento abierto a PDF.
//!
//! # El mismo documento que se ve
//!
//! El PDF sale de **la misma compilación** que da los SVG del lienzo: la que
//! guarda el estado para la revisión abierta (ver [`crate::state`]). No se
//! compila aparte para exportar, así que lo exportado no puede discrepar de
//! lo que se ve (principio 2).
//!
//! Y es idéntico, byte a byte, al que produce `galera-cli` con el mismo
//! JSON: los dos compilan con `galera-core`, y el PDF del núcleo es
//! reproducible (sin fecha, con identificador derivado del contenido).
//!
//! # Orden
//!
//! Primero se obtiene el PDF y después se pregunta dónde guardarlo. Si el
//! documento no compila, se dice enseguida, sin hacer elegir un archivo para
//! nada.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::state::AppState;

/// Un PDF recién guardado, tal como lo ve la interfaz.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedPdf {
    /// Dónde se guardó.
    pub path: PathBuf,
    /// Cuánto ocupa, en bytes.
    pub bytes: usize,
}

/// Exporta el documento abierto a PDF, preguntando dónde guardarlo con el
/// diálogo nativo.
///
/// Devuelve `None` si se cancela el diálogo.
///
/// # Errores
///
/// - [`CommandError::NothingOpen`] si no hay proyecto abierto.
/// - [`CommandError::DoesNotCompile`] si el documento no compila.
/// - [`CommandError::Write`] si el archivo no se puede escribir.
#[tauri::command]
pub async fn export_pdf(
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<ExportedPdf>, CommandError> {
    let pdf = pdf_of_open_document(&state)?;
    let summary = state.summary();

    let mut dialog = window
        .dialog()
        .file()
        .set_title("Exportar a PDF")
        .set_file_name(default_file_name(summary.title.as_deref().unwrap_or("")))
        .add_filter("PDF", &["pdf"])
        .set_parent(&window);
    if let Some(root) = &summary.root {
        dialog = dialog.set_directory(root);
    }

    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;

    write_file(&path, &pdf)?;
    Ok(Some(ExportedPdf {
        path,
        bytes: pdf.len(),
    }))
}

/// El PDF del documento abierto, de la compilación guardada para su
/// revisión, o de una nueva si no hay.
fn pdf_of_open_document(state: &AppState) -> Result<Vec<u8>, CommandError> {
    let compilation = state.compilation().ok_or(CommandError::NothingOpen)?;
    let compiled = compilation.result.map_err(CommandError::DoesNotCompile)?;
    Ok(compiled.to_pdf()?)
}

/// El nombre que propone el diálogo: el título del documento, sin los
/// caracteres que algún sistema no admite en un nombre de archivo, y con
/// `.pdf`. Si no queda nada, `documento.pdf`.
pub fn default_file_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    // Espacios seguidos en uno, y sin puntos ni espacios en los extremos:
    // Windows no admite nombres que acaben en punto, y uno que empiece por
    // punto queda oculto en macOS y Linux.
    let name = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let name = name.trim_matches(|c: char| c == '.' || c.is_whitespace());

    if name.is_empty() {
        "documento.pdf".to_owned()
    } else {
        format!("{name}.pdf")
    }
}

/// Escribe el archivo entero o no lo toca.
///
/// Primero escribe una copia temporal junto al destino y después la renombra.
/// Si algo falla a medias —disco lleno, por ejemplo—, un PDF anterior con el
/// mismo nombre sigue intacto en vez de quedar cortado.
fn write_file(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let error = |source: io::Error| CommandError::Write {
        path: path.to_owned(),
        source,
    };

    let name = path
        .file_name()
        .ok_or_else(|| error(io::Error::from(io::ErrorKind::InvalidInput)))?;
    let mut temporary_name = std::ffi::OsString::from(".");
    temporary_name.push(name);
    temporary_name.push(".galera-tmp");
    let temporary = path.with_file_name(temporary_name);

    let written = fs::write(&temporary, bytes).and_then(|()| fs::rename(&temporary, path));
    if let Err(source) = written {
        // Si la copia temporal llegó a crearse, no se deja atrás.
        let _ = fs::remove_file(&temporary);
        return Err(error(source));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use galera_core::{Document, GaleraError, Project};
    use tempfile::TempDir;

    use super::*;

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    fn informe() -> (Project, Document) {
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let json =
            fs::read_to_string(fixtures_dir().join("informe.json")).expect("informe.json existe");
        (
            project,
            Document::from_json_str(&json).expect("es un documento"),
        )
    }

    /// El criterio de la tarea: el PDF exportado es el mismo que da
    /// `galera-cli`, que compila con `galera-core` y exporta con `to_pdf`.
    /// `galera-cli` comprueba en sus pruebas que su salida es esa.
    #[test]
    fn the_exported_pdf_is_the_one_the_core_and_the_cli_produce() {
        let (project, document) = informe();
        let from_core = galera_core::compile(&document, &project)
            .expect("compila")
            .to_pdf()
            .expect("exporta");

        let state = AppState::default();
        state.open(project, document);
        let exported = pdf_of_open_document(&state).expect("exporta");

        assert!(exported.starts_with(b"%PDF-"));
        assert!(exported == from_core, "los bytes tienen que ser idénticos");
    }

    /// El PDF sale de la compilación que ya dio los SVG, sin compilar otra
    /// vez.
    #[test]
    fn exporting_uses_the_compilation_shown_on_the_canvas() {
        let (project, document) = informe();
        let state = AppState::default();
        state.open(project, document);

        let shown = state.compilation().expect("hay documento");
        assert!(!shown.reused);
        pdf_of_open_document(&state).expect("exporta");
        assert!(state.compilation().expect("hay documento").reused);
    }

    #[test]
    fn without_an_open_project_there_is_nothing_to_export() {
        assert!(matches!(
            pdf_of_open_document(&AppState::default()),
            Err(CommandError::NothingOpen)
        ));
    }

    #[test]
    fn a_document_that_does_not_compile_is_not_exported() {
        let (project, mut document) = informe();
        document.pages[0].id = "no vale".to_owned();
        let state = AppState::default();
        state.open(project, document);

        let error = pdf_of_open_document(&state).expect_err("no compila");
        assert!(
            matches!(&error, CommandError::DoesNotCompile(inner) if matches!(**inner, GaleraError::Invalid(_))),
            "{error:?}"
        );
        assert_eq!(
            serde_json::to_value(&error).expect("serializa")["kind"],
            "invalid"
        );
    }

    #[test]
    fn the_file_is_written() {
        let dir = TempDir::new().expect("carpeta temporal");
        let path = dir.path().join("informe.pdf");

        write_file(&path, b"%PDF-uno").expect("se escribe");
        write_file(&path, b"%PDF-dos").expect("se sobrescribe");

        assert_eq!(fs::read(&path).expect("existe"), b"%PDF-dos");
        let entries = fs::read_dir(dir.path()).expect("se lee").count();
        assert_eq!(entries, 1, "no quedan copias temporales");
    }

    /// El criterio de la tarea: un error de escritura se informa, con el
    /// archivo y la causa, y no deja restos.
    #[test]
    fn a_write_error_is_reported_with_the_file() {
        let dir = TempDir::new().expect("carpeta temporal");
        let path = dir.path().join("no-existe").join("informe.pdf");

        let error = write_file(&path, b"%PDF-").expect_err("la carpeta no existe");
        assert!(
            matches!(&error, CommandError::Write { path: failed, .. } if *failed == path),
            "{error:?}"
        );
        assert!(error.to_string().starts_with("no se pudo guardar "));
        assert_eq!(fs::read_dir(dir.path()).expect("se lee").count(), 0);
    }

    /// Si el destino no se puede reemplazar, el archivo anterior sigue
    /// intacto y la copia temporal no se queda.
    #[test]
    fn a_failed_write_leaves_the_previous_file_untouched() {
        let dir = TempDir::new().expect("carpeta temporal");
        // Una carpeta con el nombre del destino: el renombrado falla.
        let path = dir.path().join("informe.pdf");
        fs::create_dir(&path).expect("carpeta");
        fs::write(path.join("dentro.txt"), b"intacto").expect("escribir");

        assert!(matches!(
            write_file(&path, b"%PDF-"),
            Err(CommandError::Write { .. })
        ));
        assert_eq!(
            fs::read(path.join("dentro.txt")).expect("sigue ahí"),
            b"intacto"
        );
        assert_eq!(fs::read_dir(dir.path()).expect("se lee").count(), 1);
    }

    /// El criterio de la tarea: el nombre por defecto sale de `meta.title`.
    #[test]
    fn the_default_file_name_comes_from_the_title() {
        assert_eq!(
            default_file_name("Informe anual 2026"),
            "Informe anual 2026.pdf"
        );
        assert_eq!(default_file_name("Ventas: Q1/Q2"), "Ventas Q1 Q2.pdf");
        assert_eq!(default_file_name("¿Qué? \"sí\" <no> | *"), "¿Qué sí no.pdf");
        assert_eq!(default_file_name("  .oculto. "), "oculto.pdf");
        assert_eq!(
            default_file_name("línea\nnueva\ttab"),
            "línea nueva tab.pdf"
        );
        assert_eq!(default_file_name(""), "documento.pdf");
        assert_eq!(default_file_name("///"), "documento.pdf");
    }
}
