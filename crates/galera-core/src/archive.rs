//! El formato de proyecto de Galera: una **carpeta** o un **archivo
//! `.galera`**, que es la misma carpeta comprimida.
//!
//! Los dos llevan lo mismo, y son intercambiables:
//!
//! ```text
//! document.json     el documento
//! fonts/            las fuentes que declara
//! assets/           las imágenes que usa
//! ```
//!
//! Un `.galera` es autocontenido (principio 4): se abre en otro ordenador,
//! sin las fuentes instaladas, y se ve igual.
//!
//! # Mismos bytes
//!
//! [`save_document`] escribe el JSON con un formato fijo y un salto de línea
//! al final; [`pack`] escribe un zip determinista (ver [`crate::zip`]).
//! Guardar dos veces un documento que no ha cambiado deja los mismos bytes,
//! así que `git` no ve ruido.
//!
//! # Nada a medias
//!
//! Tanto guardar el documento como extraer un `.galera` se hacen **a un
//! lado y se mueven al final**: si algo falla, lo que había se queda como
//! estaba y no aparece medio proyecto.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::model::Document;
use crate::open::DOCUMENT_FILE;
use crate::project::Project;
use crate::zip::{self, ZipError};

/// La extensión de un proyecto empaquetado.
pub const ARCHIVE_EXTENSION: &str = "galera";

/// Las carpetas del proyecto que viajan dentro del archivo.
pub const PACKED_DIRS: [&str; 2] = ["assets", "fonts"];

/// En qué formato está guardado un proyecto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectFormat {
    /// Una carpeta con `document.json` dentro.
    Folder,
    /// Un archivo `.galera`.
    Archive,
}

impl ProjectFormat {
    /// El formato que le corresponde a una ruta por su nombre: `.galera` es
    /// un archivo, cualquier otra cosa es una carpeta.
    pub fn of(path: &Path) -> Self {
        let archive = path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case(ARCHIVE_EXTENSION));
        if archive {
            ProjectFormat::Archive
        } else {
            ProjectFormat::Folder
        }
    }
}

/// Por qué no se pudo guardar o abrir un proyecto empaquetado.
#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    /// El documento no se pudo convertir a JSON. No debería pasar.
    #[error("el documento no se puede escribir como JSON: {0}")]
    Document(#[from] serde_json::Error),

    /// Un archivo del proyecto no se pudo leer o escribir.
    #[error("no se puede {what} {}: {source}", path.display())]
    Io {
        /// Qué se estaba haciendo: «leer», «escribir».
        what: &'static str,
        /// El archivo.
        path: PathBuf,
        /// El error del sistema.
        #[source]
        source: io::Error,
    },

    /// El `.galera` no se puede leer.
    #[error("{}: {source}", path.display())]
    Zip {
        /// El archivo.
        path: PathBuf,
        /// Por qué.
        #[source]
        source: ZipError,
    },

    /// El `.galera` no trae `document.json`: no es un proyecto.
    #[error("{} no trae {DOCUMENT_FILE}: no es un proyecto de Galera", path.display())]
    NotAProject {
        /// El archivo.
        path: PathBuf,
    },

    /// Donde hay que extraerlo ya hay algo.
    #[error("{} ya existe: no se sobrescribe", path.display())]
    AlreadyThere {
        /// La carpeta.
        path: PathBuf,
    },
}

fn io<'a>(what: &'static str, path: &'a Path) -> impl FnOnce(io::Error) -> ArchiveError + 'a {
    move |source| ArchiveError::Io {
        what,
        path: path.to_owned(),
        source,
    }
}

/// El JSON con el que se guarda un documento: con sangrado y un salto de
/// línea al final, como cualquier archivo de texto.
///
/// # Errores
///
/// [`ArchiveError::Document`] si el documento no se puede serializar.
pub fn document_bytes(document: &Document) -> Result<Vec<u8>, ArchiveError> {
    let mut json = document.to_json_string_pretty()?;
    json.push('\n');
    Ok(json.into_bytes())
}

