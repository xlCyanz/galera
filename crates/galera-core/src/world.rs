//! El entorno en el que compila Typst.
//!
//! El compilador de Typst no lee nada por su cuenta: todo lo que necesita
//! —el archivo principal, las fuentes, las imágenes, la biblioteca estándar,
//! la fecha— lo pide a través del trait [`World`]. Este módulo es la
//! implementación de Galera, y es uno de los tres sitios donde se permite
//! usar `typst::*` (principio 5 del README); los otros dos son `compile` y
//! `layout`.
//!
//! # Las fuentes viajan con el documento
//!
//! [`GaleraWorld`] carga **solo** las fuentes que el documento declara, desde
//! la carpeta del proyecto. Nunca consulta las fuentes instaladas en la
//! máquina: un documento que se ve bien en un ordenador tiene que verse
//! exactamente igual en cualquier otro (principio 4). Si una fuente no está,
//! es un error al abrir, no un cambio silencioso de tipografía.
//!
//! # Archivos
//!
//! Cuando Typst pide un archivo —una imagen, casi siempre— la petición pasa
//! por [`Project::read`], que es quien decide qué se puede leer: nada fuera
//! de la carpeta del proyecto, ni por `..`, ni por ruta absoluta, ni por un
//! enlace simbólico. Este módulo solo traduce entre lo que Typst pide y lo
//! que `project` permite.
//!
//! Dos cosas se deniegan siempre, a propósito:
//!
//! - **Paquetes de Typst** (`@preview/...`). Descargarlos rompería que el
//!   documento sea autocontenido, y exigiría red.
//! - **Importar otros archivos `.typ`.** Nada en Galera lo necesita: el
//!   código generado no importa nada. Abrirlo solo añadiría superficie.
//!
//! # Los bloques de código personalizado también leen
//!
//! El código de un bloque personalizado se evalúa con `eval`, y en Typst
//! 0.15.1 **`eval` no quita el acceso a disco**: puede usar `image(...)` y
//! `read(...)` con archivos del proyecto. Eso es una capacidad, no un
//! agujero, porque sus lecturas pasan por aquí igual que las demás, y la
//! frontera de la carpeta del proyecto vale también para ellas. Dos pruebas
//! lo fijan en los dos sentidos.
//!
//! # Nota de Rust
//!
//! Un *trait* es un contrato: una lista de métodos que un tipo se compromete
//! a implementar. `World` es el contrato entre Typst y quien lo usa. Typst
//! no sabe nada de `GaleraWorld`; solo sabe llamar a esos siete métodos.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

use crate::project::{AccessError, Project};

/// Ruta virtual del archivo principal, el que genera el codegen.
///
/// No existe en disco: su contenido vive en memoria y se regenera en cada
/// compilación.
const MAIN_PATH: &str = "/main.typ";

/// Algo impide preparar el entorno de compilación.
#[derive(Debug, thiserror::Error)]
pub enum WorldError {
    /// Una fuente declarada no está en la carpeta del proyecto.
    #[error("el documento declara la fuente {path:?}, pero no está en la carpeta del proyecto")]
    FontNotFound {
        /// La ruta tal como la declara el documento.
        path: String,
    },

    /// Una fuente declarada apunta fuera de la carpeta del proyecto.
    #[error(
        "la fuente {path:?} apunta fuera de la carpeta del proyecto; las fuentes tienen que viajar con el documento"
    )]
    FontOutsideProject {
        /// La ruta tal como la declara el documento.
        path: String,
    },

    /// Una fuente existe pero no se puede leer.
    #[error("la fuente {path:?} no se puede leer: {source}")]
    FontUnreadable {
        /// La ruta tal como la declara el documento.
        path: String,
        /// Por qué no se pudo leer.
        source: AccessError,
    },

    /// Un archivo declarado como fuente no contiene ninguna fuente válida.
    #[error("el archivo {path:?} no contiene ninguna fuente que Typst sepa leer")]
    InvalidFont {
        /// La ruta tal como la declara el documento.
        path: String,
    },

    /// La ruta virtual del archivo principal no es válida.
    ///
    /// Es una constante, así que no debería ocurrir nunca: solo pasaría si una
    /// versión nueva de Typst cambiara las reglas de las rutas virtuales.
    #[error(
        "error interno: la ruta del archivo principal {MAIN_PATH:?} no es válida para esta versión de Typst"
    )]
    InvalidMainPath,
}

