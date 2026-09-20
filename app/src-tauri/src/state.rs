//! El estado compartido de la app.
//!
//! Guarda lo que la app tiene abierto: el proyecto, su documento y el último
//! resultado de compilación. No sabe hacer nada con ello: validar, generar
//! código, compilar y exportar son cosas de `galera-core` (principio 5 del
//! README). Este módulo solo decide **quién puede tocar qué y cuándo**.
//!
//! # Nota de Rust
//!
//! Tauri atiende cada comando desde un hilo, y varios pueden llegar a la vez.
//! Para compartir datos entre hilos hacen falta dos cosas:
//!
//! - que Tauri guarde el estado y se lo pase a cada comando: eso es
//!   `.manage(AppState::default())` al arrancar y `State<'_, AppState>` en
//!   la firma del comando;
//! - que dos hilos no lo modifiquen a la vez: eso es el [`RwLock`], que deja
//!   leer a muchos o escribir a uno solo.
//!
//! # No bloquear mientras se compila
//!
//! Compilar tarda. Si un comando compilara con el cerrojo cogido, cualquier
//! otro comando —abrir, mover un elemento— esperaría a que terminase, y la
//! interfaz se quedaría congelada. Por eso [`AppState::compilation_with`] hace
//! tres pasos y el cerrojo solo se coge en el primero y el último:
//!
//! 1. **copia** el proyecto y el documento, con el cerrojo;
//! 2. **compila** la copia, sin cerrojo;
//! 3. **guarda** el resultado, con el cerrojo, pero solo si el documento no
//!    cambió entretanto. Si cambió, el resultado ya no corresponde a lo que
//!    hay abierto y se descarta.
//!
//! Para saber si cambió, cada cambio del documento incrementa una
//! **revisión**.
//!
//! # Compilar una vez por revisión
//!
//! El resultado se guarda **salga bien o mal**, y mientras la revisión no
//! cambie se reutiliza: pedir las diez páginas de un documento compila una
//! vez, no diez, y un documento con errores tampoco se recompila en cada
//! petición.
//!
//! Si llegan varias peticiones a la vez y no hay nada guardado, solo una
//! compila. Las demás esperan en un segundo cerrojo, `compiling`, que no es
//! el del estado: mientras esperan, el resto de comandos sigue funcionando.
//! Cuando les toca, encuentran el resultado ya guardado.
//!
//! # Carpetas elegidas
//!
//! El estado también recuerda qué carpetas ha elegido quien usa la app en el
//! diálogo nativo de abrir. Son las únicas que se pueden abrir: ver
//! [`crate::commands::project`].

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

use galera_core::{Compiled, Document, GaleraError, History, Op, Project};

/// El estado de la app, compartido entre todos los comandos.
#[derive(Default)]
pub struct AppState {
    session: RwLock<Session>,
    /// Lo coge quien compila, para que dos peticiones a la vez no compilen
    /// lo mismo dos veces. Ver el módulo.
    compiling: Mutex<()>,
    /// Las carpetas elegidas en el diálogo de abrir, con su ruta real.
    chosen_folders: Mutex<HashSet<PathBuf>>,
    /// Los archivos soltados sobre la ventana o elegidos en un diálogo, con
    /// su ruta real: los únicos que la interfaz puede pedir que se copien
    /// al proyecto.
    offered_files: Mutex<HashSet<PathBuf>>,
}

/// Lo que hay abierto.
#[derive(Default)]
struct Session {
    /// El proyecto y su documento, si hay uno abierto.
    open: Option<OpenDocument>,
    /// El `.galera` del que salió y al que se guarda, si viene de uno.
    archive: Option<PathBuf>,
    /// La revisión con la que se guardó por última vez: si no es la actual,
    /// hay cambios sin guardar.
    saved_revision: u64,
    /// La revisión de la última copia de autoguardado.
    autosaved_revision: u64,
    /// Cuándo cambió el documento por última vez, para no autoguardar en
    /// mitad de un arrastre.
    changed_at: Option<Instant>,
    /// El historial de deshacer y rehacer del documento abierto.
    history: History,
    /// Se incrementa con cada cambio del documento abierto.
    revision: u64,
    /// La última compilación guardada.
    compiled: Option<Stored>,
    /// La última compilación que salió bien del documento abierto: la que se
    /// ve en el lienzo, también mientras hay errores.
    last_good: Option<Arc<Compiled>>,
}