/// Escribe `document.json` en la carpeta del proyecto.
///
/// Se escribe primero al lado, en `document.json.nuevo`, y se mueve encima
/// al terminar: si se corta la luz, el de antes sigue entero.
///
/// # Errores
///
/// [`ArchiveError`] si no se puede serializar o escribir.
pub fn save_document(root: &Path, document: &Document) -> Result<(), ArchiveError> {
    let bytes = document_bytes(document)?;
    let target = root.join(DOCUMENT_FILE);
    let temporary = root.join(format!("{DOCUMENT_FILE}.nuevo"));
    fs::write(&temporary, &bytes).map_err(io("escribir", &temporary))?;
    fs::rename(&temporary, &target).map_err(io("escribir", &target))?;
    Ok(())
}

/// Empaqueta un proyecto en un `.galera`.
///
/// Mete el documento que se le pasa (el de la memoria, no el del disco) y
/// todo lo que haya en `fonts/` y `assets/`. El archivo se escribe al lado
/// y se mueve al final.
///
/// # Errores
///
/// [`ArchiveError`] si algo del proyecto no se puede leer o el archivo no se
/// puede escribir.
pub fn pack(project: &Project, document: &Document, path: &Path) -> Result<(), ArchiveError> {
    let mut files = BTreeMap::new();
    files.insert(DOCUMENT_FILE.to_owned(), document_bytes(document)?);
    for dir in PACKED_DIRS {
        collect(&project.root().join(dir), dir, &mut files)?;
    }

    let zip = zip::write(&files);
    let temporary = path.with_extension(format!("{ARCHIVE_EXTENSION}.nuevo"));
    fs::write(&temporary, &zip).map_err(io("escribir", &temporary))?;
    fs::rename(&temporary, path).map_err(io("escribir", path))?;
    Ok(())
}

/// Añade a `files` todo lo que haya bajo `dir`, con su ruta relativa.
fn collect(
    dir: &Path,
    prefix: &str,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // Un proyecto sin imágenes o sin fuentes no tiene su carpeta.
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io("leer", dir)(error)),
    };

    for entry in entries {
        let entry = entry.map_err(io("leer", dir))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Lo que empieza por punto es del sistema (`.DS_Store`): no viaja.
        if name.starts_with('.') {
            continue;
        }
        let inside = format!("{prefix}/{name}");
        if path.is_dir() {
            collect(&path, &inside, files)?;
        } else {
            files.insert(inside, fs::read(&path).map_err(io("leer", &path))?);
        }
    }
    Ok(())
}

/// Crea un proyecto vacío en `dest`, como carpeta o como `.galera` según su
/// nombre ([`ProjectFormat::of`]).
///
/// Una carpeta nueva nace con `fonts/` y `assets/` dentro, para que se vea
/// dónde van las fuentes y las imágenes. Un `.galera` solo lleva el
/// documento: las carpetas aparecen al añadir la primera fuente o imagen.
///
/// # Errores
///
/// [`ArchiveError::AlreadyThere`] si ya hay algo ahí, o los de escribir.
pub fn create(dest: &Path, document: &Document) -> Result<(), ArchiveError> {
    match ProjectFormat::of(dest) {
        ProjectFormat::Folder => {
            let empty = match fs::read_dir(dest) {
                Ok(mut entries) => entries.next().is_none(),
                Err(error) if error.kind() == io::ErrorKind::NotFound => true,
                Err(error) => return Err(io("leer", dest)(error)),
            };
            if !empty {
                return Err(ArchiveError::AlreadyThere {
                    path: dest.to_owned(),
                });
            }
            for dir in PACKED_DIRS {
                let path = dest.join(dir);
                fs::create_dir_all(&path).map_err(io("escribir", &path))?;
            }
            save_document(dest, document)
        }
        ProjectFormat::Archive => {
            if dest.exists() {
                return Err(ArchiveError::AlreadyThere {
                    path: dest.to_owned(),
                });
            }
            let mut files = BTreeMap::new();
            files.insert(DOCUMENT_FILE.to_owned(), document_bytes(document)?);
            let zip = zip::write(&files);
            fs::write(dest, &zip).map_err(io("escribir", dest))?;
            Ok(())
        }
    }
}

