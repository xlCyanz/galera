//! El error único del núcleo y los diagnósticos de Typst.
//!
//! Todo lo que puede fallar en `galera-core` acaba como un [`GaleraError`]:
//! abrir la carpeta del proyecto, validar el documento, generar código,
//! cargar fuentes, compilar y exportar. Quien usa el núcleo —la CLI hoy, la
//! app mañana— maneja un solo tipo.
//!
//! Cada módulo conserva su propio error, que es más preciso
//! ([`ProjectError`], [`OpenError`], [`ValidationErrors`], [`CodegenError`],
//! [`OpError`], [`WorldError`]), y `GaleraError` los envuelve. Con `?` la conversión es
//! automática.
//!
//! # Hacia el webview
//!
//! `GaleraError` y [`Diagnostic`] son serializables con serde. La forma es
//! estable y pensada para que la interfaz la pinte sin interpretar textos:
//!
//! ```json
//! {
//!   "kind": "typst",
//!   "message": "Typst encontró 1 error\nerror en el elemento \"c1\": unclosed delimiter",
//!   "diagnostics": [
//!     { "severity": "error", "message": "unclosed delimiter", "hints": [], "element_id": "c1" }
//!   ]
//! }
//! ```
//!
//! `kind` dice qué pasó; `message` es el texto listo para enseñar;
//! `problems` (si es de validación) y `diagnostics` (si es de Typst) llevan el
//! detalle por elemento, para que la interfaz pueda señalarlo en el lienzo.
//!
//! # Nota de Rust
//!
//! `thiserror` genera con `#[derive(Error)]` lo repetitivo de un tipo de
//! error: `Display` a partir de `#[error("...")]` y `From` a partir de
//! `#[from]`, que es lo que permite escribir `?` sobre un error de otro tipo.

use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use thiserror::Error;

use crate::codegen::CodegenError;
use crate::model::ValidationErrors;
use crate::open::OpenError;
use crate::ops::OpError;
use crate::project::ProjectError;
use crate::world::WorldError;

/// Todo lo que puede fallar en el núcleo.
#[derive(Debug, Error)]
pub enum GaleraError {
    /// La carpeta del proyecto no se puede abrir.
    #[error(transparent)]
    Project(#[from] ProjectError),

    /// El proyecto no se puede abrir: falta `document.json`, no es un
    /// documento o una imagen no está.
    #[error(transparent)]
    Open(#[from] OpenError),

    /// El documento no es válido. Se detecta antes de compilar.
    #[error(transparent)]
    Invalid(#[from] ValidationErrors),

    /// El documento no se pudo traducir a Typst.
    #[error(transparent)]
    Codegen(#[from] CodegenError),

    /// Un comando de edición no se puede aplicar: un id que no existe, una
    /// propiedad que el elemento no tiene.
    #[error(transparent)]
    Op(#[from] OpError),

    /// El entorno de compilación no se pudo preparar: una fuente que falta,
    /// por ejemplo.
    #[error(transparent)]
    World(#[from] WorldError),

    /// Typst encontró errores al compilar o al exportar.
    #[error("{}", DiagnosticList(.0))]
    Typst(Vec<Diagnostic>),

    /// Se pidió una página que el documento no tiene.
    #[error("no existe la página {page}: el documento tiene {count} (se cuentan desde 0)")]
    PageOutOfRange {
        /// La página pedida, empezando en 0.
        page: usize,
        /// Cuántas páginas tiene el documento.
        count: usize,
    },
}

/// Un resultado del núcleo.
pub type Result<T, E = GaleraError> = std::result::Result<T, E>;

impl GaleraError {
    /// Qué clase de error es, como una palabra estable que la interfaz puede
    /// usar para decidir cómo enseñarlo.
    pub fn kind(&self) -> &'static str {
        match self {
            GaleraError::Project(_) => "project",
            GaleraError::Open(_) => "open",
            GaleraError::Invalid(_) => "invalid",
            GaleraError::Codegen(_) => "codegen",
            GaleraError::Op(_) => "op",
            GaleraError::World(_) => "world",
            GaleraError::Typst(_) => "typst",
            GaleraError::PageOutOfRange { .. } => "page_out_of_range",
        }
    }
}

impl Serialize for GaleraError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut error = serializer.serialize_struct("GaleraError", 4)?;
        error.serialize_field("kind", self.kind())?;
        error.serialize_field("message", &self.to_string())?;

        match self {
            GaleraError::Invalid(errors) => error.serialize_field("problems", &errors.0)?,
            _ => error.skip_field("problems")?,
        }
        match self {
            GaleraError::Typst(diagnostics) => error.serialize_field("diagnostics", diagnostics)?,
            _ => error.skip_field("diagnostics")?,
        }

        error.end()
    }
}

/// Gravedad de un diagnóstico de Typst.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "diagnostic.ts"))]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Impide producir el documento.
    Error,
    /// El documento se produce, pero algo no está como se pidió.
    Warning,
}

/// Un mensaje de Typst sobre el documento.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "diagnostic.ts"))]
pub struct Diagnostic {
    /// Si es un error o un aviso.
    pub severity: Severity,
    /// El mensaje, tal como lo da Typst.
    pub message: String,
    /// Sugerencias de Typst para arreglarlo, si las hay.
    pub hints: Vec<String>,
    /// El elemento del documento en el que ocurre, si se puede saber.
    ///
    /// Se deduce de la línea del código generado en la que Typst sitúa el
    /// problema: cada elemento ocupa una línea que acaba en su etiqueta
    /// `<el-ID>`. Un problema que no cae en la línea de ningún elemento
    /// —en la cabecera, o sin posición— no tiene elemento.
    pub element_id: Option<String>,
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "aviso",
        };
        match &self.element_id {
            Some(id) => write!(f, "{kind} en el elemento {id:?}: {}", self.message)?,
            None => write!(f, "{kind}: {}", self.message)?,
        }
        for hint in &self.hints {
            write!(f, "\n  sugerencia: {hint}")?;
        }
        Ok(())
    }
}