/// Una compilación guardada.
struct Stored {
    revision: u64,
    result: CompileResult,
    duration: Duration,
}

/// Lo que produce compilar: el documento compilado o por qué no se pudo.
///
/// Los dos lados van en `Arc` para poder guardarlos y devolverlos a la vez
/// sin copiarlos: ni `Compiled` ni `GaleraError` se pueden clonar.
pub type CompileResult = Result<Arc<Compiled>, Arc<GaleraError>>;

/// Un proyecto abierto con su documento.
#[derive(Clone)]
struct OpenDocument {
    project: Project,
    document: Document,
}

/// Un cambio del documento abierto: aplicar un comando, deshacer o rehacer.
#[derive(Debug, Clone, PartialEq)]
pub struct Edited {
    /// La revisión con la que queda el documento.
    pub revision: u64,
    /// El documento con el cambio.
    pub document: Document,
    /// Qué se ha hecho, deshecho o rehecho: «Mover r1».
    pub description: String,
    /// Qué se desharía ahora, si hay algo.
    pub undo: Option<String>,
    /// Qué se reharía ahora, si hay algo.
    pub redo: Option<String>,
}

/// Lo que se sabe del estado sin compilar nada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    /// El título del documento abierto, si hay uno.
    pub title: Option<String>,
    /// La carpeta del proyecto abierto, si hay uno.
    pub root: Option<PathBuf>,
    /// Cuántas páginas tiene el documento abierto.
    pub page_count: usize,
    /// La revisión actual.
    pub revision: u64,
    /// El `.galera` al que se guarda, si el proyecto viene de uno.
    pub archive: Option<PathBuf>,
    /// Si hay cambios sin guardar.
    pub dirty: bool,
    /// Si la última compilación guardada corresponde a la revisión actual.
    pub compiled_is_current: bool,
}

/// El resultado de compilar una revisión del documento abierto.
pub struct Compilation {
    /// De qué revisión sale.
    pub revision: u64,
    /// El documento compilado, o por qué no se pudo compilar.
    pub result: CompileResult,
    /// Lo que tardó en compilar.
    pub duration: Duration,
    /// `true` si sale de una compilación guardada, sin compilar ahora.
    pub reused: bool,
    /// `false` si el documento cambió mientras se compilaba: el resultado es
    /// correcto para aquella revisión, pero ya no se ha guardado.
    pub is_current: bool,
}

impl AppState {
    /// Abre un proyecto con su documento, sustituyendo lo que hubiera.
    /// Devuelve la revisión nueva.
    pub fn open(&self, project: Project, document: Document) -> u64 {
        self.open_from(project, document, None)
    }

    /// Como [`AppState::open`], diciendo además de qué `.galera` sale, si
    /// sale de uno: es a donde se guardará.
    pub fn open_from(&self, project: Project, document: Document, archive: Option<PathBuf>) -> u64 {
        let mut session = self.write();
        session.open = Some(OpenDocument { project, document });
        session.archive = archive;
        session.history.clear();
        session.revision += 1;
        session.saved_revision = session.revision;
        session.autosaved_revision = session.revision;
        session.changed_at = None;
        session.compiled = None;
        session.last_good = None;
        session.revision
    }

    /// Cambia dónde se guarda el proyecto abierto, sin tocar el documento ni
    /// el historial: es lo que hace «Guardar como».
    ///
    /// `None` en `archive` significa que se guarda como carpeta.
    pub fn save_to(&self, project: Project, archive: Option<PathBuf>) -> Option<u64> {
        let mut session = self.write();
        let open = session.open.as_mut()?;
        open.project = project;
        session.archive = archive;
        session.saved_revision = session.revision;
        Some(session.revision)
    }

    /// Anota que el documento se ha guardado tal como está ahora.
    /// Devuelve la revisión guardada.
    pub fn mark_saved(&self) -> Option<u64> {
        let mut session = self.write();
        session.open.as_ref()?;
        session.saved_revision = session.revision;
        Some(session.revision)
    }

    /// El `.galera` al que se guarda, si lo hay.
    pub fn archive(&self) -> Option<PathBuf> {
        self.read().archive.clone()
    }

