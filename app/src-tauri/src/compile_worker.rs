//! Compilar en segundo plano y avisar a la interfaz con eventos.
//!
//! Compilar puede tardar. Si lo hiciera un comando, la interfaz esperaría la
//! respuesta; con este módulo, pedir una compilación es instantáneo y el
//! resultado llega después, como evento:
//!
//! | Evento | Cuándo | Datos |
//! |---|---|---|
//! | `compilation:start` | Empieza una compilación | `{ revision }` |
//! | `compilation:finish` | Ha salido bien | `{ revision, ms, reused, diagnostics, pages, boxes }` |
//! | `compilation:error` | Ha fallado | `{ revision, ms, reused, diagnostics, error }` |
//!
//! `pages` lleva el SVG de cada página; `boxes`, la caja real de cada
//! elemento; y `error` tiene la forma de cualquier error de un comando
//! (`{ kind, message, … }`).
//!
//! # Coalescencia
//!
//! Las peticiones no se acumulan: pedir diez veces mientras se compila deja
//! **una** compilación pendiente, que se hará con el documento que haya
//! cuando le toque. Así, al escribir deprisa (Fase 4) no se compila cada
//! versión intermedia, sino solo la última.
//!
//! Y solo vale el resultado más reciente: si el documento cambia mientras se
//! compila, ese resultado ya no corresponde a lo que hay abierto, así que no
//! se avisa de él y se vuelve a compilar.
//!
//! # Nota de Tauri
//!
//! Los comandos de Tauri corren en hilos del runtime y responden a una
//! petición. Para un trabajo que avisa cuando termina, se lanza un hilo propio
//! al arrancar (`setup` en `lib.rs`) y se habla con la interfaz con
//! `app.emit("evento", datos)`, que React escucha con `listen()`.

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};

use galera_core::{Compiled, Diagnostic, Document, GaleraError, LayoutBox, Project};
use serde::{Serialize, Serializer};
use tauri::{AppHandle, Emitter, Runtime};

use crate::state::AppState;

/// Nombre del evento de inicio.
pub const START: &str = "compilation:start";
/// Nombre del evento de compilación terminada.
pub const FINISH: &str = "compilation:finish";
/// Nombre del evento de compilación fallida.
pub const ERROR: &str = "compilation:error";

/// Las peticiones de compilación pendientes: como mucho, una.
#[derive(Default)]
pub struct CompileQueue {
    pending: Mutex<Pending>,
    wake: Condvar,
}

#[derive(Default)]
struct Pending {
    /// Hay que compilar.
    requested: bool,
    /// Se está compilando.
    busy: bool,
    /// El hilo tiene que terminar.
    closed: bool,
    /// Solo en pruebas: terminar en cuanto no quede nada pendiente.
    #[cfg(test)]
    close_when_idle: bool,
}

impl CompileQueue {
    /// Pide una compilación del documento abierto. Vuelve enseguida.
    pub fn request(&self) {
        self.lock().requested = true;
        self.wake.notify_one();
    }

    /// Pide al hilo que termine cuando acabe lo que esté haciendo.
    pub fn close(&self) {
        self.lock().closed = true;
        self.wake.notify_one();
    }

    /// Si no hay nada pendiente ni en curso.
    #[cfg(test)]
    fn is_idle(&self) -> bool {
        let pending = self.lock();
        !pending.requested && !pending.busy
    }

