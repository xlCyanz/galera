//! Imágenes del proyecto: añadir un archivo de fuera a la carpeta `assets/`
//! y darle una clave en el mapa [`Document::assets`].
//!
//! El proyecto es autocontenido (principio 4): una imagen se copia dentro,
//! no se enlaza. El formato se comprueba por el contenido del archivo, no
//! por su extensión, para rechazar con un mensaje claro lo que Typst no
//! sabría dibujar en vez de fallar después al compilar.

use std::fs;
use std::io::{self, Read};
use std::path::Path;

use crate::import::{CopyError, copy_into, safe_name};
use crate::model::Document;
use crate::project::Project;

/// Carpeta del proyecto donde se copian las imágenes añadidas.
pub const ASSETS_DIR: &str = "assets";

/// Los formatos de imagen que se pueden añadir, los que dibuja Typst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    /// PNG.
    Png,
    /// JPEG.
    Jpeg,
    /// GIF.
    Gif,
    /// WebP.
    Webp,
    /// SVG.
    Svg,
}

impl ImageFormat {
    /// Su nombre, para enseñarlo: «PNG».
    pub fn name(self) -> &'static str {
        match self {
            ImageFormat::Png => "PNG",
            ImageFormat::Jpeg => "JPEG",
            ImageFormat::Gif => "GIF",
            ImageFormat::Webp => "WebP",
            ImageFormat::Svg => "SVG",
        }
    }

    /// Su tipo MIME, para enseñar la imagen en la interfaz.
    pub fn mime(self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Gif => "image/gif",
            ImageFormat::Webp => "image/webp",
            ImageFormat::Svg => "image/svg+xml",
        }
    }
}

/// Lo que se sabe de un recurso del documento, para el panel de recursos.
#[derive(Debug, Clone, PartialEq)]
pub struct AssetSummary {
    /// Su clave en `assets`.
    pub key: String,
    /// Su ruta dentro del proyecto.
    pub path: String,
    /// Su formato, o `None` si el archivo no está o no es una imagen que se
    /// pueda usar.
    pub format: Option<ImageFormat>,
    /// Cuánto ocupa, en bytes, o `None` si el archivo no está.
    pub bytes: Option<u64>,
    /// Los elementos que lo usan, en orden del documento.
    pub users: Vec<String>,
}

/// Los recursos del documento, en orden de clave, con su formato, su peso y
/// quién los usa. Del archivo solo se lee el principio, para el formato.
pub fn asset_summaries(project: &Project, document: &Document) -> Vec<AssetSummary> {
    document
        .assets
        .iter()
        .map(|(key, path)| {
            let file = project.file(path).ok();
            let bytes = file
                .as_ref()
                .and_then(|file| fs::metadata(file).ok())
                .map(|metadata| metadata.len());
            let format = file.as_ref().and_then(|file| {
                let mut head = Vec::new();
                fs::File::open(file)
                    .and_then(|opened| opened.take(4096).read_to_end(&mut head))
                    .ok()?;
                image_format(&head)
            });
            AssetSummary {
                key: key.clone(),
                path: path.clone(),
                format,
                bytes,
                users: document.asset_users(key),
            }
        })
        .collect()
}

/// El formato de una imagen por su contenido, o `None` si no es ninguno de
/// los que se pueden añadir.
pub fn image_format(data: &[u8]) -> Option<ImageFormat> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(ImageFormat::Png);
    }
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(ImageFormat::Jpeg);
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some(ImageFormat::Gif);
    }
    if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        return Some(ImageFormat::Webp);
    }
    // Un SVG es texto: se busca la etiqueta al principio, tras una posible
    // declaración XML, comentarios o un DOCTYPE.
    let head = &data[..data.len().min(4096)];
    if let Ok(text) = std::str::from_utf8(head)
        && text
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with('<')
        && text.contains("<svg")
    {
        return Some(ImageFormat::Svg);
    }
    None
}