/// El entorno de compilación de un proyecto de Galera.
///
/// Se crea una vez por proyecto abierto. Las fuentes se cargan al crearlo y
/// se reutilizan en cada compilación: no cambian mientras se edita.
pub struct GaleraWorld {
    /// La carpeta del proyecto, y la regla de qué se puede leer de ella.
    project: Project,
    /// La biblioteca estándar de Typst.
    library: LazyHash<Library>,
    /// Índice de las fuentes cargadas, que Typst consulta para elegir.
    book: LazyHash<FontBook>,
    /// Las fuentes, en el mismo orden que el índice.
    fonts: Vec<Font>,
    /// El archivo principal: el código Typst que genera el codegen.
    main: Source,
    /// Archivos ya leídos del proyecto.
    ///
    /// Typst pide el mismo archivo muchas veces durante una compilación, y el
    /// contrato de `World` pide cachearlos. Solo se guardan las lecturas que
    /// salieron bien: un archivo que faltaba puede aparecer después.
    files: Mutex<HashMap<FileId, Bytes>>,
}

impl GaleraWorld {
    /// Prepara el entorno de un proyecto.
    ///
    /// - `project`: la carpeta del proyecto, ya abierta.
    /// - `fonts`: las rutas de fuente que declara el documento, relativas al
    ///   proyecto. Son las únicas fuentes que Typst verá.
    /// - `main`: el código Typst que se va a compilar.
    ///
    /// # Errores
    ///
    /// Falla si alguna fuente no está, apunta fuera del proyecto, no se
    /// puede leer o no es una fuente.
    pub fn new(project: Project, fonts: &[String], main: String) -> Result<Self, WorldError> {
        let fonts = load_fonts(&project, fonts)?;
        let book = FontBook::from_fonts(&fonts);

        let main_path = VirtualPath::new(MAIN_PATH).map_err(|_| WorldError::InvalidMainPath)?;
        let main_id = FileId::new(RootedPath::new(VirtualRoot::Project, main_path));

        Ok(Self {
            project,
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(book),
            fonts,
            main: Source::new(main_id, main),
            files: Mutex::new(HashMap::new()),
        })
    }

    /// La carpeta del proyecto.
    pub fn project(&self) -> &Project {
        &self.project
    }

    /// El código Typst que se compila. Compartido, no copiado.
    pub fn main_source(&self) -> Source {
        self.main.clone()
    }

    /// Las familias tipográficas de las fuentes cargadas, una vez cada una,
    /// con el nombre que traen dentro. La validación las compara sin
    /// distinguir mayúsculas, como Typst.
    pub fn font_families(&self) -> Vec<String> {
        self.book
            .families()
            .map(|(family, _)| family.to_owned())
            .collect()
    }