    /// Espera a la siguiente petición y la consume. Devuelve `false` si la
    /// cola se ha cerrado.
    fn next(&self) -> bool {
        let mut pending = self.lock();
        pending.busy = false;
        loop {
            if pending.closed {
                return false;
            }
            if pending.requested {
                pending.requested = false;
                pending.busy = true;
                return true;
            }
            #[cfg(test)]
            if pending.close_when_idle {
                return false;
            }
            pending = self
                .wake
                .wait(pending)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    fn lock(&self) -> MutexGuard<'_, Pending> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// `compilation:start`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    /// La revisión que se va a compilar.
    pub revision: u64,
}

/// `compilation:finish`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    /// La revisión compilada.
    pub revision: u64,
    /// Lo que tardó la compilación, en milisegundos.
    pub ms: f64,
    /// Si salió de una compilación anterior de la misma revisión.
    pub reused: bool,
    /// Los avisos de Typst.
    pub diagnostics: Vec<Diagnostic>,
    /// El SVG de cada página.
    pub pages: Vec<String>,
    /// La caja real de cada elemento, de todas las páginas, tal como la
    /// compuso Typst (ver `galera_core::layout`).
    pub boxes: Vec<LayoutBox>,
}

/// `compilation:error`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failed {
    /// La revisión compilada.
    pub revision: u64,
    /// Lo que tardó la compilación, en milisegundos.
    pub ms: f64,
    /// Si salió de una compilación anterior de la misma revisión.
    pub reused: bool,
    /// Los errores de Typst, si el fallo es de Typst.
    pub diagnostics: Vec<Diagnostic>,
    /// Por qué falló, con la forma de un error del núcleo.
    pub error: SharedError,
}

/// El error guardado en el estado, compartido. Se serializa igual que un
/// [`GaleraError`].
#[derive(Debug, Clone)]
pub struct SharedError(pub Arc<GaleraError>);

impl Serialize for SharedError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

/// A quién se avisa. En la app, la interfaz; en las pruebas, una lista.
pub trait CompileEvents {
    /// Empieza una compilación.
    fn started(&self, event: Started);
    /// Una compilación ha salido bien.
    fn finished(&self, event: Finished);
    /// Una compilación ha fallado.
    fn failed(&self, event: Failed);
}

impl<R: Runtime> CompileEvents for AppHandle<R> {
    fn started(&self, event: Started) {
        emit(self, START, event);
    }
    fn finished(&self, event: Finished) {
        emit(self, FINISH, event);
    }
    fn failed(&self, event: Failed) {
        emit(self, ERROR, event);
    }
}

/// Si el aviso no llega, no hay a quién decírselo: la ventana ya no existe.
fn emit<R: Runtime, T: Serialize + Clone>(app: &AppHandle<R>, name: &str, payload: T) {
    if let Err(error) = app.emit(name, payload) {
        eprintln!("aviso: no se pudo enviar el evento {name}: {error}");
    }
}

/// El bucle del hilo de compilación, con `galera-core`. Termina cuando se
/// cierra la cola.
pub fn run(state: &AppState, queue: &CompileQueue, events: &impl CompileEvents) {
    run_with(state, queue, events, |document, project| {
        state.compile_cached(document, project)
    });
}