    /// Lo que habría que autoguardar, si toca: el proyecto (su `.galera` o
    /// su carpeta), la carpeta de trabajo, el documento y su revisión.
    ///
    /// `None` si no hay nada abierto, si no hay cambios sin guardar, si esa
    /// revisión ya se copió, o si se ha tocado algo hace menos de `idle`.
    pub fn pending_autosave(&self, idle: Duration) -> Option<(PathBuf, PathBuf, Document, u64)> {
        let session = self.read();
        let open = session.open.as_ref()?;
        if session.revision == session.saved_revision
            || session.revision == session.autosaved_revision
        {
            return None;
        }
        if session
            .changed_at
            .is_some_and(|changed| changed.elapsed() < idle)
        {
            return None;
        }
        let root = open.project.root().to_owned();
        Some((
            session.archive.clone().unwrap_or_else(|| root.clone()),
            root,
            open.document.clone(),
            session.revision,
        ))
    }

    /// Sustituye el documento abierto por otro (el de una copia de
    /// autoguardado), como un cambio sin guardar: sube la revisión y olvida
    /// el historial, porque los pasos de antes eran de otro documento.
    ///
    /// Devuelve la revisión nueva y el documento. `None` si no hay nada
    /// abierto.
    pub fn restore(&self, document: Document) -> Option<(u64, Document)> {
        let mut session = self.write();
        let open = session.open.as_mut()?;
        open.document = document.clone();
        session.history.clear();
        session.revision += 1;
        session.changed_at = Some(Instant::now());
        session.compiled = None;
        Some((session.revision, document))
    }

    /// Anota que esa revisión ya está autoguardada.
    pub fn mark_autosaved(&self, revision: u64) {
        self.write().autosaved_revision = revision;
    }

    /// Aplica un comando de edición al documento abierto y lo apunta en el
    /// historial. Con el mismo `group` que el último paso, se junta con él
    /// (ver `galera_core::ops::history`).
    ///
    /// Si se aplica, el documento cambia, la revisión sube y la compilación
    /// guardada deja de valer; la última buena se conserva, porque es la que
    /// sigue viéndose hasta que llegue la nueva.
    ///
    /// # Errores
    ///
    /// [`GaleraError::Op`] si el comando no se puede aplicar, y entonces no
    /// cambia nada. `None` si no hay nada abierto.
    pub fn apply(&self, op: &Op, group: Option<&str>) -> Option<Result<Edited, GaleraError>> {
        self.edit(|history, document| {
            Some(
                history
                    .apply(document, op, group)
                    .map(|document| (document, op.describe())),
            )
        })
        // Aplicar siempre cambia algo o falla: solo queda el `None` de no
        // haber nada abierto.
        .flatten()
    }

    /// Deshace el último paso del historial.
    ///
    /// `None` si no hay nada abierto; `Some(None)` si no hay nada que
    /// deshacer. Como [`AppState::apply`] en lo demás.
    pub fn undo(&self) -> Option<Option<Result<Edited, GaleraError>>> {
        self.edit(|history, document| history.undo(document))
    }

    /// Rehace el último paso deshecho. Como [`AppState::undo`].
    pub fn redo(&self) -> Option<Option<Result<Edited, GaleraError>>> {
        self.edit(|history, document| history.redo(document))
    }

    /// Lo común de aplicar, deshacer y rehacer: cambia el documento abierto
    /// con lo que devuelva `change`, si devuelve algo y sale bien.
    fn edit<F>(&self, change: F) -> Option<Option<Result<Edited, GaleraError>>>
    where
        F: FnOnce(
            &mut History,
            &Document,
        ) -> Option<Result<(Document, String), galera_core::OpError>>,
    {
        let mut session = self.write();
        let session = &mut *session;
        let open = session.open.as_mut()?;
        let (document, description) = match change(&mut session.history, &open.document) {
            // Nada que deshacer o rehacer: hay documento, pero nada cambia.
            None => return Some(None),
            Some(Ok(changed)) => changed,
            Some(Err(error)) => return Some(Some(Err(error.into()))),
        };
        open.document = document.clone();
        session.revision += 1;
        session.changed_at = Some(Instant::now());
        session.compiled = None;
        Some(Some(Ok(Edited {
            revision: session.revision,
            document,
            description,
            undo: session.history.undo_description().map(str::to_owned),
            redo: session.history.redo_description().map(str::to_owned),
        })))
    }