    /// Olvida los archivos ya leídos, para que la próxima compilación los
    /// vuelva a leer del disco.
    ///
    /// Hace falta cuando cambian los recursos del proyecto mientras está
    /// abierto: una imagen reemplazada, por ejemplo.
    pub fn clear_file_cache(&self) {
        self.files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    /// Lee un archivo del proyecto, pasando por la caché.
    fn read_project_file(&self, id: FileId) -> FileResult<Bytes> {
        // Una caché envenenada solo significa que un hilo falló mientras la
        // tenía; los datos siguen siendo válidos.
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);

        if let Some(bytes) = files.get(&id) {
            return Ok(bytes.clone());
        }

        let relative = id.vpath().get_without_slash();
        let data = self.project.read(relative).map_err(|error| match error {
            AccessError::Outside => FileError::AccessDenied,
            // La ruta relativa, y no la absoluta: el mensaje lo lee la persona
            // que edita, y la ruta de su carpeta no le dice nada.
            AccessError::NotFound => FileError::NotFound(PathBuf::from(relative)),
            AccessError::IsDirectory => FileError::IsDirectory,
            AccessError::Io(error) => FileError::from_io(error, relative.as_ref()),
        })?;

        let bytes = Bytes::new(data);
        files.insert(id, bytes.clone());
        Ok(bytes)
    }
}

impl World for GaleraWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            // Nada en Galera importa otros archivos `.typ`. Ver el módulo.
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main.id() {
            // `Source` es un puntero compartido: esto no copia el texto.
            return Ok(Bytes::from_string(self.main.clone()));
        }

        match id.root() {
            VirtualRoot::Project => self.read_project_file(id),
            // Los paquetes se descargan de la red y el documento dejaría de
            // ser autocontenido. Ver el módulo.
            VirtualRoot::Package(_) => Err(FileError::AccessDenied),
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        // El índice puede venir de un `FontBook` viejo durante la compilación
        // incremental, así que puede estar fuera de rango. `get` lo cubre.
        self.fonts.get(index).cloned()
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        let since_epoch = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
        let mut seconds = i64::try_from(since_epoch.as_secs()).ok()?;

        // Sin desfase, Typst pide la fecha local. Sin una base de datos de
        // zonas horarias no hay forma portable de saberla, así que se usa la
        // UTC. Con desfase, se aplica.
        if let Some(offset) = offset {
            seconds += offset.seconds() as i64;
        }

        let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
        Datetime::from_ymd(year, month, day)
    }
}

/// Carga las fuentes declaradas, en orden.
fn load_fonts(project: &Project, declared: &[String]) -> Result<Vec<Font>, WorldError> {
    let mut fonts = Vec::new();

    for path in declared {
        let data = project.read(path).map_err(|error| match error {
            AccessError::Outside => WorldError::FontOutsideProject { path: path.clone() },
            AccessError::NotFound => WorldError::FontNotFound { path: path.clone() },
            other => WorldError::FontUnreadable {
                path: path.clone(),
                source: other,
            },
        })?;

        // Un archivo puede traer varias caras (una colección `.ttc`), y cada
        // una es una fuente para Typst.
        let before = fonts.len();
        fonts.extend(Font::iter(Bytes::new(data)));

        if fonts.len() == before {
            return Err(WorldError::InvalidFont { path: path.clone() });
        }
    }

    Ok(fonts)
}

