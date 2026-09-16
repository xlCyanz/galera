//! El entorno en el que compila Typst.
//!
//! El compilador de Typst no lee nada por su cuenta: todo lo que necesita
//! —el archivo principal, las fuentes, la biblioteca estándar, la fecha— lo
//! pide a través del trait [`World`]. Este módulo es la implementación de
//! Galera, y es uno de los tres sitios donde se permite usar `typst::*`
//! (principio 5 del README); los otros dos son `compile` y `layout`.
//!
//! # Las fuentes viajan con el documento
//!
//! [`GaleraWorld`] carga **solo** las fuentes que el documento declara, desde
//! la carpeta del proyecto. Nunca consulta las fuentes instaladas en la
//! máquina: un documento que se ve bien en un ordenador tiene que verse
//! exactamente igual en cualquier otro (principio 4). Si una fuente no está,
//! es un error al abrir, no un cambio silencioso de tipografía.
//!
//! # Rutas
//!
//! Una ruta declarada en el documento tiene que quedarse dentro de la
//! carpeta del proyecto. Se rechazan las absolutas, las que suben con `..` y
//! las que salen por un enlace simbólico. Lo hace `resolve_in_project`, que
//! F0-11 reutilizará para servir imágenes y demás archivos.
//!
//! # Lo que todavía no hace
//!
//! [`World::file`] y [`World::source`] solo sirven el archivo principal. Para
//! cualquier otro devuelven [`FileError::AccessDenied`]: abrir el acceso a los
//! archivos del proyecto, con sus comprobaciones, es la tarea F0-11. Hasta
//! entonces, un documento con imágenes no compila.
//!
//! # Nota de Rust
//!
//! Un *trait* es un contrato: una lista de métodos que un tipo se compromete
//! a implementar. `World` es el contrato entre Typst y quien lo usa. Typst
//! no sabe nada de `GaleraWorld`; solo sabe llamar a esos siete métodos.

use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

/// Ruta virtual del archivo principal, el que genera el codegen.
///
/// No existe en disco: su contenido vive en memoria y se regenera en cada
/// compilación.
const MAIN_PATH: &str = "/main.typ";

/// Algo impide preparar el entorno de compilación.
///
/// En F0-16 este enum se absorbe dentro del error único del núcleo.
#[derive(Debug)]
pub enum WorldError {
    /// La carpeta del proyecto no existe o no se puede abrir.
    ProjectNotFound {
        /// La ruta que se pidió.
        root: PathBuf,
        /// El error del sistema de archivos.
        source: io::Error,
    },

    /// Una fuente declarada no está en la carpeta del proyecto.
    FontNotFound {
        /// La ruta tal como la declara el documento.
        path: String,
    },

    /// Una fuente declarada apunta fuera de la carpeta del proyecto.
    FontOutsideProject {
        /// La ruta tal como la declara el documento.
        path: String,
    },

    /// Una fuente existe pero no se puede leer.
    FontUnreadable {
        /// La ruta tal como la declara el documento.
        path: String,
        /// El error del sistema de archivos.
        source: io::Error,
    },

    /// Un archivo declarado como fuente no contiene ninguna fuente válida.
    InvalidFont {
        /// La ruta tal como la declara el documento.
        path: String,
    },

    /// La ruta virtual del archivo principal no es válida.
    ///
    /// Es una constante, así que no debería ocurrir nunca: solo pasaría si una
    /// versión nueva de Typst cambiara las reglas de las rutas virtuales.
    InvalidMainPath,
}

impl fmt::Display for WorldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorldError::ProjectNotFound { root, .. } => write!(
                f,
                "no se puede abrir la carpeta del proyecto {}",
                root.display()
            ),
            WorldError::FontNotFound { path } => write!(
                f,
                "el documento declara la fuente {path:?}, pero no está en la carpeta del proyecto"
            ),
            WorldError::FontOutsideProject { path } => write!(
                f,
                "la fuente {path:?} apunta fuera de la carpeta del proyecto; las fuentes tienen que viajar con el documento"
            ),
            WorldError::FontUnreadable { path, .. } => {
                write!(f, "la fuente {path:?} existe pero no se puede leer")
            }
            WorldError::InvalidFont { path } => write!(
                f,
                "el archivo {path:?} no contiene ninguna fuente que Typst sepa leer"
            ),
            WorldError::InvalidMainPath => write!(
                f,
                "error interno: la ruta del archivo principal {MAIN_PATH:?} no es válida para esta versión de Typst"
            ),
        }
    }
}

