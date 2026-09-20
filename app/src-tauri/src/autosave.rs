//! Autoguardado y recuperación.
//!
//! Mientras se edita, el documento se guarda cada pocos segundos en una
//! **copia de trabajo aparte**, en la carpeta de datos de la app. Nunca toca
//! el proyecto: guardar de verdad sigue siendo cosa de quien edita
//! (`commands::project`). Si la app se cierra de golpe, al volver a abrirla
//! se ofrece recuperar esa copia.
//!
//! # Cuándo se escribe
//!
//! Un hilo mira el estado cada segundo y escribe solo si:
//!
//! - hay un proyecto abierto y **cambios sin guardar**;
//! - lo último que cambió fue hace más de [`IDLE`], para no escribir en mitad
//!   de un arrastre;
//! - esa revisión no se ha autoguardado ya.
//!
//! Escribir es serializar el documento y mover un archivo: no toca el
//! documento abierto, no sube la revisión y **no pide compilar**, así que no
//! interrumpe la edición.
//!
//! # Cómo se escribe
//!
//! Primero a un archivo temporal al lado y después un `rename`, que es
//! atómico: o está la copia de antes, o la nueva, nunca media.
//!
//! # Qué se recupera
//!
//! Cada copia dice a qué proyecto pertenece (una carpeta o un `.galera`).
//! Al arrancar se ofrecen las copias **más nuevas que lo guardado** en ese
//! proyecto; las demás sobran y se pueden tirar.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use galera_core::{DOCUMENT_FILE, Document, ProjectFormat};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

/// La carpeta de las copias, dentro de la de datos de la app.
pub const AUTOSAVE_DIR: &str = "autoguardado";

/// Cuánto hay que estar sin tocar nada para que se escriba una copia.
pub const IDLE: Duration = Duration::from_secs(2);

/// Cada cuánto mira el hilo si hay algo que copiar.
pub const TICK: Duration = Duration::from_secs(1);

/// Una copia de autoguardado.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Autosave {
    /// El proyecto al que pertenece: su carpeta, o su `.galera`.
    pub target: PathBuf,
    /// Su carpeta de trabajo, por si el proyecto viene de un `.galera`.
    pub root: PathBuf,
    /// Cuándo se escribió, en segundos desde 1970.
    pub saved_at: u64,
    /// El documento tal como estaba.
    pub document: Document,
}

/// Una copia que se puede recuperar, sin el documento: lo que hace falta
/// para preguntar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    /// El proyecto al que pertenece.
    pub target: PathBuf,
    /// Cuándo se autoguardó, en segundos desde 1970.
    pub saved_at: u64,
    /// Cuándo se guardó el proyecto de verdad, si existe.
    pub project_saved_at: Option<u64>,
}

/// El nombre del archivo de la copia de un proyecto.
///
/// Lleva el nombre del proyecto, para reconocerlo de un vistazo, y un
/// resumen de su ruta completa, para que dos proyectos que se llamen igual
/// no compartan copia.
pub fn file_name(target: &Path) -> String {
    let name: String = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "proyecto".to_owned())
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{name}-{:016x}.json", hash(&target.to_string_lossy()))
}

/// Un resumen de 64 bits de un texto (FNV-1a): solo para distinguir rutas.
fn hash(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Segundos desde 1970, o 0 si el reloj del sistema está antes de esa fecha.
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or_default()
}

/// Cuándo se guardó por última vez el proyecto: la fecha de su
/// `document.json` si es una carpeta, o la del archivo si es un `.galera`.
fn project_saved_at(target: &Path) -> Option<u64> {
    let path = match ProjectFormat::of(target) {
        ProjectFormat::Folder => target.join(DOCUMENT_FILE),
        ProjectFormat::Archive => target.to_owned(),
    };
    fs::metadata(path)
        .and_then(|data| data.modified())
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|since| since.as_secs())
}

/// Escribe la copia de un proyecto, de forma atómica.
///
/// # Errores
///
/// Los de escribir en la carpeta de datos de la app.
pub fn write(dir: &Path, autosave: &Autosave) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = dir.join(file_name(&autosave.target));
    let temporary = path.with_extension("json.nuevo");
    let json = serde_json::to_vec(autosave)?;
    fs::write(&temporary, &json)?;
    fs::rename(&temporary, &path)?;
    Ok(path)
}

/// Lee la copia de un proyecto, si la hay y se puede leer.
pub fn read(dir: &Path, target: &Path) -> Option<Autosave> {
    let data = fs::read(dir.join(file_name(target))).ok()?;
    serde_json::from_slice(&data).ok()
}