/// Una imagen recién añadida al proyecto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedImage {
    /// La clave con la que registrarla en `assets` (o la que ya tenía).
    pub key: String,
    /// Su ruta relativa a la raíz del proyecto.
    pub path: String,
}

/// Por qué no se pudo añadir una imagen.
#[derive(Debug, thiserror::Error)]
pub enum ImportImageError {
    /// El archivo no se puede leer.
    #[error("no se puede leer {path:?}: {source}")]
    Unreadable {
        /// El archivo elegido.
        path: String,
        /// Por qué.
        source: io::Error,
    },
    /// El archivo no es una imagen que Galera sepa usar.
    #[error(
        "{name} no es una imagen que Galera sepa usar: tiene que ser PNG, JPEG, GIF, WebP o SVG"
    )]
    Unsupported {
        /// El nombre del archivo.
        name: String,
    },
    /// La carpeta `assets/` del proyecto apunta fuera de él.
    #[error("la carpeta {ASSETS_DIR}/ del proyecto apunta fuera de él")]
    OutsideProject,
    /// No se pudo copiar en la carpeta del proyecto.
    #[error("no se puede copiar la imagen en {path:?}: {source}")]
    Write {
        /// Dónde se intentó escribir.
        path: String,
        /// Por qué.
        source: io::Error,
    },
}

