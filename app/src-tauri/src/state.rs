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
//! interfaz se quedaría congelada. Por eso [`AppState::compile_with`] hace
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

use std::sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use galera_core::{Compiled, Document, GaleraError, Project};

/// El estado de la app, compartido entre todos los comandos.
#[derive(Default)]
pub struct AppState {
    session: RwLock<Session>,
}

/// Lo que hay abierto.
#[derive(Default)]
struct Session {
    /// El proyecto y su documento, si hay uno abierto.
    open: Option<OpenDocument>,
    /// Se incrementa con cada cambio del documento abierto.
    revision: u64,
    /// La última compilación guardada y la revisión de la que sale.
    compiled: Option<(u64, Arc<Compiled>)>,
}

/// Un proyecto abierto con su documento.
#[derive(Clone)]
struct OpenDocument {
    project: Project,
    document: Document,
}

/// Lo que se sabe del estado sin compilar nada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    /// El título del documento abierto, si hay uno.
    pub title: Option<String>,
    /// Cuántas páginas tiene el documento abierto.
    pub page_count: usize,
    /// La revisión actual.
    pub revision: u64,
    /// Si la última compilación guardada corresponde a la revisión actual.
    pub compiled_is_current: bool,
}

/// El resultado de compilar la revisión que estaba abierta.
pub struct Compilation {
    /// De qué revisión sale.
    pub revision: u64,
    /// El documento compilado.
    pub compiled: Arc<Compiled>,
    /// `false` si el documento cambió mientras se compilaba: el resultado es
    /// correcto para aquella revisión, pero ya no se ha guardado.
    pub is_current: bool,
}

impl AppState {
    /// Abre un proyecto con su documento, sustituyendo lo que hubiera.
    pub fn open(&self, project: Project, document: Document) {
        let mut session = self.write();
        session.open = Some(OpenDocument { project, document });
        session.revision += 1;
        session.compiled = None;
    }

    /// Cierra lo que haya abierto.
    pub fn close(&self) {
        let mut session = self.write();
        session.open = None;
        session.revision += 1;
        session.compiled = None;
    }

    /// Un resumen del estado, para la interfaz.
    pub fn summary(&self) -> Summary {
        let session = self.read();
        Summary {
            title: session
                .open
                .as_ref()
                .map(|open| open.document.meta.title.clone()),
            page_count: session
                .open
                .as_ref()
                .map_or(0, |open| open.document.pages.len()),
            revision: session.revision,
            compiled_is_current: session
                .compiled
                .as_ref()
                .is_some_and(|(revision, _)| *revision == session.revision),
        }
    }

    /// La última compilación guardada, si corresponde a la revisión actual.
    pub fn current_compilation(&self) -> Option<Arc<Compiled>> {
        let session = self.read();
        session
            .compiled
            .as_ref()
            .filter(|(revision, _)| *revision == session.revision)
            .map(|(_, compiled)| Arc::clone(compiled))
    }

    /// Compila lo que hay abierto con `galera-core`.
    ///
    /// Devuelve `Ok(None)` si no hay nada abierto. Ver [`AppState::compile_with`].
    pub fn compile_current(&self) -> Result<Option<Compilation>, GaleraError> {
        self.compile_with(galera_core::compile)
    }

    /// Compila lo que hay abierto con la función dada, **sin tener el cerrojo
    /// cogido mientras compila**. Ver el módulo.
    ///
    /// Recibir la función de compilar permite a las pruebas comprobar que,
    /// mientras se compila, el estado está libre.
    pub fn compile_with<F>(&self, compile: F) -> Result<Option<Compilation>, GaleraError>
    where
        F: FnOnce(&Document, &Project) -> Result<Compiled, GaleraError>,
    {
        // 1. Copiar, con el cerrojo, y soltarlo al salir del bloque.
        let (open, revision) = {
            let session = self.read();
            match &session.open {
                Some(open) => (open.clone(), session.revision),
                None => return Ok(None),
            }
        };

        // 2. Compilar la copia, sin cerrojo.
        let compiled = Arc::new(compile(&open.document, &open.project)?);

        // 3. Guardar, con el cerrojo, solo si nada cambió entretanto.
        let mut session = self.write();
        let is_current = session.revision == revision;
        if is_current {
            session.compiled = Some((revision, Arc::clone(&compiled)));
        }

        Ok(Some(Compilation {
            revision,
            compiled,
            is_current,
        }))
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

#[cfg(test)]
mod tests {
    use std::fs;

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

    #[test]
    fn a_fresh_state_has_nothing_open() {
        let state = AppState::default();
        assert_eq!(
            state.summary(),
            Summary {
                title: None,
                page_count: 0,
                revision: 0,
                compiled_is_current: false,
            }
        );
        assert!(matches!(state.compile_current(), Ok(None)));
    }

    #[test]
    fn opening_a_document_is_visible_in_the_summary() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let summary = state.summary();
        assert_eq!(summary.title.as_deref(), Some("Informe"));
        assert_eq!(summary.page_count, 1);
        assert_eq!(summary.revision, 1);
    }

    #[test]
    fn compiling_stores_the_result_for_the_current_revision() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let compilation = state
            .compile_current()
            .expect("compila")
            .expect("hay documento abierto");
        assert!(compilation.is_current);
        assert_eq!(compilation.compiled.page_count(), 1);

        assert!(state.summary().compiled_is_current);
        assert!(state.current_compilation().is_some());
    }

    /// El criterio de la tarea: mientras se compila, nadie tiene el cerrojo.
    #[test]
    fn the_state_is_not_locked_while_compiling() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);

        let result = state.compile_with(|document, project| {
            assert!(
                state.is_unlocked(),
                "el cerrojo no puede estar cogido mientras se compila"
            );
            galera_core::compile(document, project)
        });

        assert!(matches!(result, Ok(Some(_))));
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
            .compile_with(|document, project| {
                // Otro comando abre algo mientras tanto. Si el cerrojo
                // estuviera cogido, esto se quedaría esperando para siempre.
                state.open(other_project, other_document);
                galera_core::compile(document, project)
            })
            .expect("compila")
            .expect("había documento abierto");

        assert!(!compilation.is_current);
        assert_eq!(state.summary().title.as_deref(), Some("Nuevo"));
        assert!(!state.summary().compiled_is_current);
        assert!(state.current_compilation().is_none());
    }

    /// Un error de compilación llega tal cual: el estado no lo reinterpreta.
    #[test]
    fn a_compilation_error_comes_from_the_core_untouched() {
        let state = AppState::default();
        let (_dir, project, mut document) = project_and_document("Informe");
        document.pages[0].elements.clear();
        document.pages[0].id = "página no válida".to_owned();
        state.open(project, document);

        assert!(matches!(
            state.compile_current(),
            Err(GaleraError::Invalid(_))
        ));
        assert!(!state.summary().compiled_is_current);
    }

    #[test]
    fn closing_forgets_the_document_and_its_compilation() {
        let state = AppState::default();
        let (_dir, project, document) = project_and_document("Informe");
        state.open(project, document);
        state.compile_current().expect("compila");

        state.close();
        assert_eq!(state.summary().title, None);
        assert!(state.current_compilation().is_none());
    }
}
