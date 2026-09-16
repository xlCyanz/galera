//! Compilación: del documento al PDF.
//!
//! Aquí se unen todas las piezas del núcleo:
//!
//! ```text
//! Document ──codegen──► código Typst ──World + typst::compile──► Compiled ──► PDF
//! ```
//!
//! Es uno de los tres módulos donde se permite usar Typst (principio 5 del
//! README), junto con `world` y `layout`. Hacia fuera no deja salir ningún
//! tipo de Typst: los errores salen como [`Diagnostic`] propios y el
//! documento compilado queda dentro de [`Compiled`].
//!
//! # Compilar una vez, exportar varias
//!
//! [`compile`] hace el trabajo caro y devuelve un [`Compiled`]. De ahí salen
//! las exportaciones. Hoy solo PDF; en F0-13 el SVG, **del mismo documento
//! compilado**, que es lo que garantiza que lo que se ve en el lienzo es lo
//! que se exporta (principio 2).
//!
//! # PDF reproducible
//!
//! El mismo documento produce siempre los mismos bytes: no se escribe fecha
//! de creación y el identificador del PDF se deriva de su contenido. Así se
//! puede cachear, comparar en pruebas y versionar sin ruido.

use std::fmt;

use typst::diag::{Severity as TypstSeverity, SourceDiagnostic, Warned};
use typst::foundations::Smart;
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;

use crate::codegen::{self, CodegenError};
use crate::model::Document;
use crate::project::Project;
use crate::world::{GaleraWorld, WorldError};

/// Gravedad de un diagnóstico de Typst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Impide producir el documento.
    Error,
    /// El documento se produce, pero algo no está como se pidió; por ejemplo,
    /// una fuente que no existe y se sustituye.
    Warning,
}

/// Un mensaje de Typst sobre el documento.
///
/// En F0-16 gana el id del elemento al que se refiere, para que la interfaz
/// pueda señalarlo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// Si es un error o un aviso.
    pub severity: Severity,
    /// El mensaje, tal como lo da Typst.
    pub message: String,
    /// Sugerencias de Typst para arreglarlo, si las hay.
    pub hints: Vec<String>,
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "aviso",
        };
        write!(f, "{kind}: {}", self.message)?;
        for hint in &self.hints {
            write!(f, "\n  sugerencia: {hint}")?;
        }
        Ok(())
    }
}

impl From<&SourceDiagnostic> for Diagnostic {
    fn from(diagnostic: &SourceDiagnostic) -> Self {
        Self {
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
        }
    }
}

