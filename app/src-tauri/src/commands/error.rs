//! El error de los comandos.
//!
//! Casi todo lo que falla viene de `galera-core` y ya es un [`GaleraError`]
//! serializable. Lo que añade la app —por ejemplo, que una carpeta no se ha
//! elegido en el diálogo— se serializa con la misma forma, `{ kind, message }`,
//! para que la interfaz trate todos los errores igual.

use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use galera_core::{ArchiveError, GaleraError, ImportFontError};
use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Lo que puede fallar en un comando.
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    /// Un error del núcleo, tal cual.
    #[error(transparent)]
    Core(#[from] GaleraError),

    /// El documento abierto no compila. Es el error guardado en el estado,
    /// compartido: se serializa igual que [`CommandError::Core`].
    #[error(transparent)]
    DoesNotCompile(Arc<GaleraError>),

    /// Se pidió abrir una carpeta que no se ha elegido en el diálogo de abrir.
    #[error(
        "la carpeta {} no se ha elegido en el diálogo de abrir; Galera solo abre las carpetas que se eligen ahí",
        path.display()
    )]
    FolderNotChosen {
        /// La ruta que se pidió abrir.
        path: PathBuf,
    },

    /// El comando necesita un proyecto abierto y no hay ninguno.
    #[error("no hay ningún proyecto abierto")]
    NothingOpen,

    /// El diálogo devolvió algo que no es una ruta del disco.
    ///
    /// En escritorio no pasa: solo en móvil el diálogo puede devolver
    /// direcciones `content://`.
    #[error("lo elegido no es una ruta del disco")]
    NotALocalPath,

    /// No se pudo guardar o abrir un proyecto (carpeta o `.galera`).
    #[error(transparent)]
    Archive(#[from] ArchiveError),

    /// No se pudo añadir una fuente al proyecto.
    #[error(transparent)]
    Font(#[from] ImportFontError),

    /// Una fuente que se quiere quitar la necesitan textos.
    #[error(
        "la fuente {path} la usa{} {}: cambia su tipografía antes de quitarla",
        if users.len() == 1 { "" } else { "n" },
        users.join(", ")
    )]
    FontInUse {
        /// La ruta de la fuente.
        path: String,
        /// Los textos que se quedarían sin ella.
        users: Vec<String>,
    },

    /// No se pudo escribir un archivo.
    #[error("no se pudo guardar {}: {source}", path.display())]
    Write {
        /// El archivo que se quería escribir.
        path: PathBuf,
        /// El error del sistema de archivos.
        source: io::Error,
    },
}

impl CommandError {
    /// Qué clase de error es, como una palabra estable. Para los del núcleo,
    /// la de [`GaleraError::kind`].
    pub fn kind(&self) -> &'static str {
        match self {
            CommandError::Core(error) => error.kind(),
            CommandError::DoesNotCompile(error) => error.kind(),
            CommandError::FolderNotChosen { .. } => "folder_not_chosen",
            CommandError::NothingOpen => "nothing_open",
            CommandError::NotALocalPath => "not_a_local_path",
            CommandError::Archive(_) => "archive",
            CommandError::Font(_) => "font",
            CommandError::FontInUse { .. } => "font_in_use",
            CommandError::Write { .. } => "write",
        }
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            // Con sus `problems` o `diagnostics`, si los tiene.
            CommandError::Core(error) => error.serialize(serializer),
            CommandError::DoesNotCompile(error) => error.serialize(serializer),
            _ => {
                let mut error = serializer.serialize_struct("CommandError", 2)?;
                error.serialize_field("kind", self.kind())?;
                error.serialize_field("message", &self.to_string())?;
                error.end()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn an_app_error_serializes_like_a_core_error() {
        let error = CommandError::FolderNotChosen {
            path: PathBuf::from("/etc"),
        };
        assert_eq!(
            serde_json::to_value(&error).expect("serializa"),
            json!({
                "kind": "folder_not_chosen",
                "message": "la carpeta /etc no se ha elegido en el diálogo de abrir; Galera solo abre las carpetas que se eligen ahí"
            })
        );
    }

    /// Un error del núcleo no se envuelve: llega con la forma del núcleo,
    /// sea propio o compartido con el estado.
    #[test]
    fn a_core_error_serializes_untouched() {
        let core = || GaleraError::PageOutOfRange { page: 3, count: 1 };
        let expected = serde_json::to_value(core()).expect("serializa");
        assert_eq!(
            serde_json::to_value(CommandError::from(core())).expect("serializa"),
            expected
        );
        assert_eq!(
            serde_json::to_value(CommandError::DoesNotCompile(Arc::new(core())))
                .expect("serializa"),
            expected
        );
    }

    #[test]
    fn a_write_error_says_which_file() {
        let error = CommandError::Write {
            path: PathBuf::from("/solo-lectura/informe.pdf"),
            source: io::Error::from(io::ErrorKind::PermissionDenied),
        };
        let json = serde_json::to_value(&error).expect("serializa");
        assert_eq!(json["kind"], "write");
        assert!(
            json["message"].as_str().is_some_and(
                |message| message.starts_with("no se pudo guardar /solo-lectura/informe.pdf: ")
            ),
            "{json}"
        );
    }
}