/// Una lista de diagnósticos con su cabecera, para `Display`.
struct DiagnosticList<'a>(&'a [Diagnostic]);

impl fmt::Display for DiagnosticList<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self.0.len();
        write!(
            f,
            "Typst encontró {count} {}",
            if count == 1 { "error" } else { "errores" }
        )?;
        for diagnostic in self.0 {
            write!(f, "\n{diagnostic}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;
    use crate::model::{Location, Problem, ValidationError};

    fn typst_error() -> GaleraError {
        GaleraError::Typst(vec![Diagnostic {
            severity: Severity::Error,
            message: "unclosed delimiter".to_owned(),
            hints: vec![],
            element_id: Some("c1".to_owned()),
        }])
    }

    fn invalid_error() -> GaleraError {
        GaleraError::Invalid(ValidationErrors(vec![ValidationError {
            location: Location::Element {
                id: "r1".to_owned(),
            },
            problem: Problem::NotPositive {
                field: "w",
                value: -3.0,
            },
        }]))
    }

    #[test]
    fn it_reads_in_spanish() {
        assert_eq!(
            typst_error().to_string(),
            "Typst encontró 1 error\nerror en el elemento \"c1\": unclosed delimiter"
        );
        assert_eq!(
            invalid_error().to_string(),
            "el documento tiene 1 problema\n  - elemento \"r1\": w tiene que ser mayor que cero, y es -3"
        );
        assert_eq!(
            GaleraError::PageOutOfRange { page: 4, count: 2 }.to_string(),
            "no existe la página 4: el documento tiene 2 (se cuentan desde 0)"
        );
    }

    /// `#[from]` permite usar `?` sobre el error de cada módulo.
    #[test]
    fn module_errors_convert_with_question_mark() {
        fn fails() -> Result<()> {
            Err(CodegenError::UnsafePageId {
                id: "x y".to_owned(),
            })?
        }
        assert!(matches!(fails(), Err(GaleraError::Codegen(_))));
    }

    /// Un error envuelto es transparente: el mensaje es el del error del
    /// módulo, y la causa, la de ese error. Nada se pierde por el camino.
    #[test]
    fn a_wrapped_error_is_transparent() {
        let error = GaleraError::from(ProjectError::NotFound {
            root: PathBuf::from("/no/existe"),
            source: std::io::Error::from(std::io::ErrorKind::NotFound),
        });

        assert_eq!(
            error.to_string(),
            "no se puede abrir la carpeta del proyecto /no/existe"
        );
        let source = std::error::Error::source(&error).expect("tiene causa");
        assert!(
            source.downcast_ref::<std::io::Error>().is_some(),
            "la causa es el error del sistema de archivos: {source:?}"
        );
    }

    /// El criterio de la tarea: serializable con serde, listo para cruzar al
    /// webview.
    #[test]
    fn a_typst_error_serializes_with_its_diagnostics() {
        assert_eq!(
            serde_json::to_value(typst_error()).expect("serializa"),
            json!({
                "kind": "typst",
                "message": "Typst encontró 1 error\nerror en el elemento \"c1\": unclosed delimiter",
                "diagnostics": [{
                    "severity": "error",
                    "message": "unclosed delimiter",
                    "hints": [],
                    "element_id": "c1"
                }]
            })
        );
    }

    #[test]
    fn a_validation_error_serializes_with_its_problems() {
        assert_eq!(
            serde_json::to_value(invalid_error()).expect("serializa"),
            json!({
                "kind": "invalid",
                "message": "el documento tiene 1 problema\n  - elemento \"r1\": w tiene que ser mayor que cero, y es -3",
                "problems": [{
                    "location": { "kind": "element", "id": "r1" },
                    "problem": { "kind": "not_positive", "field": "w", "value": -3.0 },
                    "message": "w tiene que ser mayor que cero, y es -3"
                }]
            })
        );
    }

    /// Los errores que no traen detalle salen solo con clase y mensaje.
    #[test]
    fn other_errors_serialize_with_kind_and_message() {
        let error = GaleraError::from(WorldError::FontNotFound {
            path: "fonts/Inter-Regular.ttf".to_owned(),
        });
        assert_eq!(
            serde_json::to_value(error).expect("serializa"),
            json!({
                "kind": "world",
                "message": "el documento declara la fuente \"fonts/Inter-Regular.ttf\", pero no está en la carpeta del proyecto"
            })
        );
    }

    #[test]
    fn a_diagnostic_without_element_reads_without_it() {
        let diagnostic = Diagnostic {
            severity: Severity::Warning,
            message: "algo".to_owned(),
            hints: vec!["prueba otra cosa".to_owned()],
            element_id: None,
        };
        assert_eq!(
            diagnostic.to_string(),
            "aviso: algo\n  sugerencia: prueba otra cosa"
        );
    }
}