    /// El proyecto y el documento abiertos, copiados, o `None` si no hay nada.
    pub fn open_document(&self) -> Option<(Project, Document)> {
        let session = self.read();
        let open = session.open.as_ref()?;
        Some((open.project.clone(), open.document.clone()))
    }

    /// Añade una fuente, ya copiada en la carpeta del proyecto, a las que
    /// declara el documento abierto. Si ya estaba, no cambia nada.
    ///
    /// No pasa por el historial: declarar una fuente no cambia cómo se ve
    /// ningún elemento, y deshacerlo dejaría textos sin su tipografía.
    ///
    /// `None` si no hay nada abierto.
    pub fn add_font(&self, path: &str) -> Option<Edited> {
        let mut session = self.write();
        let session = &mut *session;
        let open = session.open.as_mut()?;
        if !open.document.fonts.iter().any(|font| font == path) {
            open.document.fonts.push(path.to_owned());
            session.revision += 1;
            session.changed_at = Some(Instant::now());
            session.compiled = None;
        }
        Some(Edited {
            revision: session.revision,
            document: open.document.clone(),
            description: format!("Añadir la fuente {path}"),
            undo: session.history.undo_description().map(str::to_owned),
            redo: session.history.redo_description().map(str::to_owned),
        })
    }

    /// Cierra lo que haya abierto.
    pub fn close(&self) {
        let mut session = self.write();
        session.open = None;
        session.archive = None;
        session.history.clear();
        session.revision += 1;
        session.saved_revision = session.revision;
        session.autosaved_revision = session.revision;
        session.changed_at = None;
        session.compiled = None;
        session.last_good = None;
    }

    /// Un resumen del estado, para la interfaz.
    pub fn summary(&self) -> Summary {
        let session = self.read();
        Summary {
            title: session
                .open
                .as_ref()
                .map(|open| open.document.meta.title.clone()),
            root: session
                .open
                .as_ref()
                .map(|open| open.project.root().to_owned()),
            page_count: session
                .open
                .as_ref()
                .map_or(0, |open| open.document.pages.len()),
            revision: session.revision,
            archive: session.archive.clone(),
            dirty: session.open.is_some() && session.saved_revision != session.revision,
            compiled_is_current: session
                .compiled
                .as_ref()
                .is_some_and(|stored| stored.revision == session.revision),
        }
    }

    /// La compilación del documento abierto: la guardada si corresponde a la
    /// revisión actual, o una nueva con `galera-core`.
    ///
    /// Devuelve `None` si no hay nada abierto. Ver
    /// [`AppState::compilation_with`].
    pub fn compilation(&self) -> Option<Compilation> {
        self.compilation_with(galera_core::compile)
    }

    /// Como [`AppState::compilation`], con la función de compilar dada.
    ///
    /// Si hay que compilar, se compila **sin tener cogido el cerrojo del
    /// estado**, y solo una petición a la vez. Ver el módulo.
    ///
    /// Recibir la función permite a las pruebas contar cuántas veces se
    /// compila y comprobar que, mientras tanto, el estado está libre.
    pub fn compilation_with<F>(&self, compile: F) -> Option<Compilation>
    where
        F: FnOnce(&Document, &Project) -> Result<Compiled, GaleraError>,
    {
        if let Some(stored) = self.stored_compilation() {
            return Some(stored);
        }

        let _compiling = self
            .compiling
            .lock()
            .unwrap_or_else(PoisonError::into_inner);

        // Mientras se esperaba el turno, quien lo tenía puede haber
        // compilado esta misma revisión.
        if let Some(stored) = self.stored_compilation() {
            return Some(stored);
        }

        // 1. Copiar, con el cerrojo, y soltarlo al salir del bloque.
        let (open, revision) = {
            let session = self.read();
            (session.open.clone()?, session.revision)
        };

        // 2. Compilar la copia, sin cerrojo.
        let started = Instant::now();
        let result = compile(&open.document, &open.project)
            .map(Arc::new)
            .map_err(Arc::new);
        let duration = started.elapsed();

        // 3. Guardar, con el cerrojo, solo si nada cambió entretanto.
        let mut session = self.write();
        let is_current = session.revision == revision;
        if is_current {
            if let Ok(compiled) = &result {
                session.last_good = Some(Arc::clone(compiled));
            }
            session.compiled = Some(Stored {
                revision,
                result: result.clone(),
                duration,
            });
        }

        Some(Compilation {
            revision,
            result,
            duration,
            reused: false,
            is_current,
        })
    }