/// Tira la copia de un proyecto: ya no hace falta porque se ha guardado, o
/// porque se ha decidido no recuperarla.
pub fn discard(dir: &Path, target: &Path) {
    let _ = fs::remove_file(dir.join(file_name(target)));
}

/// Las copias que merece la pena ofrecer: las de proyectos cuya copia es
/// **más nueva** que lo guardado, o cuyo proyecto ya no está.
///
/// Las que no (se guardó después de la copia) se tiran por el camino.
pub fn pending(dir: &Path) -> Vec<Recovery> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut pending = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let Some(autosave) = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<Autosave>(&data).ok())
        else {
            // Una copia que no se puede leer no sirve para nada.
            let _ = fs::remove_file(&path);
            continue;
        };
        let saved = project_saved_at(&autosave.target);
        if saved.is_some_and(|saved| saved >= autosave.saved_at) {
            let _ = fs::remove_file(&path);
            continue;
        }
        pending.push(Recovery {
            target: autosave.target,
            saved_at: autosave.saved_at,
            project_saved_at: saved,
        });
    }
    // De la más nueva a la más vieja.
    pending.sort_by_key(|recovery| std::cmp::Reverse(recovery.saved_at));
    pending
}

/// Escribe ahora la copia del proyecto abierto, si hay cambios sin guardar.
///
/// Devuelve la revisión copiada. `None` si no había nada que copiar.
pub fn save_now(state: &AppState, dir: &Path) -> Option<u64> {
    let (target, root, document, revision) = state.pending_autosave(Duration::ZERO)?;
    write(
        dir,
        &Autosave {
            target,
            root,
            saved_at: now(),
            document,
        },
    )
    .ok()?;
    state.mark_autosaved(revision);
    Some(revision)
}

/// Lo que hace dormir y despertar al hilo del autoguardado.
#[derive(Default)]
pub struct AutosaveSignal {
    state: Mutex<Signal>,
    wake: Condvar,
}

#[derive(Default)]
struct Signal {
    /// Hay que copiar ya, sin esperar (al perder el foco, por ejemplo).
    now: bool,
    /// El hilo tiene que terminar.
    closed: bool,
}

impl AutosaveSignal {
    /// Pide una copia inmediata.
    pub fn save_now(&self) {
        self.lock().now = true;
        self.wake.notify_one();
    }

    /// Pide al hilo que termine.
    pub fn close(&self) {
        self.lock().closed = true;
        self.wake.notify_one();
    }

    fn lock(&self) -> MutexGuard<'_, Signal> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// El hilo del autoguardado: mira el estado cada [`TICK`] y escribe cuando
/// toca. Termina con [`AutosaveSignal::close`].
pub fn run(state: &AppState, dir: &Path, signal: &AutosaveSignal) {
    loop {
        let (closed, forced) = {
            let mut current = signal.lock();
            if !current.now && !current.closed {
                let (next, _) = signal
                    .wake
                    .wait_timeout(current, TICK)
                    .unwrap_or_else(PoisonError::into_inner);
                current = next;
            }
            let forced = std::mem::take(&mut current.now);
            (current.closed, forced)
        };

        let idle = if forced { Duration::ZERO } else { IDLE };
        if let Some((target, root, document, revision)) = state.pending_autosave(idle)
            && write(
                dir,
                &Autosave {
                    target,
                    root,
                    saved_at: now(),
                    document,
                },
            )
            .is_ok()
        {
            state.mark_autosaved(revision);
        }

        if closed {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::thread;

    use galera_core::{Op, Project};
    use tempfile::TempDir;

    use super::*;

    fn document(title: &str) -> Document {
        Document::from_json_str(&format!(
            r##"{{ "version": 1, "meta": {{ "title": "{title}" }}, "pages": [{{ "id": "p1",
                 "size": {{ "width": 100, "height": 100, "unit": "mm" }}, "elements": [
                   {{ "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10, "fill": null, "stroke": null }}
                 ] }}] }}"##
        ))
        .expect("es un documento")
    }

    /// Un proyecto abierto en una carpeta temporal, con su `document.json`.
    fn opened(state: &AppState) -> TempDir {
        let dir = TempDir::new().expect("carpeta temporal");
        let document = document("Informe");
        galera_core::save_document(dir.path(), &document).expect("se guarda");
        let project = Project::open(dir.path()).expect("es un proyecto");
        state.open(project, document);
        dir
    }

    fn edit(state: &AppState) {
        state
            .apply(
                &Op::Move {
                    id: "r1".to_owned(),
                    dx: 1.0,
                    dy: 0.0,
                },
                None,
            )
            .expect("abierto")
            .expect("se aplica");
    }

