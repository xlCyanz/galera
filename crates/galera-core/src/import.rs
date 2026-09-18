//! Copiar un archivo de fuera dentro de la carpeta del proyecto.
//!
//! Lo comparten las fuentes ([`crate::fonts`]) y las imágenes
//! ([`crate::assets`]): el proyecto es autocontenido (principio 4), así que
//! lo que se añade se copia dentro en vez de enlazarse.

use std::fs;
use std::io;
use std::path::Path;

use crate::project::Project;

/// Por qué no se pudo copiar.
#[derive(Debug)]
pub(crate) enum CopyError {
    /// La carpeta de destino apunta fuera del proyecto.
    OutsideProject,
    /// No se pudo escribir.
    Write {
        /// La ruta relativa que se intentó escribir.
        path: String,
        /// Por qué.
        source: io::Error,
    },
}

/// Copia `data` (el contenido de `source`) en la carpeta `dir` del proyecto
/// y devuelve su ruta relativa a la raíz, con `/`.
///
/// Conserva el nombre de `source` con los caracteres raros cambiados por
/// `_`. Si ya hay un archivo con ese nombre y el mismo contenido, lo
/// reutiliza; si el contenido es otro, añade `-2`, `-3`…
pub(crate) fn copy_into(
    project: &Project,
    dir: &str,
    source: &Path,
    data: &[u8],
) -> Result<String, CopyError> {
    let folder = project.root().join(dir);
    fs::create_dir_all(&folder).map_err(|error| CopyError::Write {
        path: dir.to_owned(),
        source: error,
    })?;
    // La carpeta puede ser un enlace simbólico hacia fuera: `resolve` lo
    // detecta igual que al leer.
    project
        .resolve(dir)
        .map_err(|_| CopyError::OutsideProject)?;

    let (stem, extension) = safe_name(source);
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{stem}{extension}")
        } else {
            format!("{stem}-{n}{extension}")
        };
        let path = format!("{dir}/{name}");
        let target = folder.join(&name);
        match fs::read(&target) {
            Ok(existing) if existing == data => return Ok(path),
            Ok(_) => n += 1,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::write(&target, data).map_err(|error| CopyError::Write {
                    path: path.clone(),
                    source: error,
                })?;
                return Ok(path);
            }
            Err(error) => {
                return Err(CopyError::Write {
                    path,
                    source: error,
                });
            }
        }
    }
}

/// El nombre del archivo sin extensión y la extensión (con el punto, en
/// minúsculas), con todo lo que no sea letra ASCII, número, `-` o `_`
/// cambiado por `_`.
pub(crate) fn safe_name(source: &Path) -> (String, String) {
    let stem = source
        .file_stem()
        .map(|stem| clean(&stem.to_string_lossy()))
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = source
        .extension()
        .map(|extension| format!(".{}", clean(&extension.to_string_lossy()).to_lowercase()))
        .unwrap_or_default();
    (stem, extension)
}

fn clean(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