/// Guarda el proyecto como **carpeta** en `dest`: copia `fonts/` y
/// `assets/` y escribe el documento.
///
/// `dest` puede no existir (se crea) o estar vacía; si tiene algo, no se
/// toca nada. Es «Guardar como» a carpeta.
///
/// # Errores
///
/// [`ArchiveError::AlreadyThere`] si `dest` tiene algo dentro, o los de
/// leer y escribir.
pub fn save_as_folder(
    project: &Project,
    document: &Document,
    dest: &Path,
) -> Result<(), ArchiveError> {
    let empty = match fs::read_dir(dest) {
        Ok(mut entries) => entries.next().is_none(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => true,
        Err(error) => return Err(io("leer", dest)(error)),
    };
    if !empty {
        return Err(ArchiveError::AlreadyThere {
            path: dest.to_owned(),
        });
    }
    fs::create_dir_all(dest).map_err(io("escribir", dest))?;

    let mut files = BTreeMap::new();
    for dir in PACKED_DIRS {
        collect(&project.root().join(dir), dir, &mut files)?;
    }
    for (name, data) in &files {
        let path = dest.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io("escribir", parent))?;
        }
        fs::write(&path, data).map_err(io("escribir", &path))?;
    }
    save_document(dest, document)
}

/// Extrae un `.galera` en una carpeta nueva.
///
/// `dest` no puede existir: se crea al lado, con todo dentro, y se mueve a
/// su sitio al final, así que nunca queda un proyecto a medias.
///
/// # Errores
///
/// [`ArchiveError`] si el archivo no se puede leer, no es un zip, está
/// dañado, no trae `document.json`, o la carpeta ya existe.
pub fn unpack(archive: &Path, dest: &Path) -> Result<(), ArchiveError> {
    if dest.exists() {
        return Err(ArchiveError::AlreadyThere {
            path: dest.to_owned(),
        });
    }
    let data = fs::read(archive).map_err(io("leer", archive))?;
    let files = zip::read(&data).map_err(|source| ArchiveError::Zip {
        path: archive.to_owned(),
        source,
    })?;
    if !files.contains_key(DOCUMENT_FILE) {
        return Err(ArchiveError::NotAProject {
            path: archive.to_owned(),
        });
    }

    let temporary = dest.with_file_name(format!(
        "{}.extrayendo",
        dest.file_name().unwrap_or_default().to_string_lossy()
    ));
    let _ = fs::remove_dir_all(&temporary);
    if let Err(error) = extract(&files, &temporary) {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary, dest) {
        let _ = fs::remove_dir_all(&temporary);
        return Err(io("escribir", dest)(error));
    }
    Ok(())
}

