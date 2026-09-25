//! La carpeta de un proyecto de Galera.
//!
//! Un proyecto es una carpeta con `document.json`, `fonts/` y `assets/`.
//! Este módulo es la **frontera** entre el documento y el sistema de
//! archivos: toda ruta que venga del documento, o que Typst pida mientras
//! compila, se resuelve aquí, y aquí se decide si puede leerse.
//!
//! No usa nada de Typst. Así la regla de qué se puede leer vive en un solo
//! sitio, y `world` se limita a traducir lo que Typst pide a lo que este
//! módulo permite.
//!
//! # La regla
//!
//! **Nada fuera de la carpeta del proyecto.** Ni por ruta absoluta, ni
//! subiendo con `..`, ni a través de un enlace simbólico. Un documento de
//! origen desconocido no puede usar Galera para leer archivos de la máquina
//! de quien lo abre (ver `SECURITY.md`), y un documento que se ve bien en un
//! ordenador tiene que verse igual en otro (principio 4).
//!
//! Se comprueba en dos pasos, y los dos hacen falta:
//!
//! 1. **Léxico**, antes de tocar el disco: solo componentes normales. Una
//!    ruta que sale del proyecto ni siquiera llega a consultarse, así que
//!    tampoco se puede usar para averiguar si un archivo existe fuera.
//! 2. **Real**, después de resolver enlaces simbólicos: el resultado tiene
//!    que seguir dentro de la raíz. Un `assets/logo.png` puede ser un enlace
//!    a `/etc/passwd`, y eso el primer paso no lo ve.
//!
//! # Las rutas se escriben con `/`
//!
//! En el documento, las carpetas se separan siempre con `/`, también en
//! Windows, que la entiende igual. `\` no se admite en ningún sistema: en
//! Windows separaría carpetas, pero en macOS y en Linux es un carácter más
//! del nombre, y el mismo documento encontraría sus archivos en un sitio y
//! no en otro (principio 4). Mejor un error claro en todas partes. La
//! carpeta del proyecto, en cambio, es una ruta del sistema y se escribe
//! como en él (`C:\Users\…`).

use std::io;
use std::path::{Component, Path, PathBuf};

/// Una carpeta de proyecto abierta.
#[derive(Debug, Clone)]
pub struct Project {
    /// La carpeta, ya resuelta a su ruta real con `canonicalize`.
    ///
    /// Tiene que estar resuelta: la comprobación real de [`Project::resolve`]
    /// compara prefijos, y un prefijo con enlaces simbólicos sin resolver no
    /// coincidiría nunca.
    root: PathBuf,
}

/// La carpeta del proyecto no se puede abrir.
#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    /// No existe o no se puede acceder.
    #[error("no se puede abrir la carpeta del proyecto {}", root.display())]
    NotFound {
        /// La ruta que se pidió.
        root: PathBuf,
        /// El error del sistema de archivos.
        source: io::Error,
    },
    /// Existe pero no es una carpeta.
    #[error("{} no es una carpeta de proyecto", root.display())]
    NotADirectory {
        /// La ruta que se pidió.
        root: PathBuf,
    },
}

/// Una ruta del documento no se puede leer.
#[derive(Debug, thiserror::Error)]
pub enum AccessError {
    /// La ruta sale de la carpeta del proyecto.
    #[error("la ruta sale de la carpeta del proyecto")]
    Outside,
    /// La ruta es válida pero no hay nada ahí.
    #[error("no hay ningún archivo en esa ruta")]
    NotFound,
    /// La ruta es una carpeta, no un archivo.
    #[error("la ruta es una carpeta, no un archivo")]
    IsDirectory,
    /// La ruta separa las carpetas con `\`: ver el módulo.
    #[error(
        "la ruta separa las carpetas con «\\»; en un documento van con «/», para que se abra igual en cualquier sistema"
    )]
    Backslash,
    /// Otro error del sistema de archivos.
    #[error("no se puede leer: {0}")]
    Io(#[source] io::Error),
}

impl Project {
    /// Abre la carpeta de un proyecto.
    ///
    /// # Errores
    ///
    /// Falla si la carpeta no existe o no es una carpeta.
    pub fn open(root: &Path) -> Result<Self, ProjectError> {
        let resolved = root
            .canonicalize()
            .map_err(|source| ProjectError::NotFound {
                root: root.to_owned(),
                source,
            })?;

        if !resolved.is_dir() {
            return Err(ProjectError::NotADirectory {
                root: root.to_owned(),
            });
        }

        Ok(Self { root: resolved })
    }