/// Copia una imagen en la carpeta `assets/` del proyecto y elige su clave.
///
/// Comprueba antes que es una imagen de un formato que se puede usar. La
/// copia sigue las reglas de siempre (mismo nombre, reutiliza un archivo
/// idéntico, renombra si choca). La clave sale del nombre del archivo
/// (`logo`, `logo-2`…) sin chocar con las que ya tiene `document`; si la
/// imagen ya estaba registrada con otra clave, se devuelve esa. No toca el
/// documento: registrar la clave es cosa de quien llama.
///
/// # Errores
///
/// [`ImportImageError`] si el archivo no se puede leer, no es una imagen
/// que se pueda usar o no se puede copiar.
pub fn import_image(
    project: &Project,
    document: &Document,
    source: &Path,
) -> Result<ImportedImage, ImportImageError> {
    let data = fs::read(source).map_err(|error| ImportImageError::Unreadable {
        path: source.display().to_string(),
        source: error,
    })?;
    if image_format(&data).is_none() {
        let name = source
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| source.display().to_string());
        return Err(ImportImageError::Unsupported { name });
    }
    let path = copy_into(project, ASSETS_DIR, source, &data).map_err(|error| match error {
        CopyError::OutsideProject => ImportImageError::OutsideProject,
        CopyError::Write { path, source } => ImportImageError::Write { path, source },
    })?;

    if let Some((key, _)) = document.assets.iter().find(|(_, known)| **known == path) {
        return Ok(ImportedImage {
            key: key.clone(),
            path,
        });
    }
    let (stem, _) = safe_name(source);
    let stem = stem.to_lowercase();
    let key = (1..)
        .map(|n| {
            if n == 1 {
                stem.clone()
            } else {
                format!("{stem}-{n}")
            }
        })
        .find(|key| !document.assets.contains_key(key))
        .unwrap_or(stem);
    Ok(ImportedImage { key, path })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/assets")
            .join(name)
    }

    fn document(assets: &str) -> Document {
        Document::from_json_str(&format!(
            r#"{{ "version": 1, "meta": {{ "title": "x" }}, "assets": {assets}, "pages": [] }}"#
        ))
        .expect("es un documento")
    }

    fn project() -> (TempDir, Project) {
        let dir = TempDir::new().expect("carpeta temporal");
        let project = Project::open(dir.path()).expect("es un proyecto");
        (dir, project)
    }

    #[test]
    fn formats_are_recognised_by_their_content() {
        assert_eq!(
            image_format(b"\x89PNG\r\n\x1a\nresto"),
            Some(ImageFormat::Png)
        );
        assert_eq!(
            image_format(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(image_format(b"GIF89a..."), Some(ImageFormat::Gif));
        assert_eq!(
            image_format(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(ImageFormat::Webp)
        );
        assert_eq!(
            image_format(b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            Some(ImageFormat::Svg)
        );
        for (name, format) in [
            ("pixel.png", ImageFormat::Png),
            ("pixel.jpg", ImageFormat::Jpeg),
            ("pixel.svg", ImageFormat::Svg),
        ] {
            let data = fs::read(fixture(name)).expect("existe");
            assert_eq!(image_format(&data), Some(format), "{name}");
        }
        assert_eq!(image_format(b"%PDF-1.7"), None);
        assert_eq!(image_format(b"<html><body></body></html>"), None);
        assert_eq!(image_format(b""), None);
    }

    #[test]
    fn an_image_is_copied_into_assets_with_a_key_from_its_name() {
        let (dir, project) = project();
        let imported =
            import_image(&project, &document("{}"), &fixture("logo.png")).expect("se añade");
        assert_eq!(
            imported,
            ImportedImage {
                key: "logo".into(),
                path: "assets/logo.png".into()
            }
        );
        assert_eq!(
            fs::read(dir.path().join("assets/logo.png")).expect("copiada"),
            fs::read(fixture("logo.png")).expect("original")
        );
    }

    #[test]
    fn the_key_does_not_clash_and_an_image_already_registered_keeps_its_key() {
        let (_dir, project) = project();
        let taken = document(r#"{ "logo": "assets/otro.png" }"#);
        let imported = import_image(&project, &taken, &fixture("logo.png")).expect("se añade");
        assert_eq!(imported.key, "logo-2");

        let registered = document(r#"{ "marca": "assets/logo.png" }"#);
        let again = import_image(&project, &registered, &fixture("logo.png")).expect("se añade");
        assert_eq!(again.key, "marca");
    }

    #[test]
    fn an_unsupported_file_is_rejected_with_its_name_and_nothing_is_copied() {
        let (dir, project) = project();
        let pdf = dir.path().join("informe.pdf");
        fs::write(&pdf, b"%PDF-1.7").expect("escribir");
        let error = import_image(&project, &document("{}"), &pdf).expect_err("no es una imagen");
        assert_eq!(
            error.to_string(),
            "informe.pdf no es una imagen que Galera sepa usar: tiene que ser PNG, JPEG, GIF, WebP o SVG"
        );
        assert!(!dir.path().join("assets").exists());
    }

    #[test]
    fn summaries_say_format_size_and_users_and_survive_a_missing_file() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        let project = Project::open(&dir).expect("es un proyecto");
        let document = Document::from_json_str(
            r#"{ "version": 1, "meta": { "title": "x" },
                 "assets": { "logo": "assets/logo.png", "foto": "assets/pixel.jpg", "falta": "assets/no-esta.png" },
                 "pages": [{ "id": "p1", "size": { "width": 10, "height": 10, "unit": "mm" }, "elements": [
                   { "id": "i1", "type": "image", "x": 0, "y": 0, "w": 1, "h": null, "asset": "logo" },
                   { "id": "i2", "type": "image", "x": 0, "y": 0, "w": 1, "h": null, "asset": "logo" }
                 ] }] }"#,
        )
        .expect("es un documento");
        let summaries = asset_summaries(&project, &document);
        let keys: Vec<&str> = summaries.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["falta", "foto", "logo"]);

        let logo = &summaries[2];
        assert_eq!(logo.format, Some(ImageFormat::Png));
        assert_eq!(
            logo.bytes,
            Some(fs::metadata(fixture("logo.png")).expect("existe").len())
        );
        assert_eq!(logo.users, ["i1", "i2"]);
        assert_eq!(summaries[1].format.map(ImageFormat::name), Some("JPEG"));
        assert!(summaries[1].users.is_empty());
        assert_eq!((summaries[0].format, summaries[0].bytes), (None, None));
    }
}
