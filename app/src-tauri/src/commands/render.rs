//! Compilar el documento abierto y obtener el SVG de una página.
//!
//! Es la tubería que alimenta el lienzo: la interfaz pide una página y
//! recibe su SVG, los diagnósticos de Typst y lo que tardó la compilación.
//!
//! # Una compilación, todas las páginas
//!
//! El documento se compila una vez por revisión y de ahí salen todas las
//! páginas que se pidan (ver [`crate::state`]). Pedir las páginas 0, 1 y 2
//! seguidas, o a la vez, compila una sola vez; las respuestas que no han
//! compilado lo dicen con `reused: true`.
//!
//! # Los errores de compilación son datos
//!
//! Un documento que no compila es algo normal mientras se edita, no un fallo
//! del comando. Así que la respuesta es la misma forma siempre: sin `svg`,
//! con el `error` y sus `diagnostics`. El comando solo falla —la promesa se
//! rechaza— cuando la petición no tiene sentido: no hay nada abierto o la
//! página no existe.

use galera_core::{Diagnostic, GaleraError, LayoutBox};
use serde::Serialize;
use tauri::State;

use crate::commands::CommandError;
use crate::compile_worker::CompileQueue;
use crate::state::AppState;

/// Una página compilada, tal como la ve la interfaz.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPage {
    /// El SVG de la página, o `null` si el documento no compila.
    pub svg: Option<String>,
    /// Los diagnósticos de Typst: los avisos si compiló, los errores si no.
    pub diagnostics: Vec<Diagnostic>,
    /// Por qué no compila, con la forma de cualquier error: `{ kind,
    /// message, … }`. `null` si compiló.
    pub error: Option<CommandError>,
    /// Lo que tardó la compilación de la que sale la página, en
    /// milisegundos.
    pub ms: f64,
    /// Si la página sale de una compilación anterior, sin compilar ahora.
    pub reused: bool,
    /// La revisión del documento que se compiló. Si no es la última que
    /// conoce la interfaz, la respuesta llega tarde y se puede ignorar.
    pub revision: u64,
    /// La caja real de cada elemento de esta página, tal como la compuso
    /// Typst (ver `galera_core::layout`). Vacía si no compila.
    pub boxes: Vec<LayoutBox>,
}

/// Devuelve el SVG de una página del documento abierto, compilándolo si
/// hace falta. Las páginas se cuentan desde 0.
///
/// # Errores
///
/// Solo si la petición no tiene sentido: [`CommandError::NothingOpen`] si no
/// hay proyecto abierto, o la página no existe. Un documento que no compila
/// **no** es un error del comando: ver el módulo.
#[tauri::command]
pub async fn render_page(
    page: usize,
    state: State<'_, AppState>,
) -> Result<RenderedPage, CommandError> {
    render(&state, page)
}

/// Pide compilar el documento abierto en segundo plano. Vuelve enseguida;
/// el resultado llega con los eventos de [`crate::compile_worker`].
#[tauri::command]
pub fn request_compilation(queue: State<'_, CompileQueue>) {
    queue.request();
}

/// La interfaz ha perdido las páginas que tenía —se ha recargado, o le
/// falta alguna—: se vuelve a compilar y la entrega va entera. Si el
/// documento no ha cambiado, se reutiliza lo compilado.
#[tauri::command]
pub fn resend_pages(state: State<'_, AppState>, queue: State<'_, CompileQueue>) {
    state.resend_pages();
    queue.request();
}