    /// La carpeta del proyecto, resuelta a su ruta real.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resuelve una ruta relativa a la carpeta del proyecto, comprobando que
    /// no se sale de ella.
    ///
    /// Devuelve la ruta real, con los enlaces simbólicos resueltos. La ruta
    /// tiene que existir.
    ///
    /// # Errores
    ///
    /// - [`AccessError::Backslash`] si separa las carpetas con `\`.
    /// - [`AccessError::Outside`] si es absoluta, sube con `..`, está vacía o
    ///   llega fuera a través de un enlace simbólico.
    /// - [`AccessError::NotFound`] si es válida pero no hay nada.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, AccessError> {
        // Antes que nada: en Windows, `\` cambiaría lo que significa la
        // ruta, y en los demás sistemas no.
        if relative.contains('\\') {
            return Err(AccessError::Backslash);
        }
        let path = Path::new(relative);

        // Paso léxico. `CurDir` (`./`) es inofensivo; `ParentDir` (`..`),
        // `RootDir` (`/`) y `Prefix` (`C:` en Windows) no.
        let lexically_inside = !relative.is_empty()
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));

        if !lexically_inside {
            return Err(AccessError::Outside);
        }

        // Paso real: resolver enlaces simbólicos y volver a comprobar.
        let resolved = self
            .root
            .join(path)
            .canonicalize()
            .map_err(|error| match error.kind() {
                io::ErrorKind::NotFound => AccessError::NotFound,
                _ => AccessError::Io(error),
            })?;

        if !resolved.starts_with(&self.root) {
            return Err(AccessError::Outside);
        }

        Ok(resolved)
    }

    /// Lee un archivo del proyecto.
    ///
    /// # Errores
    ///
    /// Los de [`Project::resolve`], más [`AccessError::IsDirectory`] si la
    /// ruta es una carpeta.
    pub fn read(&self, relative: &str) -> Result<Vec<u8>, AccessError> {
        let path = self.file(relative)?;
        std::fs::read(&path).map_err(AccessError::Io)
    }

    /// Comprueba que una ruta relativa al proyecto es un archivo que se puede
    /// usar, sin leerlo, y devuelve su ruta real.
    ///
    /// Sirve para comprobar que un recurso está antes de necesitarlo: una
    /// imagen grande no se lee entera solo para saber que existe.
    ///
    /// # Errores
    ///
    /// Los de [`Project::resolve`], más [`AccessError::IsDirectory`] si la
    /// ruta es una carpeta.
    pub fn file(&self, relative: &str) -> Result<PathBuf, AccessError> {
        let path = self.resolve(relative)?;

        if path.is_dir() {
            return Err(AccessError::IsDirectory);
        }

        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Un proyecto con `assets/logo.png` dentro.
    fn project() -> (TempDir, Project) {
        let dir = TempDir::new().expect("se puede crear una carpeta temporal");
        fs::create_dir(dir.path().join("assets")).expect("assets/");
        fs::write(dir.path().join("assets/logo.png"), b"logo").expect("escribir");
        let project = Project::open(dir.path()).expect("el proyecto debe abrirse");
        (dir, project)
    }

    #[test]
    fn it_reads_a_file_inside_the_project() {
        let (_dir, project) = project();
        assert_eq!(
            project.read("assets/logo.png").expect("debe leerse"),
            b"logo"
        );
    }

    #[test]
    fn a_leading_current_dir_is_harmless() {
        let (_dir, project) = project();
        assert!(project.read("./assets/logo.png").is_ok());
        assert!(project.read("assets/./logo.png").is_ok());
    }

    /// El criterio de la tarea: intentar leer `/etc/passwd` subiendo desde el
    /// proyecto falla de forma controlada, sin `panic!` y sin tocar el disco.
    #[test]
    fn reading_etc_passwd_by_climbing_out_fails_cleanly() {
        let (_dir, project) = project();

        for path in [
            "../../etc/passwd",
            "../../../../../../../../etc/passwd",
            "assets/../../etc/passwd",
        ] {
            assert!(
                matches!(project.read(path), Err(AccessError::Outside)),
                "{path:?} debe rechazarse como fuera del proyecto"
            );
        }
    }

    #[test]
    fn an_absolute_path_is_outside() {
        let (_dir, project) = project();
        assert!(matches!(
            project.read("/etc/passwd"),
            Err(AccessError::Outside)
        ));

        // Incluso si apunta a un archivo que sí está en el proyecto.
        let absolute = project.root().join("assets/logo.png");
        let absolute = absolute.to_str().expect("ruta UTF-8");
        assert!(matches!(project.read(absolute), Err(AccessError::Outside)));
    }

    /// Una ruta con `\` no se lee en ningún sistema, ni siquiera en
    /// Windows, donde encontraría el archivo: así el documento se comporta
    /// igual en todas partes.
    #[test]
    fn a_backslash_is_refused_everywhere() {
        let (_dir, project) = project();
        for path in [
            "assets\\logo.png",
            ".\\assets\\logo.png",
            "..\\..\\etc\\passwd",
        ] {
            assert!(
                matches!(project.read(path), Err(AccessError::Backslash)),
                "{path:?}"
            );
        }
        // Con `/`, el mismo archivo se lee.
        assert!(project.read("assets/logo.png").is_ok());
    }

    /// En Windows, una unidad o una ruta de red también son rutas absolutas.
    #[cfg(windows)]
    #[test]
    fn a_windows_drive_or_share_is_outside() {
        let (_dir, project) = project();
        for path in [
            "C:/Windows/win.ini",
            "C:Windows/win.ini",
            "//servidor/recurso/x.png",
        ] {
            assert!(
                matches!(project.read(path), Err(AccessError::Outside)),
                "{path:?}"
            );
        }
    }

    #[test]
    fn an_empty_path_is_outside() {
        let (_dir, project) = project();
        assert!(matches!(project.read(""), Err(AccessError::Outside)));
    }

    /// Un `..` que vuelve a entrar sigue sin aceptarse: la regla es léxica y
    /// no intenta adivinar si la ruta acaba dentro.
    #[test]
    fn a_parent_dir_is_rejected_even_if_it_comes_back_in() {
        let (_dir, project) = project();
        assert!(matches!(
            project.read("assets/../assets/logo.png"),
            Err(AccessError::Outside)
        ));
    }

    /// Lo que el paso léxico no ve: un enlace simbólico dentro del proyecto
    /// que apunta fuera.
    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_outside_is_outside() {
        let outside = TempDir::new().expect("carpeta temporal");
        fs::write(outside.path().join("secreto.txt"), b"no deberias leer esto").expect("escribir");

        let (dir, project) = project();
        std::os::unix::fs::symlink(
            outside.path().join("secreto.txt"),
            dir.path().join("assets/enlace.png"),
        )
        .expect("crear enlace");

        assert!(matches!(
            project.read("assets/enlace.png"),
            Err(AccessError::Outside)
        ));
    }

    /// Un enlace que apunta a otro sitio **dentro** del proyecto sí vale.
    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_inside_is_fine() {
        let (dir, project) = project();
        std::os::unix::fs::symlink(
            dir.path().join("assets/logo.png"),
            dir.path().join("assets/alias.png"),
        )
        .expect("crear enlace");

        assert_eq!(
            project.read("assets/alias.png").expect("debe leerse"),
            b"logo"
        );
    }

    /// Una carpeta de proyecto que es a su vez un enlace simbólico se
    /// resuelve al abrirla, y las rutas de dentro siguen valiendo.
    #[cfg(unix)]
    #[test]
    fn a_project_opened_through_a_symlink_still_works() {
        let (dir, _project) = project();
        let links = TempDir::new().expect("carpeta temporal");
        let link = links.path().join("proyecto");
        std::os::unix::fs::symlink(dir.path(), &link).expect("crear enlace");

        let project = Project::open(&link).expect("debe abrirse por el enlace");
        assert_eq!(
            project.read("assets/logo.png").expect("debe leerse"),
            b"logo"
        );
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let (_dir, project) = project();
        assert!(matches!(
            project.read("assets/no-existe.png"),
            Err(AccessError::NotFound)
        ));
    }

    #[test]
    fn a_directory_is_not_a_file() {
        let (_dir, project) = project();
        assert!(matches!(
            project.read("assets"),
            Err(AccessError::IsDirectory)
        ));
    }

    /// `file` aplica las mismas reglas que `read`, sin leer.
    #[test]
    fn file_checks_like_read_without_reading() {
        let (_dir, project) = project();
        assert_eq!(
            project.file("assets/logo.png").expect("es un archivo"),
            project.root().join("assets/logo.png")
        );
        assert!(matches!(
            project.file("assets"),
            Err(AccessError::IsDirectory)
        ));
        assert!(matches!(
            project.file("assets/no-existe.png"),
            Err(AccessError::NotFound)
        ));
        assert!(matches!(
            project.file("../../etc/passwd"),
            Err(AccessError::Outside)
        ));
    }

    #[test]
    fn a_missing_project_folder_is_a_clear_error() {
        let error = Project::open(Path::new("/no/existe/este/proyecto"))
            .expect_err("una carpeta inexistente debe fallar");
        assert!(matches!(error, ProjectError::NotFound { .. }), "{error:?}");
        assert!(error.to_string().contains("/no/existe/este/proyecto"));
    }

    #[test]
    fn a_file_is_not_a_project_folder() {
        let (dir, _project) = project();
        let error = Project::open(&dir.path().join("assets/logo.png"))
            .expect_err("un archivo no es un proyecto");
        assert!(
            matches!(error, ProjectError::NotADirectory { .. }),
            "{error:?}"
        );
    }
}