impl std::error::Error for WorldError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            WorldError::ProjectNotFound { source, .. }
            | WorldError::FontUnreadable { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// El entorno de compilación de un proyecto de Galera.
///
/// Se crea una vez por proyecto abierto. Las fuentes se cargan al crearlo y
/// se reutilizan en cada compilación: no cambian mientras se edita.
pub struct GaleraWorld {
    /// Carpeta del proyecto, ya resuelta a su ruta real.
    root: PathBuf,
    /// La biblioteca estándar de Typst.
    library: LazyHash<Library>,
    /// Índice de las fuentes cargadas, que Typst consulta para elegir.
    book: LazyHash<FontBook>,
    /// Las fuentes, en el mismo orden que el índice.
    fonts: Vec<Font>,
    /// El archivo principal: el código Typst que genera el codegen.
    main: Source,
}

impl GaleraWorld {
    /// Prepara el entorno de un proyecto.
    ///
    /// - `root`: la carpeta del proyecto.
    /// - `fonts`: las rutas de fuente que declara el documento, relativas a
    ///   `root`. Son las únicas fuentes que Typst verá.
    /// - `main`: el código Typst que se va a compilar.
    ///
    /// # Errores
    ///
    /// Falla si la carpeta no existe, o si alguna fuente no está, apunta
    /// fuera del proyecto, no se puede leer o no es una fuente.
    pub fn new(root: &Path, fonts: &[String], main: String) -> Result<Self, WorldError> {
        let root = root
            .canonicalize()
            .map_err(|source| WorldError::ProjectNotFound {
                root: root.to_owned(),
                source,
            })?;

        let fonts = load_fonts(&root, fonts)?;
        let book = FontBook::from_fonts(&fonts);

        let main_path = VirtualPath::new(MAIN_PATH).map_err(|_| WorldError::InvalidMainPath)?;
        let main_id = FileId::new(RootedPath::new(VirtualRoot::Project, main_path));

        Ok(Self {
            root,
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(book),
            fonts,
            main: Source::new(main_id, main),
        })
    }

    /// La carpeta del proyecto, resuelta a su ruta real.
    pub fn root(&self) -> &Path {
        &self.root
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
            // Importar otros archivos `.typ` del proyecto llega con F0-11.
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main.id() {
            // `Source` es un puntero compartido: esto no copia el texto.
            Ok(Bytes::from_string(self.main.clone()))
        } else {
            // Servir imágenes y demás archivos del proyecto llega con F0-11,
            // junto con las comprobaciones de ruta que eso exige.
            Err(FileError::AccessDenied)
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
fn load_fonts(root: &Path, declared: &[String]) -> Result<Vec<Font>, WorldError> {
    let mut fonts = Vec::new();

    for path in declared {
        let resolved = resolve_in_project(root, path).map_err(|error| match error {
            ResolveError::Outside => WorldError::FontOutsideProject { path: path.clone() },
            ResolveError::NotFound => WorldError::FontNotFound { path: path.clone() },
            ResolveError::Io(source) => WorldError::FontUnreadable {
                path: path.clone(),
                source,
            },
        })?;

        let data = std::fs::read(&resolved).map_err(|source| WorldError::FontUnreadable {
            path: path.clone(),
            source,
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

/// Por qué una ruta no se pudo resolver dentro del proyecto.
#[derive(Debug)]
pub(crate) enum ResolveError {
    /// La ruta es absoluta, sube con `..` o sale por un enlace simbólico.
    Outside,
    /// La ruta es válida pero no hay nada ahí.
    NotFound,
    /// Otro error del sistema de archivos.
    Io(io::Error),
}

/// Resuelve una ruta declarada en el documento a una ruta real dentro de la
/// carpeta del proyecto.
///
/// `root` tiene que estar ya resuelta con `canonicalize`.
///
/// Se comprueba en dos pasos, y los dos hacen falta:
///
/// 1. **Léxico**, antes de tocar el disco: nada de rutas absolutas ni de
///    componentes `..`. Así ni siquiera se consulta si existe algo fuera.
/// 2. **Real**, después de resolver enlaces simbólicos: el resultado tiene
///    que seguir dentro de `root`. Un `fonts/x.ttf` puede ser un enlace a
///    `/System/Library/Fonts`, y eso el primer paso no lo ve.
pub(crate) fn resolve_in_project(root: &Path, declared: &str) -> Result<PathBuf, ResolveError> {
    let relative = Path::new(declared);

    let lexically_inside = !declared.is_empty()
        && relative
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));

    if !lexically_inside {
        return Err(ResolveError::Outside);
    }

    let resolved = root
        .join(relative)
        .canonicalize()
        .map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => ResolveError::NotFound,
            _ => ResolveError::Io(error),
        })?;

    if !resolved.starts_with(root) {
        return Err(ResolveError::Outside);
    }

    Ok(resolved)
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

    use tempfile::TempDir;
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

    /// Un proyecto temporal con una fuente dentro de `fonts/`.
    fn project_with_font() -> TempDir {
        let dir = TempDir::new().expect("se puede crear una carpeta temporal");
        fs::create_dir(dir.path().join("fonts")).expect("se puede crear fonts/");
        fs::write(
            dir.path().join("fonts/LibertinusSerif-Regular.otf"),
            libertinus_regular(),
        )
        .expect("se puede escribir la fuente");
        dir
    }

    fn fonts(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| (*path).to_owned()).collect()
    }

    #[test]
    fn it_loads_the_declared_fonts_from_the_project() {
        let project = project_with_font();
        let world = GaleraWorld::new(
            project.path(),
            &fonts(&["fonts/LibertinusSerif-Regular.otf"]),
            String::new(),
        )
        .expect("el entorno debe prepararse");

        assert!(world.book().contains_family("libertinus serif"));
        assert!(world.font(0).is_some());
    }

    /// Principio 4: sin fuentes declaradas, Typst no ve ninguna. Ni las del
    /// sistema ni ninguna otra.
    #[test]
    fn without_declared_fonts_typst_sees_none() {
        let project = TempDir::new().expect("carpeta temporal");
        let world = GaleraWorld::new(project.path(), &[], String::new()).expect("debe prepararse");

        assert_eq!(world.book().families().count(), 0);
        assert!(world.font(0).is_none());
    }

    /// El índice puede llegar fuera de rango durante la compilación
    /// incremental; tiene que devolver `None`, no hacer `panic!`.
    #[test]
    fn an_out_of_range_font_index_is_none() {
        let project = project_with_font();
        let world = GaleraWorld::new(
            project.path(),
            &fonts(&["fonts/LibertinusSerif-Regular.otf"]),
            String::new(),
        )
        .expect("debe prepararse");
        assert!(world.font(9_999).is_none());
    }

    #[test]
    fn a_declared_font_that_is_missing_is_a_clear_error() {
        let project = TempDir::new().expect("carpeta temporal");
        let error = GaleraWorld::new(
            project.path(),
            &fonts(&["fonts/Inter-Regular.ttf"]),
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
        let project = TempDir::new().expect("carpeta temporal");
        fs::create_dir(project.path().join("fonts")).expect("fonts/");
        fs::write(
            project.path().join("fonts/falsa.ttf"),
            b"esto no es una fuente",
        )
        .expect("escribir");

        let error = GaleraWorld::new(project.path(), &fonts(&["fonts/falsa.ttf"]), String::new())
            .err()
            .expect("un archivo que no es fuente debe fallar");
        assert!(matches!(error, WorldError::InvalidFont { .. }), "{error:?}");
    }

    #[test]
    fn a_missing_project_folder_is_a_clear_error() {
        let error = GaleraWorld::new(Path::new("/no/existe/este/proyecto"), &[], String::new())
            .err()
            .expect("una carpeta inexistente debe fallar");
        assert!(
            matches!(error, WorldError::ProjectNotFound { .. }),
            "{error:?}"
        );
    }

    /// Principio 4, por el otro lado: una fuente no puede cargarse desde
    /// fuera del proyecto, ni por ruta absoluta ni subiendo con `..`.
    #[test]
    fn a_font_path_cannot_leave_the_project() {
        let project = project_with_font();

        for path in [
            "/System/Library/Fonts/Helvetica.ttc",
            "../fuera.ttf",
            "fonts/../../fuera.ttf",
            "",
        ] {
            let error = GaleraWorld::new(project.path(), &fonts(&[path]), String::new())
                .err()
                .unwrap_or_else(|| panic!("{path:?} debe rechazarse"));
            assert!(
                matches!(error, WorldError::FontOutsideProject { .. }),
                "{path:?}: {error:?}"
            );
        }
    }

    /// Un enlace simbólico dentro de `fonts/` que apunta fuera del proyecto
    /// pasa la comprobación léxica; la real tiene que pararlo.
    #[cfg(unix)]
    #[test]
    fn a_font_symlink_cannot_leave_the_project() {
        let outside = TempDir::new().expect("carpeta temporal");
        fs::write(outside.path().join("sistema.otf"), libertinus_regular()).expect("escribir");

        let project = TempDir::new().expect("carpeta temporal");
        fs::create_dir(project.path().join("fonts")).expect("fonts/");
        std::os::unix::fs::symlink(
            outside.path().join("sistema.otf"),
            project.path().join("fonts/enlace.otf"),
        )
        .expect("crear enlace");

        let error = GaleraWorld::new(project.path(), &fonts(&["fonts/enlace.otf"]), String::new())
            .err()
            .expect("un enlace hacia fuera debe rechazarse");
        assert!(
            matches!(error, WorldError::FontOutsideProject { .. }),
            "{error:?}"
        );
    }

    #[test]
    fn a_path_with_a_current_dir_component_is_fine() {
        let project = project_with_font();
        let world = GaleraWorld::new(
            project.path(),
            &fonts(&["./fonts/LibertinusSerif-Regular.otf"]),
            String::new(),
        );
        assert!(world.is_ok(), "{:?}", world.err());
    }

    #[test]
    fn the_main_source_is_the_generated_code() {
        let project = TempDir::new().expect("carpeta temporal");
        let world =
            GaleraWorld::new(project.path(), &[], "= Hola".to_owned()).expect("debe prepararse");

        let main = world
            .source(world.main())
            .expect("el principal siempre existe");
        assert_eq!(main.text(), "= Hola");

        let bytes = world.file(world.main()).expect("y también como bytes");
        assert_eq!(bytes.as_slice(), b"= Hola");
    }

    #[test]
    fn any_other_file_is_denied_until_f0_11() {
        let project = TempDir::new().expect("carpeta temporal");
        fs::write(project.path().join("otro.typ"), "hola").expect("escribir");
        let world = GaleraWorld::new(project.path(), &[], String::new()).expect("debe prepararse");

        let other = FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new("/otro.typ").expect("ruta válida"),
        ));
        assert!(matches!(world.file(other), Err(FileError::AccessDenied)));
        assert!(matches!(world.source(other), Err(FileError::AccessDenied)));
    }

    #[test]
    fn today_is_a_real_date() {
        let project = TempDir::new().expect("carpeta temporal");
        let world = GaleraWorld::new(project.path(), &[], String::new()).expect("debe prepararse");

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

    /// La prueba de que `GaleraWorld` cumple el contrato de verdad: el
    /// compilador de Typst lo acepta y compone un documento generado por el
    /// codegen de Galera. Es también la primera vez que ese código se compila.
    #[test]
    fn typst_compiles_a_generated_document_with_this_world() {
        let json = r##"{
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
        }"##;

        let document = Document::from_json_str(json).expect("debe deserializar");
        let source = codegen::generate(&document).expect("debe generar código");

        let project = project_with_font();
        let world = GaleraWorld::new(project.path(), &document.fonts, source)
            .expect("el entorno debe prepararse");

        let result = typst::compile::<PagedDocument>(&world);
        let compiled = result.output.unwrap_or_else(|errors| {
            panic!("el código generado debe compilar sin errores: {errors:#?}")
        });

        assert_eq!(
            result.warnings.len(),
            0,
            "sin avisos, y en particular sin fuentes desconocidas: {:#?}",
            result.warnings
        );

        let pages = compiled.pages();
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
}
