//! Compilación: del documento al PDF y al SVG.
//!
//! Aquí se unen todas las piezas del núcleo:
//!
//! ```text
//!                                                                      ┌──► PDF
//! Document ──codegen──► código Typst ──World + typst::compile──► Compiled
//!                                                                      └──► SVG por página
//! ```
//!
//! Es uno de los tres módulos donde se permite usar Typst (principio 5 del
//! README), junto con `world` y `layout`. Hacia fuera no deja salir ningún
//! tipo de Typst: los errores salen como [`GaleraError`] con [`Diagnostic`]
//! propios, y el documento compilado queda dentro de [`Compiled`].
//!
//! # Compilar una vez, exportar varias
//!
//! [`compile`] hace el trabajo caro y devuelve un [`Compiled`]. De ahí salen
//! las exportaciones: el PDF que se entrega y el SVG que muestra el lienzo,
//! **los dos del mismo documento compilado**. Eso es lo que garantiza que lo
//! que se ve en el lienzo es lo que se exporta (principio 2): no hay dos
//! compilaciones que puedan discrepar.
//!
//! # A qué elemento pertenece cada diagnóstico
//!
//! Typst sitúa cada problema en una posición del código generado. En ese
//! código, cada elemento ocupa **una línea** que termina en su etiqueta:
//!
//! ```typst
//! #place(top + left, dx: 20mm, dy: 200mm)[#block(…, eval("#table(…)[A", …))] <el-c1>
//! ```
//!
//! Así que basta con mirar en qué línea cae el problema y leer la etiqueta
//! del final. Se toma **la última** etiqueta de la línea: un bloque de código
//! puede llevar dentro el texto `<el-r1>`, pero nunca al final de la línea,
//! que es donde el codegen pone la de verdad.
//!
//! # PDF reproducible
//!
//! El mismo documento produce siempre los mismos bytes: no se escribe fecha
//! de creación y el identificador del PDF se deriva de su contenido. Así se
//! puede cachear, comparar en pruebas y versionar sin ruido.

use std::ops::Range;

use typst::diag::{Severity as TypstSeverity, SourceDiagnostic, Warned};
use typst::foundations::Smart;
use typst::syntax::{DiagSpan, DiagSpanKind, Source};
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;
use typst_svg::SvgOptions;

use crate::codegen;
use crate::error::{Diagnostic, GaleraError, Result, Severity};
use crate::model::{Document, is_valid_id};
use crate::project::Project;
use crate::world::GaleraWorld;

/// Un documento ya compilado, listo para exportarse.
pub struct Compiled {
    document: PagedDocument,
    warnings: Vec<Diagnostic>,
    /// El código generado, para atribuir a su elemento los problemas que
    /// aparezcan al exportar, cuando el entorno de compilación ya no existe.
    source: Source,
}

impl Compiled {
    /// Número de páginas del documento compilado.
    pub fn page_count(&self) -> usize {
        self.document.pages().len()
    }

    /// Los avisos de la compilación. Una compilación con avisos produce
    /// documento, pero quizá no el que se pidió.
    pub fn warnings(&self) -> &[Diagnostic] {
        &self.warnings
    }

    /// Exporta a PDF.
    ///
    /// # Errores
    ///
    /// Falla si Typst no puede escribir el PDF, lo que en la práctica solo
    /// pasa con documentos que infringen un estándar PDF que se haya pedido.
    pub fn to_pdf(&self) -> Result<Vec<u8>> {
        let options = PdfOptions {
            creator: Smart::Custom(Some(format!("Galera {}", crate::version()))),
            // Sin fecha de creación, a propósito: ver el módulo.
            timestamp: None,
            ..PdfOptions::default()
        };

        typst_pdf::pdf(&self.document, &options)
            .map_err(|errors| GaleraError::Typst(diagnostics(&self.source, &errors)))
    }

