//! Leer un CSV para generar documentos en lote.
//!
//! El archivo lo elige quien usa la app en el diálogo del sistema, como
//! cualquier otro: la interfaz no puede pedir que se lea una ruta que no se
//! haya ofrecido ahí. Lo que se lee, y qué columna le toca a cada variable,
//! lo decide el núcleo (`galera_core::batch::csv`, principio 5).

use std::path::PathBuf;

use galera_core::batch::csv::{self, Csv, Encoding, Mapping, Row};
use serde::Serialize;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::CommandError;
use crate::state::AppState;

/// Un CSV leído, con lo que hace falta para enseñarlo.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCsv {
    /// De dónde salió.
    pub path: PathBuf,
    /// La tabla: columnas y filas.
    #[serde(flatten)]
    pub csv: Csv,
    /// Qué columna le toca a cada variable, adivinado por el nombre.
    pub mapping: Mapping,
    /// Las filas ya miradas: lo que valdría cada variable y lo que falta.
    ///
    /// No se llama `rows` porque la tabla ya trae las suyas, que son los
    /// campos tal cual salieron del archivo.
    pub checked: Vec<Row>,
}

/// Enseña el diálogo para elegir un CSV y lo lee.
///
/// Devuelve `null` si se cancela.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento —sin variables no hay
/// nada que emparejar— o [`CommandError::Write`] si el archivo no se puede
/// leer.
#[tauri::command]
pub async fn choose_csv(
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<LoadedCsv>, CommandError> {
    let chosen = window
        .dialog()
        .file()
        .set_title("Elegir un CSV para generar en lote")
        .add_filter("Tablas", &["csv", "tsv", "txt"])
        .set_parent(&window)
        .blocking_pick_file();

    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| CommandError::NotALocalPath)?;
    state.offer_files(std::slice::from_ref(&path));
    Ok(Some(read_in(&state, &path, None, None)?))
}

/// Vuelve a leer un CSV ya elegido con otro separador u otra codificación.
///
/// # Errores
///
/// Los de [`choose_csv`], más el de pedir un archivo que no se ha elegido en
/// el diálogo.
#[tauri::command]
pub async fn read_csv(
    path: PathBuf,
    separator: Option<String>,
    encoding: Option<Encoding>,
    state: State<'_, AppState>,
) -> Result<LoadedCsv, CommandError> {
    if !state.was_offered(&path) {
        return Err(CommandError::FolderNotChosen { path });
    }
    let separator = separator.and_then(|one| one.chars().next());
    read_in(&state, &path, separator, encoding)
}

/// La parte de los dos comandos que no depende de Tauri.
fn read_in(
    state: &AppState,
    path: &std::path::Path,
    separator: Option<char>,
    encoding: Option<Encoding>,
) -> Result<LoadedCsv, CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    let bytes = std::fs::read(path).map_err(|source| CommandError::Write {
        path: path.to_owned(),
        source,
    })?;

    let csv = csv::parse(&bytes, separator, encoding);
    let mapping = csv::match_columns(&csv.headers, &document.variables);
    let checked = csv::rows(&document, &csv, &mapping);
    Ok(LoadedCsv {
        path: path.to_owned(),
        csv,
        mapping,
        checked,
    })
}

/// Vuelve a mirar las filas con otro emparejamiento, sin releer el archivo.
///
/// # Errores
///
/// [`CommandError::NothingOpen`] si no hay documento.
#[tauri::command]
pub async fn check_rows(
    csv: Csv,
    mapping: Mapping,
    state: State<'_, AppState>,
) -> Result<Vec<Row>, CommandError> {
    let (_, document) = state.open_document().ok_or(CommandError::NothingOpen)?;
    Ok(csv::rows(&document, &csv, &mapping))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use galera_core::{Document, Project};
    use tempfile::TempDir;

    use super::*;

    /// El estado con un documento que declara tres variables.
    fn opened() -> AppState {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        let project = Project::open(&dir).expect("fixtures/ es un proyecto");
        let document = Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Lote" },
              "variables": {
                "empresa": { "kind": "text", "value": "" },
                "fecha": { "kind": "date", "value": "" }
              },
              "pages": [ { "id": "p1", "size": { "width": 210, "height": 297 } } ]
            }"##,
        )
        .expect("es un documento");
        let state = AppState::default();
        state.open(project, document);
        state
    }

    /// Un CSV en una carpeta temporal.
    fn csv_file(dir: &TempDir, contents: &[u8]) -> PathBuf {
        let path = dir.path().join("clientes.csv");
        fs::write(&path, contents).expect("se escribe");
        path
    }

    #[test]
    fn it_reads_the_file_and_matches_the_columns() {
        let dir = TempDir::new().expect("carpeta temporal");
        let path = csv_file(&dir, b"Empresa;Fecha\nUna;2026-09-21\nOtra;2026-02-31\n");
        let state = opened();

        let loaded = read_in(&state, &path, None, None).expect("se lee");

        assert_eq!(loaded.csv.separator, ";");
        assert_eq!(loaded.mapping.columns["empresa"], Some(0));
        assert_eq!(loaded.checked.len(), 2);
        assert!(loaded.checked[0].problems.is_empty());
        // El 31 de febrero no existe: se dice antes de generar nada.
        assert!(!loaded.checked[1].problems.is_empty());
    }

    #[test]
    fn the_separator_and_the_encoding_can_be_forced() {
        let dir = TempDir::new().expect("carpeta temporal");
        let path = csv_file(&dir, b"Empresa;Fecha\nUna;2026-09-21\n");
        let state = opened();

        let loaded = read_in(&state, &path, Some(','), Some(Encoding::Latin1)).expect("se lee");
        assert_eq!(loaded.csv.separator, ",");
        assert_eq!(loaded.csv.encoding, Encoding::Latin1);
        assert_eq!(loaded.csv.headers, vec!["Empresa;Fecha"]);
    }

    #[test]
    fn a_file_that_is_not_there_says_so() {
        let state = opened();
        let error = read_in(&state, Path::new("/no/existe.csv"), None, None).expect_err("no está");
        assert_eq!(error.kind(), "write");
    }

    #[test]
    fn without_a_document_there_is_nothing_to_match() {
        let dir = TempDir::new().expect("carpeta temporal");
        let path = csv_file(&dir, b"a\n1\n");
        let error = read_in(&AppState::default(), &path, None, None).expect_err("no hay");
        assert_eq!(error.kind(), "nothing_open");
    }
}
