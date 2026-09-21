//! Lo que hay dentro de una tabla: sus columnas y el texto de una celda.
//!
//! Dónde quedó cada celda llega con cada compilación, junto a las cajas de
//! los elementos (ver `compile_worker`). Lo que se pide aquí es lo de
//! dentro de una celda: dónde quedó cada glifo de su texto, para poner el
//! cursor y pintar la selección.
//!
//! Como en [`super::text`], se pregunta a la última compilación que salió
//! bien, que es la que se está viendo: el documento de ahora puede ir por
//! delante de lo que hay en pantalla.

use galera_core::{Element, Glyph};
use tauri::State;

use crate::commands::CommandError;
use crate::state::AppState;

/// Dónde quedó cada glifo del texto de una celda, para poner el cursor y
/// pintar la selección dentro de ella.
///
/// La celda se dice por su sitio en la rejilla, el mismo que trae
/// [`CellBox`]. La lista sale vacía si no hay nada compilado, si no hay tal
/// tabla o si esa columna de esa fila no la ocupa ninguna celda.
#[tauri::command]
pub async fn cell_glyphs(
    table: String,
    row: usize,
    column: usize,
    state: State<'_, AppState>,
) -> Result<Vec<Glyph>, CommandError> {
    Ok(cell_glyphs_in(&state, &table, row, column))
}

/// La parte de [`cell_glyphs`] que no depende de Tauri.
fn cell_glyphs_in(state: &AppState, table: &str, row: usize, column: usize) -> Vec<Glyph> {
    match state.last_good_render() {
        Some((compiled, document)) => compiled.cell_glyphs(&document, table, row, column),
        None => Vec::new(),
    }
}

/// Por dónde pasan los bordes de las columnas de una tabla, de izquierda a
/// derecha: uno más que columnas, contando los dos extremos.
///
/// Es lo que hace falta para arrastrarlos. Un borde que no se sabe —una
/// columna sin ninguna celda sin combinar— sale como `null`, y la lista
/// sale vacía si no hay nada compilado o si no hay tal tabla.
#[tauri::command]
pub async fn column_edges(
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<Option<f64>>, CommandError> {
    Ok(column_edges_in(&state, &table))
}

/// La parte de [`column_edges`] que no depende de Tauri.
fn column_edges_in(state: &AppState, table: &str) -> Vec<Option<f64>> {
    let Some((compiled, document)) = state.last_good_render() else {
        return Vec::new();
    };
    let Some(Element::Table { columns, .. }) = document.element(table) else {
        return Vec::new();
    };
    galera_core::column_edges(&compiled.cells(&document), table, columns.len())
}