    /// La compilación guardada, si corresponde a la revisión actual.
    fn stored_compilation(&self) -> Option<Compilation> {
        let session = self.read();
        session
            .compiled
            .as_ref()
            .filter(|stored| stored.revision == session.revision)
            .map(|stored| Compilation {
                revision: stored.revision,
                result: stored.result.clone(),
                duration: stored.duration,
                reused: true,
                is_current: true,
            })
    }

    /// La última compilación buena del documento abierto, o `None` si todavía
    /// no ha compilado bien ninguna. Es la que muestra el lienzo: con errores,
    /// el lienzo sigue enseñándola, así que es con la que hay que medir.
    pub fn last_good_compilation(&self) -> Option<Arc<Compiled>> {
        self.read().last_good.clone()
    }

    /// Anota una carpeta que quien usa la app ha elegido en el diálogo de
    /// abrir. Dura lo que dure la app abierta.
    pub fn choose_folder(&self, folder: &Path) {
        self.chosen_folders
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(real_path(folder));
    }

    /// Si una carpeta se ha elegido en el diálogo de abrir.
    ///
    /// Se compara la ruta real, así que da igual cómo se escriba: con `./`,
    /// con `..` o a través de un enlace simbólico.
    pub fn was_chosen(&self, folder: &Path) -> bool {
        self.chosen_folders
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&real_path(folder))
    }

    /// Anota archivos que quien usa la app ha soltado sobre la ventana o
    /// elegido en un diálogo. Duran lo que dure la app abierta.
    ///
    /// Es la misma idea que [`AppState::choose_folder`]: la interfaz no
    /// puede pedir que se lea cualquier archivo del disco, solo los que la
    /// persona ha ofrecido.
    pub fn offer_files(&self, files: &[PathBuf]) {
        let mut offered = self
            .offered_files
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        offered.extend(files.iter().map(|file| real_path(file)));
    }

    /// Si un archivo se ha soltado sobre la ventana o elegido en un diálogo.
    pub fn was_offered(&self, file: &Path) -> bool {
        self.offered_files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&real_path(file))
    }

    /// Registra imágenes, ya copiadas en la carpeta del proyecto, en el mapa
    /// `assets` del documento abierto. Como [`AppState::add_font`], no pasa
    /// por el historial: registrar una imagen no cambia cómo se ve nada.
    ///
    /// `None` si no hay nada abierto.
    pub fn add_assets(&self, assets: &[(String, String)]) -> Option<Edited> {
        let mut session = self.write();
        let session = &mut *session;
        let open = session.open.as_mut()?;
        let mut changed = false;
        for (key, path) in assets {
            if open.document.assets.get(key) != Some(path) {
                open.document.assets.insert(key.clone(), path.clone());
                changed = true;
            }
        }
        if changed {
            session.revision += 1;
            session.changed_at = Some(Instant::now());
            session.compiled = None;
        }
        Some(Edited {
            revision: session.revision,
            document: open.document.clone(),
            description: "Añadir imágenes".to_owned(),
            undo: session.history.undo_description().map(str::to_owned),
            redo: session.history.redo_description().map(str::to_owned),
        })
    }

    /// Cerrojo de lectura. Un cerrojo envenenado solo significa que un hilo
    /// falló mientras lo tenía; los datos siguen siendo utilizables, y dejar
    /// la app inservible por ello sería peor.
    fn read(&self) -> RwLockReadGuard<'_, Session> {
        self.session.read().unwrap_or_else(PoisonError::into_inner)
    }

    /// Cerrojo de escritura. Ver [`AppState::read`].
    fn write(&self) -> RwLockWriteGuard<'_, Session> {
        self.session.write().unwrap_or_else(PoisonError::into_inner)
    }

    /// Si ahora mismo nadie tiene el cerrojo. Solo para pruebas.
    #[cfg(test)]
    fn is_unlocked(&self) -> bool {
        self.session.try_write().is_ok()
    }
}