    /// Exporta una página a SVG. Las páginas se cuentan desde 0.
    ///
    /// Es lo que muestra el lienzo. El texto no va como texto sino como el
    /// trazado de cada glifo, así que el SVG no depende de ninguna fuente
    /// instalada y se ve exactamente como el PDF.
    ///
    /// # Errores
    ///
    /// [`GaleraError::PageOutOfRange`] si la página no existe.
    pub fn to_svg(&self, page: usize) -> Result<String> {
        let pages = self.document.pages();
        let page = pages.get(page).ok_or(GaleraError::PageOutOfRange {
            page,
            count: pages.len(),
        })?;

        Ok(typst_svg::svg(page, &SvgOptions::default()))
    }
}

/// Compila un documento.
///
/// Valida el documento, genera el código Typst, prepara el entorno con las
/// fuentes y los archivos del proyecto, y compila.
///
/// # Errores
///
/// - [`GaleraError::Invalid`] si el documento no pasa la validación.
/// - [`GaleraError::Codegen`] si el documento no se puede traducir.
/// - [`GaleraError::World`] si falta una fuente o no se puede leer.
/// - [`GaleraError::Typst`] con los diagnósticos de Typst, cada uno con su
///   elemento cuando se puede saber, si la compilación falla. Nunca un
///   `panic!`.
pub fn compile(document: &Document, project: &Project) -> Result<Compiled> {
    document.validate()?;

    let source = codegen::generate(document)?;

    // Se prepara un entorno nuevo en cada compilación, fuentes incluidas.
    // Es correcto pero no rápido; reutilizarlo es F4-04.
    let world = GaleraWorld::new(project.clone(), &document.fonts, source)?;

    // Las familias solo se conocen con las fuentes ya leídas. Sin esto, una
    // familia que no está sería un aviso de Typst y el texto saldría con
    // otra fuente, sin que nadie se enterase (principio 4).
    document.validate_font_families(&world.font_families())?;

    // Se guarda el código generado para atribuir diagnósticos también
    // después, al exportar, cuando el entorno ya no existe.
    let source = world.main_source();

    let Warned { output, warnings } = typst::compile::<PagedDocument>(&world);
    let warnings = diagnostics(&source, &warnings);

    let document = output.map_err(|errors| GaleraError::Typst(diagnostics(&source, &errors)))?;

    Ok(Compiled {
        document,
        warnings,
        source,
    })
}

/// Compila un documento y lo exporta a PDF.
///
/// Es [`compile`] seguido de [`Compiled::to_pdf`]. Si además hace falta el
/// SVG o los avisos, mejor llamar a los dos por separado y compilar una vez.
///
/// # Errores
///
/// Los de [`compile`] y los de [`Compiled::to_pdf`].
pub fn compile_pdf(document: &Document, project: &Project) -> Result<Vec<u8>> {
    compile(document, project)?.to_pdf()
}

/// Compila un documento y exporta una de sus páginas a SVG.
///
/// Es [`compile`] seguido de [`Compiled::to_svg`]. Para enseñar varias
/// páginas, o el SVG y el PDF, mejor compilar una vez y exportar del mismo
/// [`Compiled`].
///
/// # Errores
///
/// Los de [`compile`] y los de [`Compiled::to_svg`].
pub fn compile_svg(document: &Document, project: &Project, page: usize) -> Result<String> {
    compile(document, project)?.to_svg(page)
}

/// Convierte los diagnósticos de Typst en los de Galera, con su elemento.
fn diagnostics(source: &Source, found: &[SourceDiagnostic]) -> Vec<Diagnostic> {
    found
        .iter()
        .map(|diagnostic| Diagnostic {
            severity: match diagnostic.severity {
                TypstSeverity::Error => Severity::Error,
                TypstSeverity::Warning => Severity::Warning,
            },
            message: diagnostic.message.to_string(),
            hints: diagnostic
                .hints
                .iter()
                .map(|hint| hint.v.to_string())
                .collect(),
            element_id: range_in(source, diagnostic.span)
                .and_then(|range| element_at(source.text(), range.start)),
        })
        .collect()
}