    #[test]
    fn each_project_has_its_own_file_even_with_the_same_name() {
        let one = file_name(Path::new("/a/informe.galera"));
        let other = file_name(Path::new("/b/informe.galera"));
        assert!(one.starts_with("informe_galera-"), "{one}");
        assert_ne!(one, other);
        assert_eq!(one, file_name(Path::new("/a/informe.galera")));
        assert!(file_name(Path::new("/x/con espacio")).starts_with("con_espacio-"));
    }

    #[test]
    fn a_copy_is_written_read_and_discarded() {
        let dir = TempDir::new().expect("carpeta temporal");
        let autosave = Autosave {
            target: PathBuf::from("/proyectos/informe"),
            root: PathBuf::from("/proyectos/informe"),
            saved_at: 1000,
            document: document("Informe"),
        };
        let path = write(dir.path(), &autosave).expect("se escribe");
        assert!(path.is_file());
        assert!(!path.with_extension("json.nuevo").exists(), "sin restos");
        assert_eq!(read(dir.path(), &autosave.target), Some(autosave.clone()));

        discard(dir.path(), &autosave.target);
        assert_eq!(read(dir.path(), &autosave.target), None);
    }

    #[test]
    fn only_copies_newer_than_the_project_are_offered() {
        let copies = TempDir::new().expect("carpeta temporal");
        let state = AppState::default();
        let project = opened(&state);
        let target = project.path().canonicalize().expect("existe");

        // Copia más vieja que lo guardado: sobra y se tira.
        write(
            copies.path(),
            &Autosave {
                target: target.clone(),
                root: target.clone(),
                saved_at: 1,
                document: document("Vieja"),
            },
        )
        .expect("se escribe");
        assert_eq!(pending(copies.path()), Vec::new());
        assert_eq!(read(copies.path(), &target), None, "la tira");

        // Copia más nueva: se ofrece, con las dos fechas.
        write(
            copies.path(),
            &Autosave {
                target: target.clone(),
                root: target.clone(),
                saved_at: now() + 60,
                document: document("Nueva"),
            },
        )
        .expect("se escribe");
        let offered = pending(copies.path());
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].target, target);
        assert!(offered[0].project_saved_at.is_some());

        // De un proyecto que ya no está, también se ofrece.
        write(
            copies.path(),
            &Autosave {
                target: PathBuf::from("/no/existe.galera"),
                root: PathBuf::from("/no/existe"),
                saved_at: 5,
                document: document("Perdida"),
            },
        )
        .expect("se escribe");
        assert_eq!(pending(copies.path()).len(), 2);

        // Y un archivo ilegible se tira sin molestar.
        fs::write(copies.path().join("roto.json"), b"{ no es json").expect("escribir");
        assert_eq!(pending(copies.path()).len(), 2);
        assert!(!copies.path().join("roto.json").exists());
    }

    #[test]
    fn nothing_is_copied_without_changes_and_the_saved_revision_is_remembered() {
        let copies = TempDir::new().expect("carpeta temporal");
        let state = AppState::default();
        let project = opened(&state);
        let target = project.path().canonicalize().expect("existe");

        // Recién abierto no hay cambios.
        assert_eq!(save_now(&state, copies.path()), None);

        edit(&state);
        let revision = save_now(&state, copies.path()).expect("hay cambios");
        assert_eq!(revision, state.summary().revision);
        let copy = read(copies.path(), &target).expect("hay copia");
        assert_eq!(copy.document, state.open_document().expect("abierto").1);

        // La misma revisión no se copia dos veces.
        assert_eq!(save_now(&state, copies.path()), None);

        // Guardar de verdad quita la copia pendiente.
        state.mark_saved();
        assert_eq!(save_now(&state, copies.path()), None);
    }

    #[test]
    fn the_thread_copies_after_a_pause_and_at_once_when_asked() {
        let copies = TempDir::new().expect("carpeta temporal");
        let state = AppState::default();
        let project = opened(&state);
        let target = project.path().canonicalize().expect("existe");

        let signal = AutosaveSignal::default();
        thread::scope(|scope| {
            let worker = scope.spawn(|| run(&state, copies.path(), &signal));

            edit(&state);
            // Sin esperar a que pase el tiempo de reposo: se pide ya.
            signal.save_now();
            let mut copy = None;
            for _ in 0..200 {
                copy = read(copies.path(), &target);
                if copy.is_some() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            assert!(copy.is_some(), "el hilo escribe la copia al pedírselo");
            assert_eq!(state.summary().revision, state.summary().revision);

            signal.close();
            worker.join().expect("el hilo termina");
        });
    }
}
