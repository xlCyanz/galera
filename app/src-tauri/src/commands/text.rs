//! Lo que hay dentro de un bloque de texto.
//!
//! El cursor y la selección se dibujan sobre el render de Typst, así que
//! sus posiciones salen de la propia composición y no de una medida hecha
//! en la interfaz (principio 3). Este comando las saca de la última
//! compilación que salió bien, que es la que se está viendo.
//!
//! # Con qué documento
//!
//! Con el suyo, el de esa compilación
//! ([`AppState::last_good_render`]), no con el de ahora: entre que se
//! escribe una letra y termina la compilación, el documento va por delante
//! de lo que se ve, y traducir un glifo al texto de otro documento daría
//! posiciones que no son.

use galera_core::Glyph;
use tauri::State;

use crate::commands::CommandError;
use crate::state::AppState;

/// Dónde quedó cada glifo del bloque de texto `id`, en milímetros de la
/// página y sin girar.
///
/// La lista sale vacía si no hay nada compilado todavía, si el elemento no
/// existe o si no es un bloque de texto.
#[tauri::command]
pub async fn glyphs(id: String, state: State<'_, AppState>) -> Result<Vec<Glyph>, CommandError> {
    Ok(glyphs_in(&state, &id))
}

/// La parte de [`glyphs`] que no depende de Tauri, para poder probarla.
fn glyphs_in(state: &AppState, id: &str) -> Vec<Glyph> {
    match state.last_good_render() {
        Some((compiled, document)) => compiled.glyphs(&document, id),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use galera_core::{Document, Project};
    use tempfile::TempDir;

    use super::*;

    /// Un proyecto con una fuente de verdad y un texto de dos líneas.
    fn with_text(text: &str) -> (TempDir, AppState) {
        let dir = TempDir::new().expect("carpeta temporal");
        fs::create_dir(dir.path().join("fonts")).expect("fonts/");
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Inter-Regular.ttf");
        fs::copy(source, dir.path().join("fonts/Inter-Regular.ttf")).expect("copiar la fuente");

        let json = format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Texto" }},
              "fonts": ["fonts/Inter-Regular.ttf"],
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [
                  {{ "id": "t1", "type": "text", "x": 20, "y": 20, "w": 80, "h": null,
                     "content": [{{ "text": "{text}" }}],
                     "style": {{ "font": "Inter", "size": 12, "color": "#1F2733",
                                "align": "left", "leading": 0.65 }} }},
                  {{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                     "fill": "#000000", "stroke": null }}
                ]
              }}]
            }}"##
        );
        fs::write(dir.path().join("document.json"), &json).expect("escribir");
        let project = Project::open(dir.path()).expect("abrir proyecto");
        let document = Document::from_json_str(&json).expect("documento");
        let state = AppState::default();
        state.open(project, document);
        (dir, state)
    }

    #[test]
    fn without_a_compilation_there_are_no_glyphs() {
        let (_dir, state) = with_text("Hola");
        assert!(glyphs_in(&state, "t1").is_empty());
    }

    #[test]
    fn the_glyphs_of_a_text_come_from_the_compilation() {
        let (_dir, state) = with_text("Hola");
        state.compilation().expect("compila");

        let found = glyphs_in(&state, "t1");
        assert_eq!(found.len(), 4, "una por letra: {found:?}");
        assert_eq!(found[0].text_index, 0);
        assert!(found[0].x >= 20.0, "empieza donde el elemento: {found:?}");
        assert!(found[0].width > 0.0 && found[0].line_height > 0.0);
        assert!(found.iter().all(|glyph| glyph.line == 0));
    }

    #[test]
    fn what_is_not_a_text_has_no_glyphs() {
        let (_dir, state) = with_text("Hola");
        state.compilation().expect("compila");
        assert!(glyphs_in(&state, "r1").is_empty());
        assert!(glyphs_in(&state, "no-existe").is_empty());
    }

    /// Las posiciones son las de lo que se está viendo: si el documento ya
    /// lleva una letra más y todavía no ha compilado, se devuelven las de la
    /// compilación buena, no una lista vacía.
    #[test]
    fn the_glyphs_are_the_ones_of_what_is_on_screen() {
        let (_dir, state) = with_text("Hola");
        state.compilation().expect("compila");
        let before = glyphs_in(&state, "t1");

        state
            .apply(
                &galera_core::Op::InsertText {
                    id: "t1".to_owned(),
                    at: 4,
                    text: "!".to_owned(),
                },
                None,
            )
            .expect("hay documento")
            .expect("se aplica");

        assert_eq!(glyphs_in(&state, "t1"), before, "todavía las de antes");
    }
}