/// La ruta real de una carpeta, con los enlaces simbólicos resueltos. Si no
/// se puede resolver —porque ya no existe, por ejemplo—, la ruta tal cual.
fn real_path(folder: &Path) -> PathBuf {
    folder.canonicalize().unwrap_or_else(|_| folder.to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tempfile::TempDir;

    use super::*;

    /// Un proyecto temporal con un documento de una página y un rectángulo:
    /// compila sin fuentes.
    fn project_and_document(title: &str) -> (TempDir, Project, Document) {
        let dir = TempDir::new().expect("carpeta temporal");
        let json = format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "{title}" }},
              "pages": [{{
                "id": "p1",
                "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                "elements": [{{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10,
                                "fill": "#000000", "stroke": null }}]
              }}]
            }}"##
        );
        fs::write(dir.path().join("document.json"), &json).expect("escribir");
        let project = Project::open(dir.path()).expect("abrir proyecto");
        let document = Document::from_json_str(&json).expect("documento");
        (dir, project, document)
    }

    /// Una función de compilar que cuenta las veces que se llama.
    fn counting(
        compiles: &AtomicUsize,
    ) -> impl Fn(&Document, &Project) -> Result<Compiled, GaleraError> + Copy + '_ {
        move |document, project| {
            compiles.fetch_add(1, Ordering::SeqCst);
            galera_core::compile(document, project)
        }
    }

    #[test]
    fn a_fresh_state_has_nothing_open() {
        let state = AppState::default();
        assert_eq!(
            state.summary(),
            Summary {
                title: None,
                root: None,
                page_count: 0,
                revision: 0,
                archive: None,
                dirty: false,
                compiled_is_current: false,
            }
        );
        assert!(state.compilation().is_none());
    }

    #[test]
    fn opening_a_document_is_visible_in_the_summary() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        let root = project.root().to_owned();
        state.open(project, document);

        let summary = state.summary();
        assert_eq!(summary.title.as_deref(), Some("Informe"));
        assert_eq!(summary.root, Some(root));
        assert_eq!(summary.page_count, 1);
        assert_eq!(summary.revision, 1);
    }

    #[test]
    fn compiling_stores_the_result_for_the_current_revision() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let first = state.compilation().expect("hay documento abierto");
        assert!(first.is_current);
        assert!(!first.reused);
        let compiled = first.result.expect("compila");
        assert_eq!(compiled.page_count(), 1);
        assert!(state.summary().compiled_is_current);

        let second = state.compilation().expect("hay documento abierto");
        assert!(second.reused);
        assert_eq!(second.duration, first.duration);
        assert!(Arc::ptr_eq(&second.result.expect("compila"), &compiled));
    }

    /// Criterio de F1-04: mientras la revisión no cambie, se compila una vez.
    #[test]
    fn a_revision_is_compiled_only_once() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project.clone(), document.clone());

        let compiles = AtomicUsize::new(0);
        for _ in 0..3 {
            state.compilation_with(counting(&compiles));
        }
        assert_eq!(compiles.load(Ordering::SeqCst), 1);

        // Una revisión nueva sí se compila.
        state.open(project, document);
        state.compilation_with(counting(&compiles));
        assert_eq!(compiles.load(Ordering::SeqCst), 2);
    }

    /// Varias peticiones a la vez, sin nada guardado: compila una sola.
    #[test]
    fn simultaneous_requests_compile_once() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let compiles = AtomicUsize::new(0);
        let slow = |document: &Document, project: &Project| {
            compiles.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(50));
            galera_core::compile(document, project)
        };

        std::thread::scope(|scope| {
            let requests: Vec<_> = (0..4)
                .map(|_| scope.spawn(|| state.compilation_with(slow)))
                .collect();
            for request in requests {
                let compilation = request.join().expect("el hilo termina");
                assert!(compilation.is_some_and(|c| c.result.is_ok()));
            }
        });

        assert_eq!(compiles.load(Ordering::SeqCst), 1);
    }

    /// Criterio de F1-02: mientras se compila, nadie tiene el cerrojo.
    #[test]
    fn the_state_is_not_locked_while_compiling() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let compilation = state.compilation_with(|document, project| {
            assert!(
                state.is_unlocked(),
                "el cerrojo no puede estar cogido mientras se compila"
            );
            galera_core::compile(document, project)
        });

        assert!(compilation.is_some_and(|c| c.result.is_ok()));
    }

    /// Si el documento cambia mientras se compila, el resultado viejo no
    /// pisa el estado: correspondería a un documento que ya no está abierto.
    #[test]
    fn a_result_for_an_outdated_revision_is_not_stored() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Viejo");
        let (_other_dir, other_project, other_document) = project_and_document("Nuevo");
        state.open(project, document);

        let compilation = state
            .compilation_with(|document, project| {
                // Otro comando abre algo mientras tanto. Si el cerrojo
                // estuviera cogido, esto se quedaría esperando para siempre.
                state.open(other_project, other_document);
                galera_core::compile(document, project)
            })
            .expect("había documento abierto");

        assert!(!compilation.is_current);
        assert_eq!(compilation.revision, 1);
        assert_eq!(state.summary().title.as_deref(), Some("Nuevo"));
        assert!(!state.summary().compiled_is_current);

        // La siguiente petición compila lo nuevo.
        let next = state.compilation().expect("hay documento abierto");
        assert!(!next.reused);
        assert_eq!(next.revision, 2);
    }

    /// Un error de compilación se guarda como resultado, tal como viene del
    /// núcleo, y tampoco se recompila.
    #[test]
    fn a_compilation_error_is_stored_as_a_result() {
        let state = AppState::default();
        let (_dir, project, mut document) = project_and_document("Informe");
        document.pages[0].elements.clear();
        document.pages[0].id = "página no válida".to_owned();
        state.open(project, document);

        let compiles = AtomicUsize::new(0);
        let first = state
            .compilation_with(counting(&compiles))
            .expect("hay documento abierto");
        assert!(matches!(
            first.result.as_ref().map_err(|error| &**error),
            Err(GaleraError::Invalid(_))
        ));
        assert!(state.summary().compiled_is_current);

        let second = state
            .compilation_with(counting(&compiles))
            .expect("hay documento abierto");
        assert!(second.reused);
        assert!(second.result.is_err());
        assert_eq!(compiles.load(Ordering::SeqCst), 1);
    }

    /// La última compilación buena se guarda al compilar bien, una que falla
    /// no la pisa, y se olvida al abrir otro documento.
    #[test]
    fn the_last_good_compilation_is_kept_until_another_document_opens() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project.clone(), document.clone());
        assert!(state.last_good_compilation().is_none());

        let good = state
            .compilation()
            .expect("hay documento")
            .result
            .expect("compila");
        assert!(Arc::ptr_eq(
            &state.last_good_compilation().expect("guardada"),
            &good
        ));

        let mut broken = document;
        broken.pages[0].id = "no vale".to_owned();
        state.open(project, broken);
        assert!(state.last_good_compilation().is_none(), "otro documento");
        assert!(state.compilation().is_some_and(|c| c.result.is_err()));
        assert!(
            state.last_good_compilation().is_none(),
            "una que falla no la crea"
        );
    }

    #[test]
    fn applying_a_command_changes_the_document_and_the_revision() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);
        let good = state
            .compilation()
            .expect("hay documento")
            .result
            .expect("compila");

        let op = Op::Move {
            id: "r1".to_owned(),
            dx: 5.0,
            dy: 0.0,
        };
        let edited = state
            .apply(&op, None)
            .expect("hay documento")
            .expect("se aplica");
        assert_eq!(edited.revision, 2);
        assert_eq!(
            edited
                .document
                .element("r1")
                .and_then(|e| e.base())
                .map(|b| b.x),
            Some(5.0)
        );
        assert_eq!(edited.description, "Mover r1");
        assert_eq!(edited.undo.as_deref(), Some("Mover r1"));
        assert_eq!(edited.redo, None);

        // La compilación guardada ya no vale, pero la buena se sigue viendo.
        assert!(!state.summary().compiled_is_current);
        assert!(Arc::ptr_eq(
            &state.last_good_compilation().expect("se conserva"),
            &good
        ));

        // Y compilar ahora compila lo nuevo.
        let next = state.compilation().expect("hay documento");
        assert_eq!(next.revision, 2);
        assert!(!next.reused);
    }

    #[test]
    fn a_command_that_does_not_apply_changes_nothing() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let op = Op::Delete {
            id: "nadie".to_owned(),
        };
        assert!(matches!(
            state.apply(&op, None),
            Some(Err(GaleraError::Op(_)))
        ));
        assert_eq!(state.summary().revision, 1);
        assert!(
            AppState::default().apply(&op, None).is_none(),
            "sin documento"
        );
    }

    #[test]
    fn undo_and_redo_change_the_document_and_the_revision() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document.clone());
        assert!(
            matches!(state.undo(), Some(None)),
            "nada que deshacer todavía"
        );

        let op = Op::Move {
            id: "r1".to_owned(),
            dx: 5.0,
            dy: 0.0,
        };
        let moved = state.apply(&op, None).expect("abierto").expect("se aplica");

        let undone = state
            .undo()
            .expect("abierto")
            .expect("hay algo")
            .expect("se aplica");
        assert_eq!(undone.revision, 3);
        assert_eq!(undone.document, document);
        assert_eq!(undone.description, "Mover r1");
        assert_eq!(undone.undo, None);
        assert_eq!(undone.redo.as_deref(), Some("Mover r1"));
        assert!(!state.summary().compiled_is_current);

        let redone = state
            .redo()
            .expect("abierto")
            .expect("hay algo")
            .expect("se aplica");
        assert_eq!(redone.revision, 4);
        assert_eq!(redone.document, moved.document);
        assert!(matches!(state.redo(), Some(None)));
    }

    #[test]
    fn opening_or_closing_forgets_the_history() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project.clone(), document.clone());
        let op = Op::Move {
            id: "r1".to_owned(),
            dx: 5.0,
            dy: 0.0,
        };
        state.apply(&op, None).expect("abierto").expect("se aplica");
        state.open(project, document);
        assert!(matches!(state.undo(), Some(None)));

        state.close();
        assert!(state.undo().is_none(), "sin documento");
        assert!(state.redo().is_none(), "sin documento");
    }

    #[test]
    fn a_chosen_folder_is_remembered_however_it_is_written() {
        let state = AppState::default();
        let (dir, _project, _document) = project_and_document("Informe");
        fs::create_dir(dir.path().join("sub")).expect("sub/");
        assert!(!state.was_chosen(dir.path()));

        state.choose_folder(dir.path());
        assert!(state.was_chosen(dir.path()));
        assert!(state.was_chosen(&dir.path().join("sub/..")));
        assert!(state.was_chosen(&dir.path().join(".")));
    }

    /// Elegir una carpeta no deja abrir ni su carpeta de arriba ni las de
    /// dentro.
    #[test]
    fn only_the_chosen_folder_itself_counts() {
        let state = AppState::default();
        let (dir, _project, _document) = project_and_document("Informe");
        let inner = dir.path().join("sub");
        let deeper = inner.join("mas");
        fs::create_dir_all(&deeper).expect("sub/mas/");

        state.choose_folder(&inner);
        assert!(state.was_chosen(&inner));
        assert!(!state.was_chosen(dir.path()));
        assert!(!state.was_chosen(&inner.join("..")));
        assert!(!state.was_chosen(&deeper));
    }

    #[test]
    fn closing_forgets_the_document_and_its_compilation() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);
        state.compilation().expect("hay documento abierto");

        state.close();
        assert_eq!(state.summary().title, None);
        assert!(!state.summary().compiled_is_current);
        assert!(state.compilation().is_none());
    }

    #[test]
    fn saving_and_saving_elsewhere_are_visible_in_the_summary() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project.clone(), document);
        assert!(!state.summary().dirty, "recién abierto no hay cambios");
        assert_eq!(state.archive(), None);

        let op = Op::Move {
            id: "r1".to_owned(),
            dx: 1.0,
            dy: 0.0,
        };
        state.apply(&op, None).expect("abierto").expect("se aplica");
        assert!(state.summary().dirty);

        state.mark_saved().expect("abierto");
        assert!(!state.summary().dirty);

        // «Guardar como» cambia dónde se guarda, sin tocar documento ni historial.
        let before = state.summary().revision;
        let archive = PathBuf::from("/tmp/informe.galera");
        state
            .save_to(project, Some(archive.clone()))
            .expect("abierto");
        assert_eq!(
            state.summary().revision,
            before,
            "no es un cambio del documento"
        );
        assert_eq!(state.archive(), Some(archive));
        assert!(!state.summary().dirty);
        assert!(
            state.undo().expect("abierto").is_some(),
            "el historial sigue"
        );

        state.close();
        assert_eq!(state.archive(), None);
    }
}