/// La posición de un diagnóstico dentro del código generado, si cae en él.
///
/// Es lo mismo que hace `WorldExt::range` de Typst, pero con el `Source`
/// guardado: sirve también cuando el entorno de compilación ya no existe.
fn range_in(source: &Source, span: DiagSpan) -> Option<Range<usize>> {
    match span.get() {
        DiagSpanKind::Detached => None,
        DiagSpanKind::Number { id, num, sub_range } => {
            (id == source.id()).then(|| source.range(num, sub_range))?
        }
        DiagSpanKind::Range { id, range } => (id == source.id()).then_some(range),
    }
}

/// El id del elemento cuya línea contiene la posición `at`.
///
/// Lee la última etiqueta `<el-ID>` de la línea. Devuelve `None` si la línea
/// no es la de un elemento, o si lo que parece un id no lo es.
fn element_at(code: &str, at: usize) -> Option<String> {
    let at = at.min(code.len());
    let start = code[..at].rfind('\n').map_or(0, |index| index + 1);
    let end = code[at..].find('\n').map_or(code.len(), |index| at + index);
    let line = &code[start..end];

    let label = line.rfind("<el-")? + "<el-".len();
    let id = &line[label..label + line[label..].find('>')?];

    is_valid_id(id).then(|| id.to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::TempDir;

    use super::*;
    use crate::model::{Element, TextStyle};
    use crate::world::WorldError;

    fn libertinus_regular() -> &'static [u8] {
        typst_assets::fonts()
            .next()
            .expect("typst-assets trae fuentes con la característica `fonts`")
    }

    /// Un proyecto temporal con la fuente de prueba y las imágenes de
    /// `fixtures/assets/`.
    fn project_dir() -> TempDir {
        let dir = TempDir::new().expect("carpeta temporal");
        fs::create_dir(dir.path().join("fonts")).expect("fonts/");
        fs::write(
            dir.path().join("fonts/LibertinusSerif-Regular.otf"),
            libertinus_regular(),
        )
        .expect("escribir la fuente");

        fs::create_dir(dir.path().join("assets")).expect("assets/");
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets");
        for name in ["pixel.png", "pixel.jpg", "pixel.svg"] {
            fs::copy(fixtures.join(name), dir.path().join("assets").join(name)).expect("copiar");
        }
        dir
    }

    fn open(dir: &TempDir) -> Project {
        Project::open(dir.path()).expect("el proyecto debe abrirse")
    }

    /// El ejemplo de `guide.md`, adaptado a lo que hay en el proyecto de
    /// prueba.
    ///
    /// `fixtures/informe.json` usa la fuente Inter, que el repositorio todavía
    /// no incluye. Para compilarlo se cambia la familia por Libertinus Serif
    /// y se pone una imagen de 1 px como logo. Los elementos, sus posiciones,
    /// sus estilos y el bloque de código son los del fixture, sin tocar.
    fn guide_example(dir: &TempDir) -> Document {
        let json = include_str!("../../../fixtures/informe.json");
        let mut document = Document::from_json_str(json).expect("el fixture debe deserializar");

        document.fonts = vec!["fonts/LibertinusSerif-Regular.otf".to_owned()];
        for page in &mut document.pages {
            for element in &mut page.elements {
                if let Element::Text {
                    style: TextStyle { font, .. },
                    ..
                } = element
                {
                    *font = "Libertinus Serif".to_owned();
                }
            }
        }

        fs::copy(
            dir.path().join("assets/pixel.png"),
            dir.path().join("assets/logo.png"),
        )
        .expect("poner el logo");

        document
    }

    /// El criterio de la tarea: el ejemplo compila a un PDF.
    #[test]
    fn the_guide_example_compiles_to_pdf() {
        let dir = project_dir();
        let document = guide_example(&dir);

        let compiled = compile(&document, &open(&dir))
            .unwrap_or_else(|error| panic!("el ejemplo debe compilar: {error}"));
        assert_eq!(compiled.page_count(), 1);
        assert!(
            compiled.warnings().is_empty(),
            "sin avisos: {:#?}",
            compiled.warnings()
        );

        let pdf = compiled.to_pdf().expect("debe exportarse");
        assert!(pdf.starts_with(b"%PDF-"), "tiene cabecera PDF");
        assert!(
            pdf.windows(5)
                .rev()
                .take(64)
                .any(|window| window == b"%%EOF"),
            "termina con la marca de fin de archivo"
        );
    }

    /// El criterio de la tarea: las fuentes van dentro del PDF, así que se ve
    /// igual en una máquina que no las tenga instaladas (principio 4).
    ///
    /// Se busca en los bytes: Typst 0.15.1 no comprime los diccionarios de
    /// objetos, así que el de la fuente se puede leer. Si una versión futura
    /// los comprime, esta prueba fallará y habrá que leer el PDF de verdad.
    #[test]
    fn the_fonts_are_embedded_in_the_pdf() {
        let dir = project_dir();
        let pdf = compile_pdf(&guide_example(&dir), &open(&dir)).expect("debe compilar");

        let contains = |needle: &[u8]| pdf.windows(needle.len()).any(|window| window == needle);
        assert!(
            contains(b"/FontFile"),
            "el PDF debe llevar el archivo de la fuente dentro"
        );
        assert!(
            contains(b"LibertinusSerif"),
            "y debe ser la fuente del documento"
        );
    }

    #[test]
    fn compile_pdf_is_compile_then_export() {
        let dir = project_dir();
        let document = guide_example(&dir);
        let project = open(&dir);

        let direct = compile_pdf(&document, &project).expect("debe compilar");
        let in_two_steps = compile(&document, &project)
            .expect("debe compilar")
            .to_pdf()
            .expect("debe exportarse");

        assert_eq!(direct, in_two_steps);
    }

    /// Mismo documento, mismos bytes: nada de fechas de creación.
    #[test]
    fn the_same_document_always_produces_the_same_pdf() {
        let dir = project_dir();
        let document = guide_example(&dir);
        let project = open(&dir);

        let first = compile_pdf(&document, &project).expect("debe compilar");
        let second = compile_pdf(&document, &project).expect("debe compilar");
        assert_eq!(first, second);
    }

    /// El criterio de la tarea: los errores de Typst salen como diagnósticos,
    /// no como `panic!`.
    #[test]
    fn a_typst_error_comes_back_as_diagnostics() {
        let dir = project_dir();
        let document = Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Roto" },
              "pages": [{
                "id": "p1",
                "size": { "width": 210, "height": 297, "unit": "mm" },
                "elements": [
                  { "id": "c1", "type": "code", "x": 0, "y": 0, "w": 50, "h": null,
                    "source": "#table(columns: 2)[A" }
                ]
              }]
            }"##,
        )
        .expect("debe deserializar");

        match compile_pdf(&document, &open(&dir)) {
            Err(GaleraError::Typst(diagnostics)) => {
                assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
                assert_eq!(diagnostics[0].severity, Severity::Error);
                assert!(!diagnostics[0].message.is_empty());
            }
            Err(other) => panic!("se esperaban diagnósticos de Typst: {other}"),
            Ok(_) => panic!("un bloque de código roto no puede compilar"),
        }
    }

    #[test]
    fn a_missing_font_is_a_world_error() {
        let dir = project_dir();
        let mut document = guide_example(&dir);
        document.fonts = vec!["fonts/Inter-Regular.ttf".to_owned()];

        assert!(matches!(
            compile_pdf(&document, &open(&dir)),
            Err(GaleraError::World(WorldError::FontNotFound { .. }))
        ));
    }

    /// Un recurso que no existe se detecta al validar, antes de generar
    /// código, y el error nombra el elemento.
    #[test]
    fn an_invalid_document_is_rejected_before_compiling() {
        let dir = project_dir();
        let mut document = guide_example(&dir);
        document.assets.clear();

        match compile_pdf(&document, &open(&dir)) {
            Err(GaleraError::Invalid(errors)) => {
                assert_eq!(errors.len(), 1, "{errors}");
                assert!(errors.to_string().contains("\"i1\""), "{errors}");
            }
            Err(other) => panic!("se esperaba Invalid: {other}"),
            Ok(_) => panic!("un recurso inexistente no puede compilar"),
        }
    }

    // ── Atribución de diagnósticos a elementos ─────────────────────────

    /// Un documento con un rectángulo delante y detrás del elemento dado.
    fn around(element: &str) -> Document {
        Document::from_json_str(&format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Atribución" }},
              "assets": {{ "portada": "assets/portada.png" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [
                  {{ "id": "antes", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                     "fill": "#000000", "stroke": null }},
                  {element},
                  {{ "id": "despues", "type": "rect", "x": 0, "y": 50, "w": 10, "h": 10,
                     "fill": "#000000", "stroke": null }}
                ]
              }}]
            }}"##
        ))
        .expect("debe deserializar")
    }

    fn typst_errors(result: Result<Compiled>) -> Vec<Diagnostic> {
        match result {
            Err(GaleraError::Typst(diagnostics)) => diagnostics,
            Err(other) => panic!("se esperaban diagnósticos de Typst: {other}"),
            Ok(_) => panic!("debería fallar al compilar"),
        }
    }

    /// El criterio de la tarea: un error en un bloque de código se atribuye
    /// a su elemento.
    #[test]
    fn a_code_block_error_is_attributed_to_its_element() {
        let dir = project_dir();
        let diagnostics = typst_errors(compile(
            &around(
                r##"{ "id": "tabla", "type": "code", "x": 0, "y": 20, "w": 50, "h": null,
                     "source": "#table(columns: 2)[A" }"##,
            ),
            &open(&dir),
        ));

        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].element_id.as_deref(), Some("tabla"));
    }

    /// Un bloque que escribe la etiqueta de otro elemento dentro de su código
    /// no confunde la atribución: cuenta la etiqueta del final de la línea.
    #[test]
    fn a_label_written_inside_code_does_not_steal_the_error() {
        let dir = project_dir();
        let diagnostics = typst_errors(compile(
            &around(
                r##"{ "id": "tabla", "type": "code", "x": 0, "y": 20, "w": 50, "h": null,
                     "source": "<el-antes> #table(columns: 2)[A" }"##,
            ),
            &open(&dir),
        ));

        assert_eq!(diagnostics[0].element_id.as_deref(), Some("tabla"));
    }

    #[test]
    fn a_missing_image_file_is_attributed_to_its_image() {
        let dir = project_dir();
        let diagnostics = typst_errors(compile(
            &around(
                r##"{ "id": "foto", "type": "image", "x": 0, "y": 20, "w": 50, "h": null,
                     "asset": "portada" }"##,
            ),
            &open(&dir),
        ));

        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].element_id.as_deref(), Some("foto"));
    }

    #[test]
    fn a_warning_is_attributed_to_its_element() {
        let dir = project_dir();
        let compiled = compile(
            &around(
                r##"{ "id": "nota", "type": "code", "x": 0, "y": 20, "w": 50, "h": null,
                     "source": "#text(font: \"Desconocida\")[x]" }"##,
            ),
            &open(&dir),
        )
        .expect("compila, con avisos");

        assert_eq!(compiled.warnings().len(), 1, "{:#?}", compiled.warnings());
        assert_eq!(compiled.warnings()[0].element_id.as_deref(), Some("nota"));
    }

    #[test]
    fn element_at_reads_the_label_at_the_end_of_the_line() {
        let code = "// cabecera\n#place(…)[#rect()] <el-r1>\n#place(…)[#block(eval(\"<el-r1>\"))] <el-c1>\n";

        let line_of = |needle: &str| code.find(needle).expect("está en el código");
        assert_eq!(element_at(code, line_of("#rect")).as_deref(), Some("r1"));
        assert_eq!(element_at(code, line_of("eval")).as_deref(), Some("c1"));
        assert_eq!(element_at(code, line_of("cabecera")), None);
        assert_eq!(element_at(code, code.len()), None);
    }

    #[test]
    fn element_at_ignores_something_that_is_not_an_id() {
        assert_eq!(element_at("#place()[] <el-a b>", 0), None);
        assert_eq!(element_at("#place()[] <el-sin-cerrar", 0), None);
    }

    /// Una familia que ninguna fuente cargada proporciona es un error, no el
    /// aviso de Typst que dejaría el texto con otra fuente (principio 4).
    #[test]
    fn an_unknown_font_family_in_a_style_is_an_error() {
        let dir = project_dir();
        let mut document = guide_example(&dir);
        for page in &mut document.pages {
            for element in &mut page.elements {
                if let Element::Text {
                    style: TextStyle { font, .. },
                    ..
                } = element
                {
                    *font = "Inter".to_owned();
                }
            }
        }

        match compile(&document, &open(&dir)) {
            Err(GaleraError::Invalid(errors)) => {
                let message = errors.to_string();
                assert!(message.contains("\"Inter\""), "{message}");
                assert!(message.contains("\"t1\""), "{message}");
            }
            Err(other) => panic!("se esperaba Invalid: {other}"),
            Ok(_) => panic!("una familia que no está no puede compilar"),
        }
    }

    /// Los avisos de Typst siguen llegando a quien llama. Una fuente
    /// desconocida dentro de un bloque de código no la ve la validación
    /// —el código es opaco—, así que sigue siendo un aviso.
    #[test]
    fn typst_warnings_reach_the_caller() {
        let dir = project_dir();
        let mut document = guide_example(&dir);
        for page in &mut document.pages {
            for element in &mut page.elements {
                if let Element::Code { source, .. } = element {
                    *source = "#text(font: \"Desconocida\")[x]".to_owned();
                }
            }
        }

        let compiled = compile(&document, &open(&dir)).expect("compila, con avisos");
        assert!(
            compiled
                .warnings()
                .iter()
                .any(|warning| warning.severity == Severity::Warning
                    && warning.message.to_lowercase().contains("desconocida")),
            "{:#?}",
            compiled.warnings()
        );
    }

    // ── SVG ─────────────────────────────────────────────────────────────

    /// Un documento de dos páginas de tamaños distintos: en la primera, un
    /// rectángulo y un texto; en la segunda, nada.
    fn box_and_text() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Caja" },
              "fonts": ["fonts/LibertinusSerif-Regular.otf"],
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" },
                  "elements": [
                    { "id": "r1", "type": "rect", "x": 20, "y": 30, "w": 100, "h": 50,
                      "fill": "#1e40af", "stroke": null },
                    { "id": "t1", "type": "text", "x": 20, "y": 100, "w": 100, "h": null,
                      "content": [{ "text": "Hola" }],
                      "style": { "font": "Libertinus Serif", "size": 12, "color": "#000000" } }
                  ] },
                { "id": "p2", "size": { "width": 148, "height": 210, "unit": "mm" } }
              ]
            }"##,
        )
        .expect("debe deserializar")
    }

    /// Puntos tipográficos por milímetro.
    const PT_PER_MM: f64 = 72.0 / 25.4;

    /// Una caja en puntos, con el origen arriba a la izquierda.
    #[derive(Debug)]
    struct PtBox {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }

    impl PtBox {
        fn assert_close_to(&self, other: &PtBox, what: &str) {
            // Una centésima de punto: el PDF redondea a seis decimales y el
            // SVG a nueve, y eso ya es menos de 0,004 mm.
            const TOLERANCE: f64 = 0.01;
            for (name, a, b) in [
                ("x", self.x, other.x),
                ("y", self.y, other.y),
                ("ancho", self.w, other.w),
                ("alto", self.h, other.h),
            ] {
                assert!(
                    (a - b).abs() < TOLERANCE,
                    "{what}: {name} difiere ({a} frente a {b}): {self:?} / {other:?}"
                );
            }
        }
    }

    /// Lee del SVG la caja del trazado relleno con `fill`.
    ///
    /// Typst escribe un rectángulo como
    /// `<path fill="#…" transform="translate(X Y)" d="M 0 0v H h W v -H Z "/>`.
    fn svg_box(svg: &str, fill: &str) -> PtBox {
        let start = svg
            .find(&format!(r##"<path fill="{fill}""##))
            .unwrap_or_else(|| panic!("el SVG debe tener un trazado relleno de {fill}"));
        let tag = &svg[start..start + svg[start..].find("/>").expect("etiqueta cerrada")];

        let attribute = |name: &str| -> &str {
            let open = format!(r##"{name}=""##);
            let from = tag.find(&open).expect("atributo presente") + open.len();
            &tag[from..from + tag[from..].find('"').expect("atributo cerrado")]
        };

        let translate = attribute("transform")
            .trim_start_matches("translate(")
            .trim_end_matches(')');
        let mut xy = translate
            .split_whitespace()
            .map(|n| n.parse::<f64>().expect("número"));
        let (x, y) = (xy.next().expect("x"), xy.next().expect("y"));

        let path = attribute("d");
        let number_after = |marker: &str| -> f64 {
            let from = path.find(marker).expect("comando presente") + marker.len();
            path[from..]
                .split(|c: char| c != '.' && c != '-' && !c.is_ascii_digit())
                .next()
                .expect("número")
                .parse()
                .expect("número válido")
        };

        PtBox {
            x,
            y,
            h: number_after("v "),
            w: number_after("h "),
        }
    }

    /// Lee del PDF la caja del primer trazado relleno que no es texto.
    ///
    /// Typst escribe un rectángulo como
    /// `q 1 0 0 -1 X Y' cm … 0 0 m W 0 l W H l 0 H l h f Q`,
    /// con el eje y hacia arriba desde el pie de la página, así que la y de
    /// arriba es la altura de la página menos `Y'`.
    fn pdf_box(pdf: &[u8]) -> PtBox {
        let page_height = pdf_page_height(pdf);

        for content in pdf_streams(pdf) {
            for block in content.split("\nQ") {
                let Some(q) = block.find("q 1 0 0 -1 ") else {
                    continue;
                };
                let block = &block[q..];
                if block.contains("BT") || !block.contains("\nf") {
                    continue;
                }

                let numbers: Vec<f64> = block["q 1 0 0 -1 ".len()..]
                    .split_whitespace()
                    .take(2)
                    .map(|n| n.parse().expect("número"))
                    .collect();

                let path = &block[block.find(" m ").expect("trazado") + 3..];
                let points: Vec<f64> = path
                    .split_whitespace()
                    .filter_map(|token| token.parse::<f64>().ok())
                    .collect();
                let w = points.iter().step_by(2).cloned().fold(0.0, f64::max);
                let h = points
                    .iter()
                    .skip(1)
                    .step_by(2)
                    .cloned()
                    .fold(0.0, f64::max);

                return PtBox {
                    x: numbers[0],
                    y: page_height - numbers[1],
                    w,
                    h,
                };
            }
        }

        panic!("el PDF debe tener un trazado relleno");
    }

    /// Los flujos del PDF que se pueden descomprimir, como texto.
    fn pdf_streams(pdf: &[u8]) -> Vec<String> {
        let mut streams = Vec::new();
        let mut rest = pdf;
        while let Some(start) = find(rest, b"stream\n") {
            let body = &rest[start + b"stream\n".len()..];
            let Some(end) = find(body, b"endstream") else {
                break;
            };
            // Entre los datos y `endstream` va un salto de línea que no es
            // parte del flujo comprimido.
            let data = body[..end]
                .strip_suffix(b"\n")
                .map(|data| data.strip_suffix(b"\r").unwrap_or(data))
                .unwrap_or(&body[..end]);
            if let Ok(inflated) = miniz_oxide::inflate::decompress_to_vec_zlib(data) {
                streams.push(String::from_utf8_lossy(&inflated).into_owned());
            }
            // Saltar `endstream` entero: si no, su propio `stream\n` se
            // tomaría por el principio del siguiente flujo.
            rest = &body[end + b"endstream".len()..];
        }
        streams
    }

    /// La altura de la primera página, de su `/MediaBox`.
    fn pdf_page_height(pdf: &[u8]) -> f64 {
        let start = find(pdf, b"/MediaBox[").expect("el PDF tiene MediaBox") + b"/MediaBox[".len();
        let end = start + find(&pdf[start..], b"]").expect("MediaBox cerrado");
        std::str::from_utf8(&pdf[start..end])
            .expect("MediaBox en ASCII")
            .split_whitespace()
            .nth(3)
            .expect("cuatro números")
            .parse()
            .expect("número")
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    /// El criterio central de la tarea: el mismo elemento mide lo mismo en el
    /// SVG que ve el lienzo y en el PDF que se exporta. Y lo que dice el modelo.
    #[test]
    fn an_element_has_the_same_box_in_svg_and_pdf() {
        let dir = project_dir();
        let compiled = compile(&box_and_text(), &open(&dir)).expect("debe compilar");

        let svg = svg_box(&compiled.to_svg(0).expect("svg"), "#1e40af");
        let pdf = pdf_box(&compiled.to_pdf().expect("pdf"));
        let model = PtBox {
            x: 20.0 * PT_PER_MM,
            y: 30.0 * PT_PER_MM,
            w: 100.0 * PT_PER_MM,
            h: 50.0 * PT_PER_MM,
        };

        svg.assert_close_to(&pdf, "SVG frente a PDF");
        svg.assert_close_to(&model, "SVG frente al modelo");
        pdf.assert_close_to(&model, "PDF frente al modelo");
    }

    /// El criterio de la tarea: el texto va como trazados de glifos, así que
    /// el SVG no depende de ninguna fuente instalada en quien lo muestra.
    #[test]
    fn svg_text_is_drawn_as_glyph_outlines() {
        let dir = project_dir();
        let svg = compile_svg(&box_and_text(), &open(&dir), 0).expect("debe exportarse");

        assert!(!svg.contains("<text"), "el texto no puede ir como <text>");
        assert!(!svg.contains("font-family"), "ni nombrar una fuente");
        assert!(
            svg.contains("<symbol"),
            "los glifos van definidos como símbolos"
        );
        assert!(
            svg.contains(r##"xlink:href="#g"##),
            "y se usan desde el texto"
        );
    }

    /// El criterio de la tarea: el SVG y el PDF salen de la misma compilación.
    #[test]
    fn svg_and_pdf_come_from_one_compilation() {
        let dir = project_dir();
        let compiled = compile(&box_and_text(), &open(&dir)).expect("debe compilar");

        let pdf = compiled.to_pdf().expect("pdf");
        let svgs: Vec<String> = (0..compiled.page_count())
            .map(|page| compiled.to_svg(page).expect("svg"))
            .collect();

        assert_eq!(svgs.len(), 2);
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(
            compile_pdf(&box_and_text(), &open(&dir)).expect("pdf"),
            pdf,
            "exportar de un Compiled da lo mismo que compilar y exportar de golpe"
        );
    }

    #[test]
    fn each_page_keeps_its_own_size_in_svg() {
        let dir = project_dir();
        let compiled = compile(&box_and_text(), &open(&dir)).expect("debe compilar");

        let width = |page: usize| -> f64 {
            let svg = compiled.to_svg(page).expect("svg");
            let from = svg.find(r##"width=""##).expect("ancho") + r#"width=""#.len();
            svg[from..from + svg[from..].find("pt").expect("en puntos")]
                .parse()
                .expect("número")
        };

        assert!((width(0) - 210.0 * PT_PER_MM).abs() < 0.01);
        assert!((width(1) - 148.0 * PT_PER_MM).abs() < 0.01);
    }

    #[test]
    fn a_page_that_does_not_exist_is_an_error() {
        let dir = project_dir();
        let compiled = compile(&box_and_text(), &open(&dir)).expect("debe compilar");

        match compiled.to_svg(2) {
            Err(GaleraError::PageOutOfRange { page: 2, count: 2 }) => {}
            other => panic!(
                "se esperaba PageOutOfRange: {:?}",
                other.map(|svg| svg.len())
            ),
        }
    }

    #[test]
    fn the_same_page_always_produces_the_same_svg() {
        let dir = project_dir();
        let project = open(&dir);
        assert_eq!(
            compile_svg(&box_and_text(), &project, 0).expect("svg"),
            compile_svg(&box_and_text(), &project, 0).expect("svg"),
        );
    }
}