/// Convierte días desde el 1 de enero de 1970 en año, mes y día.
///
/// Es el algoritmo `civil_from_days` de Howard Hinnant, exacto para
/// cualquier fecha del calendario gregoriano proléptico. Evita añadir una
/// dependencia solo para saber qué día es hoy.
fn civil_from_days(days: i64) -> (i32, u8, u8) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    (year as i32, month as u8, day as u8)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::TempDir;
    use typst::WorldExt;
    use typst::diag::SourceDiagnostic;
    use typst_layout::PagedDocument;

    use super::*;
    use crate::codegen;
    use crate::model::Document;

    /// Una fuente real para las pruebas, sacada de los recursos de Typst.
    /// Evita meter archivos de fuente binarios en el repositorio.
    fn libertinus_regular() -> &'static [u8] {
        typst_assets::fonts()
            .next()
            .expect("typst-assets trae fuentes con la característica `fonts`")
    }

    /// Una carpeta temporal con `fonts/LibertinusSerif-Regular.otf` y las
    /// tres imágenes de `fixtures/assets/` dentro de `assets/`.
    fn project_dir() -> TempDir {
        let dir = TempDir::new().expect("se puede crear una carpeta temporal");
        fs::create_dir(dir.path().join("fonts")).expect("fonts/");
        fs::write(
            dir.path().join("fonts/LibertinusSerif-Regular.otf"),
            libertinus_regular(),
        )
        .expect("escribir la fuente");

        fs::create_dir(dir.path().join("assets")).expect("assets/");
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets");
        for name in ["pixel.png", "pixel.jpg", "pixel.svg"] {
            fs::copy(fixtures.join(name), dir.path().join("assets").join(name))
                .expect("copiar la imagen de prueba");
        }
        dir
    }

    fn open(dir: &TempDir) -> Project {
        Project::open(dir.path()).expect("el proyecto debe abrirse")
    }

    fn world(dir: &TempDir, fonts: &[&str], main: &str) -> GaleraWorld {
        let fonts: Vec<String> = fonts.iter().map(|path| (*path).to_owned()).collect();
        GaleraWorld::new(open(dir), &fonts, main.to_owned()).expect("el entorno debe prepararse")
    }

    fn file_id(path: &str) -> FileId {
        FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new(path).expect("ruta virtual válida"),
        ))
    }

    /// El resultado de generar y compilar un documento.
    struct Compiled {
        world: GaleraWorld,
        source: String,
        output: Result<PagedDocument, Vec<SourceDiagnostic>>,
    }

    fn compile_json(dir: &TempDir, json: &str) -> Compiled {
        let document = Document::from_json_str(json).expect("debe deserializar");
        let source = codegen::generate(&document).expect("debe generar código");
        let world = GaleraWorld::new(open(dir), &document.fonts, source.clone())
            .expect("el entorno debe prepararse");
        let output = typst::compile::<PagedDocument>(&world)
            .output
            .map_err(|errors| errors.to_vec());
        Compiled {
            world,
            source,
            output,
        }
    }

    /// La línea del código generado en la que cae un diagnóstico.
    fn line_of(compiled: &Compiled, diagnostic: &SourceDiagnostic) -> Option<String> {
        let source = &compiled.source;
        let range = compiled.world.range(diagnostic.span)?;
        let start = source[..range.start]
            .rfind('\n')
            .map_or(0, |index| index + 1);
        let end = source[range.start..]
            .find('\n')
            .map_or(source.len(), |index| range.start + index);
        Some(source[start..end].to_owned())
    }

    // ── Fuentes ─────────────────────────────────────────────────────────

    #[test]
    fn it_loads_the_declared_fonts_from_the_project() {
        let dir = project_dir();
        let world = world(&dir, &["fonts/LibertinusSerif-Regular.otf"], "");

        assert!(world.book().contains_family("libertinus serif"));
        assert!(world.font(0).is_some());
    }

    #[test]
    fn it_lists_the_families_of_the_loaded_fonts() {
        let dir = project_dir();
        let world = world(&dir, &["fonts/LibertinusSerif-Regular.otf"], "");
        assert_eq!(world.font_families(), ["Libertinus Serif"]);
    }

    /// Principio 4: sin fuentes declaradas, Typst no ve ninguna. Ni las del
    /// sistema ni ninguna otra.
    #[test]
    fn without_declared_fonts_typst_sees_none() {
        let dir = project_dir();
        let world = world(&dir, &[], "");

        assert_eq!(world.book().families().count(), 0);
        assert!(world.font(0).is_none());
    }

    /// El índice puede llegar fuera de rango durante la compilación
    /// incremental; tiene que devolver `None`, no hacer `panic!`.
    #[test]
    fn an_out_of_range_font_index_is_none() {
        let dir = project_dir();
        let world = world(&dir, &["fonts/LibertinusSerif-Regular.otf"], "");
        assert!(world.font(9_999).is_none());
    }

    #[test]
    fn a_declared_font_that_is_missing_is_a_clear_error() {
        let dir = project_dir();
        let error = GaleraWorld::new(
            open(&dir),
            &["fonts/Inter-Regular.ttf".to_owned()],
            String::new(),
        )
        .err()
        .expect("una fuente ausente debe fallar");

        assert!(
            matches!(&error, WorldError::FontNotFound { path } if path == "fonts/Inter-Regular.ttf"),
            "{error:?}"
        );
        let message = error.to_string();
        assert!(message.contains("fonts/Inter-Regular.ttf"), "{message}");
        assert!(message.contains("no está"), "{message}");
    }

    #[test]
    fn a_file_that_is_not_a_font_is_rejected() {
        let dir = project_dir();
        fs::write(dir.path().join("fonts/falsa.ttf"), b"esto no es una fuente").expect("escribir");

        let error = GaleraWorld::new(open(&dir), &["fonts/falsa.ttf".to_owned()], String::new())
            .err()
            .expect("un archivo que no es fuente debe fallar");
        assert!(matches!(error, WorldError::InvalidFont { .. }), "{error:?}");
    }

    /// Principio 4, por el otro lado: una fuente no puede cargarse desde
    /// fuera del proyecto. Las variantes de ruta las cubre `project`; aquí
    /// basta con ver que el error llega como error de fuente.
    #[test]
    fn a_font_path_cannot_leave_the_project() {
        let dir = project_dir();
        for path in ["/System/Library/Fonts/Helvetica.ttc", "../fuera.ttf"] {
            let error = GaleraWorld::new(open(&dir), &[path.to_owned()], String::new())
                .err()
                .unwrap_or_else(|| panic!("{path:?} debe rechazarse"));
            assert!(
                matches!(error, WorldError::FontOutsideProject { .. }),
                "{path:?}: {error:?}"
            );
        }
    }

    // ── Archivo principal ───────────────────────────────────────────────

    #[test]
    fn the_main_source_is_the_generated_code() {
        let dir = project_dir();
        let world = world(&dir, &[], "= Hola");

        let main = world
            .source(world.main())
            .expect("el principal siempre existe");
        assert_eq!(main.text(), "= Hola");

        let bytes = world.file(world.main()).expect("y también como bytes");
        assert_eq!(bytes.as_slice(), b"= Hola");
    }

    #[test]
    fn other_typst_files_cannot_be_imported() {
        let dir = project_dir();
        fs::write(dir.path().join("otro.typ"), "hola").expect("escribir");
        let world = world(&dir, &[], "");

        assert!(matches!(
            world.source(file_id("/otro.typ")),
            Err(FileError::AccessDenied)
        ));
    }

    // ── Archivos del proyecto ───────────────────────────────────────────

    /// El criterio de la tarea: `file` devuelve los bytes de los recursos.
    #[test]
    fn it_serves_project_assets() {
        let dir = project_dir();
        let world = world(&dir, &[], "");

        let expected = fs::read(dir.path().join("assets/pixel.png")).expect("leer");
        let bytes = world
            .file(file_id("/assets/pixel.png"))
            .expect("debe servirse");
        assert_eq!(bytes.as_slice(), expected.as_slice());
    }

    #[test]
    fn a_missing_asset_is_not_found_with_its_relative_path() {
        let dir = project_dir();
        let world = world(&dir, &[], "");

        match world.file(file_id("/assets/portada.png")) {
            Err(FileError::NotFound(path)) => {
                assert_eq!(path, PathBuf::from("assets/portada.png"))
            }
            other => panic!("se esperaba NotFound con la ruta relativa: {other:?}"),
        }
    }

    #[test]
    fn a_directory_is_not_a_file() {
        let dir = project_dir();
        let world = world(&dir, &[], "");
        assert!(matches!(
            world.file(file_id("/assets")),
            Err(FileError::IsDirectory)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn an_asset_symlink_pointing_outside_is_denied() {
        let outside = TempDir::new().expect("carpeta temporal");
        fs::write(outside.path().join("secreto.png"), b"no deberias leer esto").expect("escribir");

        let dir = project_dir();
        std::os::unix::fs::symlink(
            outside.path().join("secreto.png"),
            dir.path().join("assets/enlace.png"),
        )
        .expect("crear enlace");

        let world = world(&dir, &[], "");
        assert!(matches!(
            world.file(file_id("/assets/enlace.png")),
            Err(FileError::AccessDenied)
        ));
    }

    #[test]
    fn the_file_cache_can_be_cleared() {
        let dir = project_dir();
        let world = world(&dir, &[], "");
        let id = file_id("/assets/pixel.svg");

        let before = world.file(id).expect("debe servirse");
        fs::write(dir.path().join("assets/pixel.svg"), b"<svg/>").expect("reemplazar");

        assert_eq!(
            world.file(id).expect("sigue en caché").as_slice(),
            before.as_slice(),
            "sin limpiar, la caché devuelve lo que leyó"
        );

        world.clear_file_cache();
        assert_eq!(world.file(id).expect("se relee").as_slice(), b"<svg/>");
    }

    // ── Compilación de extremo a extremo ────────────────────────────────

    /// La prueba de que `GaleraWorld` cumple el contrato de verdad: el
    /// compilador de Typst lo acepta y compone un documento generado por el
    /// codegen de Galera.
    #[test]
    fn typst_compiles_a_generated_document_with_this_world() {
        let dir = project_dir();
        let compiled = compile_json(
            &dir,
            r##"{
              "version": 1,
              "meta": { "title": "Prueba" },
              "fonts": ["fonts/LibertinusSerif-Regular.otf"],
              "pages": [
                {
                  "id": "p1",
                  "size": { "width": 210, "height": 297, "unit": "mm" },
                  "elements": [
                    { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 210, "h": 15,
                      "fill": "#1e40af", "stroke": null },
                    { "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": null,
                      "content": [{ "text": "Informe #anual\n(con salto) y *sin* marcado" }],
                      "style": { "font": "Libertinus Serif", "size": 28, "color": "#1F2733" } },
                    { "id": "c1", "type": "code", "x": 20, "y": 200, "w": 170, "h": 40,
                      "source": "#table(columns: 2)[A][B]" }
                  ]
                },
                {
                  "id": "p2",
                  "size": { "width": 148, "height": 210, "unit": "mm" },
                  "elements": [
                    { "id": "l1", "type": "line", "x": 10, "y": 10, "x2": 100, "y2": 10,
                      "stroke": { "color": "#000000", "width": 0.5 } }
                  ]
                }
              ]
            }"##,
        );

        let document = compiled
            .output
            .unwrap_or_else(|errors| panic!("debe compilar sin errores: {errors:#?}"));
        let pages = document.pages();
        assert_eq!(
            pages.len(),
            2,
            "tantas páginas como el modelo, ni una en blanco de más"
        );

        let size = |index: usize| {
            let frame = &pages[index].frame;
            (
                frame.width().to_mm().round(),
                frame.height().to_mm().round(),
            )
        };
        assert_eq!(size(0), (210.0, 297.0));
        assert_eq!(size(1), (148.0, 210.0));
    }

    /// El criterio que tenía pendiente F0-08: PNG, JPEG y SVG se cargan y se
    /// componen de verdad.
    #[test]
    fn png_jpeg_and_svg_images_compile() {
        let dir = project_dir();
        let compiled = compile_json(
            &dir,
            r#"{
              "version": 1,
              "meta": { "title": "Imágenes" },
              "assets": {
                "png": "assets/pixel.png",
                "jpg": "assets/pixel.jpg",
                "svg": "assets/pixel.svg"
              },
              "pages": [{
                "id": "p1",
                "size": { "width": 210, "height": 297, "unit": "mm" },
                "elements": [
                  { "id": "i1", "type": "image", "x": 10, "y": 10, "w": 40, "h": null, "asset": "png" },
                  { "id": "i2", "type": "image", "x": 60, "y": 10, "w": 40, "h": null, "asset": "jpg" },
                  { "id": "i3", "type": "image", "x": 110, "y": 10, "w": 40, "h": 20, "asset": "svg" }
                ]
              }]
            }"#,
        );

        let document = compiled
            .output
            .unwrap_or_else(|errors| panic!("las tres imágenes deben compilar: {errors:#?}"));
        assert_eq!(document.pages().len(), 1);
    }

    /// El criterio de la tarea: un recurso declarado pero ausente del disco
    /// produce un error que cae en la línea de la imagen que lo usa, así que
    /// se puede atribuir a su elemento.
    #[test]
    fn a_missing_asset_file_is_attributable_to_its_element() {
        let dir = project_dir();
        let compiled = compile_json(
            &dir,
            r#"{
              "version": 1,
              "meta": { "title": "Falta una imagen" },
              "assets": { "portada": "assets/portada.png", "logo": "assets/pixel.png" },
              "pages": [{
                "id": "p1",
                "size": { "width": 210, "height": 297, "unit": "mm" },
                "elements": [
                  { "id": "i1", "type": "image", "x": 0, "y": 0, "w": 40, "h": null, "asset": "logo" },
                  { "id": "i2", "type": "image", "x": 0, "y": 50, "w": 40, "h": null, "asset": "portada" }
                ]
              }]
            }"#,
        );

        let errors = compiled
            .output
            .as_ref()
            .expect_err("una imagen ausente debe fallar al compilar");
        assert_eq!(errors.len(), 1, "{errors:#?}");

        let line = line_of(&compiled, &errors[0]).expect("el error tiene posición");
        assert!(
            line.contains("<el-i2>"),
            "el error debe caer en la línea de i2: {line}"
        );
        assert!(
            errors[0].message.contains("assets/portada.png"),
            "el mensaje debe nombrar la ruta relativa: {}",
            errors[0].message
        );
    }

    /// El criterio de la tarea, de extremo a extremo: un documento que
    /// declara `../../etc/passwd` como recurso no compila, no hace `panic!`
    /// y no lee nada.
    #[test]
    fn a_document_pointing_at_etc_passwd_fails_cleanly() {
        let dir = project_dir();
        let compiled = compile_json(
            &dir,
            r#"{
              "version": 1,
              "meta": { "title": "Hostil" },
              "assets": { "x": "../../etc/passwd" },
              "pages": [{
                "id": "p1",
                "size": { "width": 210, "height": 297, "unit": "mm" },
                "elements": [
                  { "id": "i1", "type": "image", "x": 0, "y": 0, "w": 40, "h": null, "asset": "x" }
                ]
              }]
            }"#,
        );

        assert!(
            compiled.output.is_err(),
            "un recurso fuera del proyecto no puede compilar"
        );
    }

    /// Compila un documento con un único bloque de código personalizado.
    fn compile_code_block(dir: &TempDir, code: &str) -> Compiled {
        let source = serde_json::to_string(code).expect("un str siempre serializa");
        compile_json(
            dir,
            &format!(
                r#"{{
                  "version": 1,
                  "meta": {{ "title": "Código" }},
                  "pages": [{{
                    "id": "p1",
                    "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                    "elements": [
                      {{ "id": "c1", "type": "code", "x": 0, "y": 0, "w": 50, "h": null,
                         "source": {source} }}
                    ]
                  }}]
                }}"#
            ),
        )
    }

    /// El criterio que tenía pendiente F0-09. Un bloque de código con un error
    /// de sintaxis produce un único error, en la línea de su elemento, así que
    /// se puede atribuir.
    ///
    /// Y fija lo que Typst no permite: con un error, no hay documento. Seguir
    /// enseñando el resto del lienzo es trabajo de F1-12.
    #[test]
    fn a_broken_code_block_error_is_attributable_to_its_element() {
        let dir = project_dir();
        let compiled = compile_json(
            &dir,
            r##"{
              "version": 1,
              "meta": { "title": "Bloque roto" },
              "pages": [{
                "id": "p1",
                "size": { "width": 210, "height": 297, "unit": "mm" },
                "elements": [
                  { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                    "fill": "#000000", "stroke": null },
                  { "id": "c1", "type": "code", "x": 0, "y": 20, "w": 50, "h": null,
                    "source": "#table(columns: 2)[A]] ]" },
                  { "id": "r2", "type": "rect", "x": 0, "y": 40, "w": 10, "h": 10,
                    "fill": "#000000", "stroke": null }
                ]
              }]
            }"##,
        );

        let errors = compiled
            .output
            .as_ref()
            .expect_err("Typst no produce documento cuando hay un error");
        assert_eq!(
            errors.len(),
            1,
            "un solo error, no una cascada: {errors:#?}"
        );

        let line = line_of(&compiled, &errors[0]).expect("el error tiene posición");
        assert!(
            line.contains("<el-c1>"),
            "el error debe caer en la línea de c1: {line}"
        );
    }

    /// El código de un bloque personalizado **sí** puede leer archivos del
    /// proyecto: en Typst 0.15.1, `eval` no quita el acceso a disco. Es una
    /// capacidad, no un agujero, porque la frontera no es `eval` sino
    /// `Project::read`. Si una versión de Typst lo cambia, esta prueba avisa.
    #[test]
    fn custom_code_can_read_files_inside_the_project() {
        let dir = project_dir();
        for code in [
            r#"#image("assets/pixel.png")"#,
            r#"#image("/assets/pixel.png")"#,
            r#"#read("assets/pixel.svg")"#,
        ] {
            let compiled = compile_code_block(&dir, code);
            assert!(
                compiled.output.is_ok(),
                "{code} debería compilar: {:#?}",
                compiled.output.err()
            );
        }
    }

    /// Lo que de verdad importa para `SECURITY.md`: el código que trae un
    /// documento ajeno no puede leer nada fuera de la carpeta del proyecto,
    /// ni subiendo, ni por ruta absoluta, ni por un enlace, ni descargando
    /// paquetes.
    #[cfg(unix)]
    #[test]
    fn custom_code_cannot_read_outside_the_project() {
        let outside = TempDir::new().expect("carpeta temporal");
        fs::write(outside.path().join("secreto.txt"), b"SECRETO").expect("escribir");

        let dir = project_dir();
        std::os::unix::fs::symlink(
            outside.path().join("secreto.txt"),
            dir.path().join("assets/enlace.txt"),
        )
        .expect("crear enlace");

        let absolute_secret = outside.path().join("secreto.txt");
        let attempts = [
            r#"#read("../../etc/passwd")"#.to_owned(),
            r#"#read("/etc/passwd")"#.to_owned(),
            r#"#read("assets/enlace.txt")"#.to_owned(),
            format!(r#"#read("{}")"#, absolute_secret.display()),
            r#"#import "@preview/cetz:0.3.0""#.to_owned(),
        ];

        for code in &attempts {
            let compiled = compile_code_block(&dir, code);
            assert!(
                compiled.output.is_err(),
                "{code} no debe poder leer fuera del proyecto"
            );
        }
    }

    // ── Fecha ───────────────────────────────────────────────────────────

    #[test]
    fn today_is_a_real_date() {
        let dir = project_dir();
        let world = world(&dir, &[], "");

        let today = world.today(None).expect("hay fecha");
        assert!(today.year().is_some_and(|year| year >= 2026), "{today:?}");
    }

    #[test]
    fn civil_from_days_matches_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(20_712), (2026, 9, 16));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}