/// La parte de [`render_page`] que no depende de Tauri, para poder probarla.
fn render(state: &AppState, page: usize) -> Result<RenderedPage, CommandError> {
    let compilation = state.compilation().ok_or(CommandError::NothingOpen)?;
    let ms = compilation.duration.as_secs_f64() * 1000.0;

    Ok(match compilation.result {
        Ok(compiled) => RenderedPage {
            svg: Some(compiled.to_svg(page)?),
            diagnostics: compiled.warnings().to_vec(),
            error: None,
            ms,
            reused: compilation.reused,
            revision: compilation.revision,
            boxes: compiled
                .layout()
                .into_iter()
                .filter(|layout_box| layout_box.page == page)
                .collect(),
        },
        Err(error) => RenderedPage {
            svg: None,
            diagnostics: match &*error {
                GaleraError::Typst(diagnostics) => diagnostics.clone(),
                _ => Vec::new(),
            },
            error: Some(CommandError::DoesNotCompile(error)),
            ms,
            reused: compilation.reused,
            revision: compilation.revision,
            boxes: Vec::new(),
        },
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use galera_core::{Document, Project};
    use serde_json::json;

    use super::*;

    fn fixtures_dir() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// Abre un fixture de `fixtures/` como documento del estado.
    fn state_with(fixture: &str) -> AppState {
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let json = std::fs::read_to_string(fixtures_dir().join(format!("{fixture}.json")))
            .expect("el fixture existe");
        let document = Document::from_json_str(&json).expect("es un documento");
        let state = AppState::default();
        state.open(project, document);
        state
    }

    /// El criterio de la tarea: `{ svg, diagnostics, ms }`, con el tiempo
    /// medido.
    #[test]
    fn a_page_comes_back_as_svg_with_its_diagnostics_and_time() {
        let state = state_with("informe");

        let page = render(&state, 0).expect("la página existe");
        let svg = page.svg.as_deref().expect("compila");
        assert!(svg.starts_with("<svg"), "{}", &svg[..svg.len().min(80)]);
        assert!(page.diagnostics.is_empty(), "{:?}", page.diagnostics);
        assert!(page.error.is_none());
        assert!(page.ms > 0.0, "el tiempo se mide: {}", page.ms);
        assert!(!page.reused);
        assert_eq!(page.revision, 1);
    }

    /// El criterio de la tarea: se compila una vez y de ahí salen todas las
    /// páginas, con el tiempo de aquella compilación.
    #[test]
    fn every_page_comes_from_the_same_compilation() {
        let state = state_with("multipagina");
        let count = state.summary().page_count;
        assert!(count >= 3);

        let pages: Vec<RenderedPage> = (0..count)
            .map(|index| render(&state, index).expect("la página existe"))
            .collect();

        assert!(!pages[0].reused);
        assert!(pages[1..].iter().all(|page| page.reused));
        assert!(pages.iter().all(|page| page.ms == pages[0].ms));
        assert!(pages.iter().all(|page| page.svg.is_some()));

        let distinct: std::collections::HashSet<_> =
            pages.iter().map(|page| page.svg.as_deref()).collect();
        assert_eq!(distinct.len(), count, "cada página tiene su SVG");
    }

    /// El criterio de la tarea: un error de Typst llega como datos, con sus
    /// diagnósticos atribuidos al elemento.
    #[test]
    fn a_typst_error_comes_back_as_data() {
        let state = state_with("informe");
        let mut document = Document::from_json_str(
            &std::fs::read_to_string(fixtures_dir().join("codigo.json")).expect("existe"),
        )
        .expect("es un documento");
        let Some(galera_core::Element::Code { source, .. }) =
            document.pages[0].elements.first_mut()
        else {
            panic!("codigo.json empieza con un bloque de código");
        };
        *source = "#table(".to_owned();
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        state.open(project, document);

        let page = render(&state, 0).expect("no es un error del comando");
        assert!(page.svg.is_none());
        assert!(!page.diagnostics.is_empty());
        assert!(page.diagnostics.iter().all(|d| d.element_id.is_some()));

        let json = serde_json::to_value(&page).expect("serializa");
        assert_eq!(json["svg"], json!(null));
        assert_eq!(json["error"]["kind"], "typst");
        assert_eq!(json["error"]["diagnostics"], json["diagnostics"]);
    }

    /// Un documento inválido tampoco es un error del comando.
    #[test]
    fn a_validation_error_comes_back_as_data() {
        let state = state_with("informe");
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let mut document = Document::from_json_str(
            &std::fs::read_to_string(fixtures_dir().join("informe.json")).expect("existe"),
        )
        .expect("es un documento");
        document.pages[0].id = "no vale".to_owned();
        state.open(project, document);

        let page = render(&state, 0).expect("no es un error del comando");
        let json = serde_json::to_value(&page).expect("serializa");
        assert_eq!(json["svg"], json!(null));
        assert_eq!(json["diagnostics"], json!([]));
        assert_eq!(json["error"]["kind"], "invalid");
        assert!(json["error"]["problems"].is_array());
    }

    /// El lienzo calcula el tamaño de cada página a partir del documento
    /// (`canvas/geometry.ts`). Eso solo es fiel si el SVG de Typst mide lo
    /// mismo: se comprueba con páginas de varios tamaños y unidades.
    #[test]
    fn every_svg_measures_what_its_page_says() {
        let state = state_with("multipagina");
        let json =
            std::fs::read_to_string(fixtures_dir().join("multipagina.json")).expect("existe");
        let document = Document::from_json_str(&json).expect("es un documento");

        for (index, page) in document.pages.iter().enumerate() {
            let svg = render(&state, index)
                .expect("la página existe")
                .svg
                .expect("compila");
            let view_box = svg
                .split_once("viewBox=\"")
                .and_then(|(_, rest)| rest.split_once('"'))
                .map(|(view_box, _)| view_box)
                .expect("el SVG tiene viewBox");
            let numbers: Vec<f64> = view_box
                .split_whitespace()
                .map(|number| number.parse().expect("es un número"))
                .collect();
            let [0.0, 0.0, width_pt, height_pt] = numbers[..] else {
                panic!("viewBox inesperado: {view_box}");
            };

            let mm_to_pt = 72.0 / 25.4;
            let expected_width = page.size.unit.to_millimeters(page.size.width) * mm_to_pt;
            let expected_height = page.size.unit.to_millimeters(page.size.height) * mm_to_pt;
            assert!(
                (width_pt - expected_width).abs() < 1e-3
                    && (height_pt - expected_height).abs() < 1e-3,
                "página {index}: el SVG mide {width_pt} × {height_pt} pt y el documento {expected_width} × {expected_height} pt"
            );
        }
    }

    /// El criterio de F2-02: con el SVG llegan las cajas de los elementos de
    /// esa página, y solo de esa.
    #[test]
    fn a_page_comes_with_the_boxes_of_its_elements() {
        let state = state_with("multipagina");
        let json =
            std::fs::read_to_string(fixtures_dir().join("multipagina.json")).expect("existe");
        let document = Document::from_json_str(&json).expect("es un documento");

        for (index, page) in document.pages.iter().enumerate() {
            let rendered = render(&state, index).expect("la página existe");
            let ids: Vec<&str> = rendered.boxes.iter().map(|b| b.id.as_str()).collect();
            let expected: Vec<&str> = page.elements.iter().map(|e| e.id()).collect();
            assert_eq!(ids, expected, "página {index}");
            assert!(rendered.boxes.iter().all(|b| b.page == index));
        }
    }

    #[test]
    fn a_document_that_does_not_compile_has_no_boxes() {
        let state = state_with("informe");
        let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
        let mut document = Document::from_json_str(
            &std::fs::read_to_string(fixtures_dir().join("informe.json")).expect("existe"),
        )
        .expect("es un documento");
        document.pages[0].id = "no vale".to_owned();
        state.open(project, document);
        assert!(
            render(&state, 0)
                .expect("no es un error del comando")
                .boxes
                .is_empty()
        );
    }

    #[test]
    fn without_an_open_project_the_command_fails() {
        assert!(matches!(
            render(&AppState::default(), 0),
            Err(CommandError::NothingOpen)
        ));
    }

    /// Pedir una página que no existe sí es un error del comando, y no
    /// estropea la compilación guardada.
    #[test]
    fn a_page_that_does_not_exist_fails_the_command() {
        let state = state_with("informe");
        let count = state.summary().page_count;

        assert!(matches!(
            render(&state, count),
            Err(CommandError::Core(GaleraError::PageOutOfRange { .. }))
        ));
        assert!(render(&state, 0).expect("la primera sí").reused);
    }

    /// La interfaz lee `camelCase`.
    #[test]
    fn it_serializes_in_camel_case() {
        let state = state_with("rectangulo");
        let json = serde_json::to_value(render(&state, 0).expect("existe")).expect("serializa");
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("es un objeto")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "boxes",
                "diagnostics",
                "error",
                "ms",
                "reused",
                "revision",
                "svg"
            ]
        );
    }
}