/// Como [`run`], con la función de compilar dada, para las pruebas.
pub fn run_with<F>(state: &AppState, queue: &CompileQueue, events: &impl CompileEvents, compile: F)
where
    F: Fn(&Document, &Project) -> Result<Compiled, GaleraError>,
{
    while queue.next() {
        let summary = state.summary();
        if summary.title.is_none() {
            continue;
        }
        events.started(Started {
            revision: summary.revision,
        });

        let Some(compilation) = state.compilation_with(&compile) else {
            continue;
        };
        if !compilation.is_current {
            // El documento cambió mientras se compilaba: este resultado ya no
            // vale. Se compila lo nuevo.
            queue.request();
            continue;
        }

        let ms = compilation.duration.as_secs_f64() * 1000.0;
        match compilation.result {
            Ok(compiled) => {
                let boxes = compiled.layout();
                events.finished(Finished {
                    revision: compilation.revision,
                    ms,
                    reused: compilation.reused,
                    // Los avisos de Typst y los del contenido que se sale de
                    // su caja, que Typst no da porque para él no es un
                    // problema: lo dibuja fuera y ya está.
                    diagnostics: [
                        compiled.warnings().to_vec(),
                        galera_core::overflowing(&boxes),
                    ]
                    .concat(),
                    // Solo se vuelven a dibujar las páginas que han cambiado.
                    pages: state.page_svgs(&compiled),
                    boxes,
                });
            }
            Err(error) => events.failed(Failed {
                revision: compilation.revision,
                ms,
                reused: compilation.reused,
                diagnostics: match &*error {
                    GaleraError::Typst(diagnostics) => diagnostics.clone(),
                    _ => Vec::new(),
                },
                error: SharedError(error),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use serde_json::json;

    use super::*;

    /// Los eventos que se han enviado, en orden, como JSON.
    #[derive(Default)]
    struct Recorder {
        events: Mutex<Vec<(&'static str, serde_json::Value)>>,
    }

    impl Recorder {
        fn push(&self, name: &'static str, payload: impl Serialize) {
            let value = serde_json::to_value(payload).expect("serializa");
            self.events
                .lock()
                .expect("sin envenenar")
                .push((name, value));
        }
        fn take(&self) -> Vec<(&'static str, serde_json::Value)> {
            std::mem::take(&mut *self.events.lock().expect("sin envenenar"))
        }
    }

    impl CompileEvents for Recorder {
        fn started(&self, event: Started) {
            self.push(START, event);
        }
        fn finished(&self, event: Finished) {
            self.push(FINISH, event);
        }
        fn failed(&self, event: Failed) {
            self.push(ERROR, event);
        }
    }

    fn fixture(name: &str) -> (Project, Document) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        let project = Project::open(&dir).expect("fixtures/ es un proyecto");
        let json = std::fs::read_to_string(dir.join(format!("{name}.json"))).expect("existe");
        (
            project,
            Document::from_json_str(&json).expect("es un documento"),
        )
    }

    fn names(events: &[(&'static str, serde_json::Value)]) -> Vec<&'static str> {
        events.iter().map(|(name, _)| *name).collect()
    }

    /// Una petición, procesada por el hilo hasta cerrar la cola.
    fn run_once(state: &AppState) -> Vec<(&'static str, serde_json::Value)> {
        let queue = CompileQueue::default();
        let events = Recorder::default();
        queue.request();
        queue.close_after_pending();
        run(state, &queue, &events);
        events.take()
    }

    impl CompileQueue {
        /// Para las pruebas: que el hilo termine en cuanto no quede nada.
        fn close_after_pending(&self) {
            self.lock().close_when_idle = true;
        }
    }

    #[test]
    fn a_request_sends_start_and_finish_with_every_page() {
        let state = AppState::default();
        let (project, document) = fixture("multipagina");
        let pages = document.pages.len();
        let elements = document
            .pages
            .iter()
            .map(|page| page.elements.len())
            .sum::<usize>();
        state.open(project, document);

        let events = run_once(&state);
        assert_eq!(names(&events), [START, FINISH]);
        assert_eq!(events[0].1, json!({ "revision": 1 }));

        let finish = &events[1].1;
        assert_eq!(finish["revision"], 1);
        assert_eq!(finish["reused"], false);
        assert!(finish["ms"].as_f64().is_some_and(|ms| ms > 0.0));
        assert_eq!(finish["diagnostics"], json!([]));
        let svgs = finish["pages"].as_array().expect("lista de páginas");
        assert_eq!(svgs.len(), pages);
        // Las cajas de todos los elementos, cada una con su página.
        let boxes = finish["boxes"].as_array().expect("lista de cajas");
        assert_eq!(boxes.len(), elements);
        assert!(boxes.iter().all(|b| {
            b["page"]
                .as_u64()
                .is_some_and(|page| (page as usize) < pages)
        }));
        assert!(
            svgs.iter()
                .all(|svg| svg.as_str().is_some_and(|svg| svg.starts_with("<svg")))
        );
    }

    #[test]
    fn a_document_that_does_not_compile_sends_start_and_error() {
        let state = AppState::default();
        let (project, mut document) = fixture("informe");
        document.pages[0].id = "no vale".to_owned();
        state.open(project, document);

        let events = run_once(&state);
        assert_eq!(names(&events), [START, ERROR]);
        let error = &events[1].1;
        assert_eq!(error["revision"], 1);
        assert_eq!(error["error"]["kind"], "invalid");
        assert!(error["error"]["problems"].is_array());
        assert!(error.get("pages").is_none());
    }

    #[test]
    fn with_nothing_open_nothing_is_sent() {
        assert!(run_once(&AppState::default()).is_empty());
    }

    /// Criterio de F1-11: peticiones seguidas mientras se compila dejan una
    /// sola compilación pendiente, no una por petición.
    #[test]
    fn requests_while_compiling_are_coalesced() {
        let state = AppState::default();
        let (project, document) = fixture("rectangulo");
        state.open(project.clone(), document.clone());
        let queue = CompileQueue::default();
        let events = Recorder::default();
        let compiles = AtomicUsize::new(0);
        let (entered, is_compiling) = mpsc::channel();
        let (release, may_finish) = mpsc::channel::<()>();

        thread::scope(|scope| {
            let (state_ref, queue_ref, events_ref, compiles_ref) =
                (&state, &queue, &events, &compiles);
            let worker = scope.spawn(move || {
                run_with(state_ref, queue_ref, events_ref, |document, project| {
                    if compiles_ref.fetch_add(1, Ordering::SeqCst) == 0 {
                        entered.send(()).expect("la prueba espera");
                        may_finish.recv().expect("la prueba libera");
                    }
                    galera_core::compile(document, project)
                });
            });

            queue.request();
            is_compiling.recv().expect("empieza a compilar");

            // Mientras compila: el documento cambia y llegan muchas peticiones.
            state.open(project, document);
            for _ in 0..10 {
                queue.request();
            }
            release.send(()).expect("el hilo espera");

            // Se espera a que no quede nada pendiente y se cierra.
            while !queue.is_idle() {
                thread::sleep(Duration::from_millis(5));
            }
            queue.close();
            worker.join().expect("el hilo termina");
        });

        // Una compilación para la revisión 1 (descartada) y una sola para las
        // diez peticiones sobre la revisión 2.
        assert_eq!(compiles.load(Ordering::SeqCst), 2);
        let events = events.take();
        let finishes: Vec<_> = events.iter().filter(|(name, _)| *name == FINISH).collect();
        assert_eq!(finishes.len(), 1, "{events:?}");
        assert_eq!(finishes[0].1["revision"], 2);
    }

    /// Criterio de F1-11: solo vale el resultado más reciente. Si el
    /// documento cambia mientras se compila, no se avisa del resultado viejo.
    #[test]
    fn a_result_for_an_older_revision_is_never_sent() {
        let state = AppState::default();
        let (project, document) = fixture("rectangulo");
        let (other_project, other_document) = fixture("elipse");
        state.open(project, document);
        let queue = CompileQueue::default();
        let events = Recorder::default();
        let changed = AtomicUsize::new(0);

        queue.request();
        queue.close_after_pending();
        run_with(&state, &queue, &events, |document, project| {
            if changed.fetch_add(1, Ordering::SeqCst) == 0 {
                state.open(other_project.clone(), other_document.clone());
            }
            galera_core::compile(document, project)
        });

        let events = events.take();
        assert_eq!(names(&events), [START, START, FINISH]);
        assert_eq!(events[1].1["revision"], 2);
        assert_eq!(events[2].1["revision"], 2);
    }

    /// Criterio de F1-11: pedir una compilación no espera a que termine la
    /// que está en curso.
    #[test]
    fn requesting_never_waits_for_a_compilation() {
        let state = AppState::default();
        let (project, document) = fixture("rectangulo");
        state.open(project, document);
        let queue = CompileQueue::default();
        let events = Recorder::default();
        let (entered, is_compiling) = mpsc::channel();
        let (release, may_finish) = mpsc::channel::<()>();

        thread::scope(|scope| {
            let (state_ref, queue_ref, events_ref) = (&state, &queue, &events);
            let worker = scope.spawn(move || {
                run_with(state_ref, queue_ref, events_ref, |document, project| {
                    let _ = entered.send(());
                    let _ = may_finish.recv();
                    galera_core::compile(document, project)
                });
            });

            queue.request();
            is_compiling.recv().expect("empieza a compilar");

            // El hilo está bloqueado compilando: pedir y leer el estado
            // vuelven enseguida.
            queue.request();
            assert_eq!(state.summary().revision, 1);

            release.send(()).expect("el hilo espera");
            release.send(()).expect("el hilo espera");
            while !queue.is_idle() {
                thread::sleep(Duration::from_millis(5));
            }
            queue.close();
            worker.join().expect("el hilo termina");
        });
    }
}