fn extract(files: &BTreeMap<String, Vec<u8>>, dir: &Path) -> Result<(), ArchiveError> {
    fs::create_dir_all(dir).map_err(io("escribir", dir))?;
    for (name, data) in files {
        // `zip::read` ya ha comprobado que ninguna ruta se sale de aquí.
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io("escribir", parent))?;
        }
        fs::write(&path, data).map_err(io("escribir", &path))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::open::open;

    fn fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    /// Un proyecto con el informe, una fuente y una imagen.
    fn project() -> (TempDir, Project, Document) {
        let dir = TempDir::new().expect("carpeta temporal");
        let root = dir.path();
        fs::create_dir_all(root.join("fonts")).expect("fonts/");
        fs::create_dir_all(root.join("assets")).expect("assets/");
        for (from, to) in [
            ("informe.json", DOCUMENT_FILE),
            ("fonts/Inter-Regular.ttf", "fonts/Inter-Regular.ttf"),
            ("fonts/Inter-Bold.ttf", "fonts/Inter-Bold.ttf"),
            ("assets/logo.png", "assets/logo.png"),
            ("assets/pixel.jpg", "assets/pixel.jpg"),
        ] {
            fs::copy(fixtures().join(from), root.join(to))
                .unwrap_or_else(|e| panic!("{from}: {e}"));
        }
        // Basura del sistema que no tiene que viajar.
        fs::write(root.join("assets/.DS_Store"), b"basura").expect("basura");
        let opened = open(root).expect("el proyecto abre");
        (dir, opened.project, opened.document)
    }

    #[test]
    fn the_format_comes_from_the_extension() {
        assert_eq!(
            ProjectFormat::of(Path::new("/x/informe.galera")),
            ProjectFormat::Archive
        );
        assert_eq!(
            ProjectFormat::of(Path::new("/x/informe.GALERA")),
            ProjectFormat::Archive
        );
        assert_eq!(
            ProjectFormat::of(Path::new("/x/carpeta")),
            ProjectFormat::Folder
        );
        assert_eq!(
            ProjectFormat::of(Path::new("/x/otro.zip")),
            ProjectFormat::Folder
        );
    }

    /// El criterio de la tarea: guardar, abrir y comparar.
    #[test]
    fn packing_and_unpacking_gives_back_the_same_project() {
        let (dir, project, document) = project();
        let archive = dir.path().join("informe.galera");
        pack(&project, &document, &archive).expect("se empaqueta");

        let other = TempDir::new().expect("carpeta temporal");
        let dest = other.path().join("desempaquetado");
        unpack(&archive, &dest).expect("se extrae");

        let opened = open(&dest).expect("el proyecto extraído abre");
        assert_eq!(opened.document, document);
        for file in [
            "fonts/Inter-Regular.ttf",
            "assets/logo.png",
            "assets/pixel.jpg",
        ] {
            assert_eq!(
                fs::read(dest.join(file)).unwrap_or_else(|e| panic!("{file}: {e}")),
                fs::read(fixtures().join(file)).expect("original"),
                "{file}"
            );
        }
        assert!(
            !dest.join("assets/.DS_Store").exists(),
            "la basura no viaja"
        );
        // Y compila con sus propias fuentes, sin nada instalado.
        crate::compile(&opened.document, &opened.project).expect("compila");
    }

    #[test]
    fn the_same_project_gives_the_same_bytes() {
        let (dir, project, document) = project();
        let first = dir.path().join("a.galera");
        let second = dir.path().join("b.galera");
        pack(&project, &document, &first).expect("se empaqueta");
        pack(&project, &document, &second).expect("se empaqueta");
        assert_eq!(fs::read(&first).expect("a"), fs::read(&second).expect("b"));
    }

    #[test]
    fn saving_the_document_is_stable_and_leaves_nothing_behind() {
        let (dir, _project, document) = project();
        let root = dir.path();
        save_document(root, &document).expect("se guarda");
        let first = fs::read(root.join(DOCUMENT_FILE)).expect("guardado");
        save_document(root, &document).expect("se guarda");
        assert_eq!(first, fs::read(root.join(DOCUMENT_FILE)).expect("guardado"));
        assert!(first.ends_with(b"\n"), "acaba en salto de línea");
        assert_eq!(
            Document::from_json_str(&String::from_utf8(first).expect("UTF-8")).expect("se relee"),
            document
        );
        assert!(!root.join(format!("{DOCUMENT_FILE}.nuevo")).exists());
    }

    #[test]
    fn a_broken_archive_says_so_and_leaves_no_half_project() {
        let dir = TempDir::new().expect("carpeta temporal");
        let dest = dir.path().join("destino");

        let broken = dir.path().join("roto.galera");
        fs::write(&broken, b"esto no es un zip").expect("escribir");
        assert!(matches!(
            unpack(&broken, &dest),
            Err(ArchiveError::Zip { .. })
        ));
        assert!(!dest.exists(), "no deja nada a medias");

        // Un zip de verdad, pero sin documento.
        let other = dir.path().join("otro.galera");
        let mut files = BTreeMap::new();
        files.insert("leeme.txt".to_owned(), b"hola".to_vec());
        fs::write(&other, zip::write(&files)).expect("escribir");
        assert!(matches!(
            unpack(&other, &dest),
            Err(ArchiveError::NotAProject { .. })
        ));
        assert!(!dest.exists());

        assert!(matches!(
            unpack(&dir.path().join("no-existe.galera"), &dest),
            Err(ArchiveError::Io { .. })
        ));
    }

    #[test]
    fn it_does_not_overwrite_what_is_already_there() {
        let (dir, project, document) = project();
        let archive = dir.path().join("informe.galera");
        pack(&project, &document, &archive).expect("se empaqueta");
        let taken = dir.path().join("ocupada");
        fs::create_dir(&taken).expect("carpeta");
        fs::write(taken.join("mío.txt"), b"no me toques").expect("archivo");

        assert!(matches!(
            unpack(&archive, &taken),
            Err(ArchiveError::AlreadyThere { .. })
        ));
        assert!(taken.join("mío.txt").exists());
    }

    #[test]
    fn saving_as_a_folder_copies_everything_and_respects_what_is_there() {
        let (dir, project, document) = project();
        let dest = dir.path().join("copia");
        save_as_folder(&project, &document, &dest).expect("se guarda");
        let opened = open(&dest).expect("la copia abre");
        assert_eq!(opened.document, document);
        assert!(dest.join("fonts/Inter-Regular.ttf").is_file());
        assert!(dest.join("assets/logo.png").is_file());
        assert!(!dest.join("assets/.DS_Store").exists());

        // Una carpeta vacía vale; una con algo dentro, no.
        let empty = dir.path().join("vacía");
        fs::create_dir(&empty).expect("carpeta");
        save_as_folder(&project, &document, &empty).expect("se guarda");
        assert!(matches!(
            save_as_folder(&project, &document, &dest),
            Err(ArchiveError::AlreadyThere { .. })
        ));
    }

    #[test]
    fn a_new_project_is_a_page_ready_to_edit() {
        let dir = TempDir::new().expect("carpeta temporal");
        let folder = dir.path().join("nuevo");
        create(&folder, &Document::new("Sin título")).expect("se crea");
        assert!(folder.join("fonts").is_dir());
        assert!(folder.join("assets").is_dir());

        let opened = open(&folder).expect("el proyecto nuevo abre");
        assert_eq!(opened.document.meta.title, "Sin título");
        assert_eq!(opened.document.pages.len(), 1);
        assert!(opened.document.pages[0].elements.is_empty());
        let size = &opened.document.pages[0].size;
        assert_eq!((size.width, size.height), (210.0, 297.0));
        crate::compile(&opened.document, &opened.project).expect("compila");

        // Y como `.galera`, se extrae y abre igual.
        let archive = dir.path().join("nuevo.galera");
        create(&archive, &Document::new("Otro")).expect("se crea");
        let unpacked = dir.path().join("extraido");
        unpack(&archive, &unpacked).expect("se extrae");
        assert_eq!(open(&unpacked).expect("abre").document.meta.title, "Otro");
    }

    #[test]
    fn a_new_project_never_overwrites_what_is_there() {
        let dir = TempDir::new().expect("carpeta temporal");
        let taken = dir.path().join("ocupada");
        fs::create_dir(&taken).expect("carpeta");
        fs::write(taken.join("mío.txt"), b"no me toques").expect("archivo");
        assert!(matches!(
            create(&taken, &Document::new("x")),
            Err(ArchiveError::AlreadyThere { .. })
        ));
        assert!(taken.join("mío.txt").exists());

        let archive = dir.path().join("ya.galera");
        fs::write(&archive, b"algo").expect("archivo");
        assert!(matches!(
            create(&archive, &Document::new("x")),
            Err(ArchiveError::AlreadyThere { .. })
        ));
        assert_eq!(fs::read(&archive).expect("existe"), b"algo");

        // Una carpeta vacía sí vale.
        let empty = dir.path().join("vacía");
        fs::create_dir(&empty).expect("carpeta");
        create(&empty, &Document::new("x")).expect("se crea");
    }
}