/// Algo impidió compilar o exportar el documento.
///
/// En F0-16 este enum se absorbe dentro del error único del núcleo.
#[derive(Debug)]
pub enum CompileError {
    /// El documento no se pudo traducir a Typst.
    Codegen(CodegenError),
    /// El entorno de compilación no se pudo preparar: una fuente que falta,
    /// por ejemplo.
    World(WorldError),
    /// Typst encontró errores al compilar o al exportar.
    Typst(Vec<Diagnostic>),
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompileError::Codegen(error) => write!(f, "{error}"),
            CompileError::World(error) => write!(f, "{error}"),
            CompileError::Typst(diagnostics) => {
                let count = diagnostics.len();
                write!(
                    f,
                    "Typst encontró {count} {}",
                    if count == 1 { "error" } else { "errores" }
                )?;
                for diagnostic in diagnostics {
                    write!(f, "\n{diagnostic}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for CompileError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            CompileError::Codegen(error) => Some(error),
            CompileError::World(error) => Some(error),
            CompileError::Typst(_) => None,
        }
    }
}

impl From<CodegenError> for CompileError {
    fn from(error: CodegenError) -> Self {
        CompileError::Codegen(error)
    }
}

impl From<WorldError> for CompileError {
    fn from(error: WorldError) -> Self {
        CompileError::World(error)
    }
}

/// Un documento ya compilado, listo para exportarse.
pub struct Compiled {
    document: PagedDocument,
    warnings: Vec<Diagnostic>,
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
    pub fn to_pdf(&self) -> Result<Vec<u8>, CompileError> {
        let options = PdfOptions {
            creator: Smart::Custom(Some(format!("Galera {}", crate::version()))),
            // Sin fecha de creación, a propósito: ver el módulo.
            timestamp: None,
            ..PdfOptions::default()
        };

        typst_pdf::pdf(&self.document, &options)
            .map_err(|errors| CompileError::Typst(errors.iter().map(Diagnostic::from).collect()))
    }
}

/// Compila un documento.
///
/// Genera el código Typst, prepara el entorno con las fuentes y los archivos
/// del proyecto, y compila.
///
/// # Errores
///
/// - [`CompileError::Codegen`] si el documento no se puede traducir.
/// - [`CompileError::World`] si falta una fuente o no se puede leer.
/// - [`CompileError::Typst`] con los diagnósticos de Typst si la compilación
///   falla. Nunca un `panic!`.
pub fn compile(document: &Document, project: &Project) -> Result<Compiled, CompileError> {
    let source = codegen::generate(document)?;

    // Se prepara un entorno nuevo en cada compilación, fuentes incluidas.
    // Es correcto pero no rápido; reutilizarlo es F4-04.
    let world = GaleraWorld::new(project.clone(), &document.fonts, source)?;

    let Warned { output, warnings } = typst::compile::<PagedDocument>(&world);
    let warnings = warnings.iter().map(Diagnostic::from).collect();

    let document = output
        .map_err(|errors| CompileError::Typst(errors.iter().map(Diagnostic::from).collect()))?;

    Ok(Compiled { document, warnings })
}

/// Compila un documento y lo exporta a PDF.
///
/// Es [`compile`] seguido de [`Compiled::to_pdf`]. Si además hace falta el
/// SVG o los avisos, mejor llamar a los dos por separado y compilar una vez.
///
/// # Errores
///
/// Los de [`compile`] y los de [`Compiled::to_pdf`].
pub fn compile_pdf(document: &Document, project: &Project) -> Result<Vec<u8>, CompileError> {
    compile(document, project)?.to_pdf()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::TempDir;

    use super::*;
    use crate::model::{Element, TextStyle};

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
            Err(CompileError::Typst(diagnostics)) => {
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
            Err(CompileError::World(WorldError::FontNotFound { .. }))
        ));
    }

    #[test]
    fn a_codegen_error_is_a_codegen_error() {
        let dir = project_dir();
        let mut document = guide_example(&dir);
        document.assets.clear();

        assert!(matches!(
            compile_pdf(&document, &open(&dir)),
            Err(CompileError::Codegen(CodegenError::UnknownAsset { .. }))
        ));
    }

    /// Una fuente que el documento pide pero no declara no es un error para
    /// Typst sino un aviso, y el texto sale con otra fuente. Tiene que llegar
    /// a quien llama: es justo el tipo de cambio silencioso que el principio 4
    /// quiere evitar.
    #[test]
    fn an_unknown_font_family_is_reported_as_a_warning() {
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

        let compiled = compile(&document, &open(&dir)).expect("compila, con avisos");
        assert!(
            compiled
                .warnings()
                .iter()
                .any(|warning| warning.severity == Severity::Warning
                    && warning.message.to_lowercase().contains("inter")),
            "debe avisar de la familia desconocida: {:#?}",
            compiled.warnings()
        );
    }

    #[test]
    fn a_diagnostic_reads_well() {
        let diagnostic = Diagnostic {
            severity: Severity::Error,
            message: "unclosed delimiter".to_owned(),
            hints: vec!["cierra el corchete".to_owned()],
        };
        assert_eq!(
            diagnostic.to_string(),
            "error: unclosed delimiter\n  sugerencia: cierra el corchete"
        );
    }
}
