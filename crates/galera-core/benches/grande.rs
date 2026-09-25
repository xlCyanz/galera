//! Un documento de 50 páginas: abrirlo, escribir en él y exportarlo
//! (F8-04, #91).
//!
//! Mide lo que hace el núcleo con [`fixtures/grande.json`] —cincuenta
//! páginas con texto justificado, fotos, tablas, cabecera y pie— en los tres
//! momentos que un documento grande puede hacerse pesado:
//!
//! 1. **Abrir**: leer y validar el proyecto, la primera compilación, dibujar
//!    las cincuenta páginas y sacar lo que necesita el lienzo. Termina donde
//!    la app enseña la primera página.
//! 2. **Escribir**: el mismo camino que mide `benches/compile.rs`, en la
//!    página 25.
//! 3. **Exportar** a PDF el documento entero.
//!
//! Y **la memoria**: lo que el núcleo tiene reservado después de cada paso y
//! lo más alto a lo que llegó. Se cuenta con un asignador que lleva la
//! cuenta, así que es memoria del montón —la de Galera y la de Typst—, no el
//! tamaño del proceso, que depende también del sistema.
//!
//! Además de los tiempos, cada tecla cuenta **cuántos bytes viajarían a la
//! interfaz** en el evento `compilation:finish`: es lo que cuesta en el
//! puente de Tauri y no se ve en el tiempo del núcleo.
//!
//! ```bash
//! cargo bench -p galera-core --bench grande
//! ```
//!
//! Los números están en `docs/rendimiento.md`.
//!
//! [`fixtures/grande.json`]: ../../../fixtures/grande.json

use std::alloc::{GlobalAlloc, Layout, System};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use galera_core::{Compiler, Document, Element, Op, open};

/// Cuenta lo que se reserva y lo que se suelta, y guarda el máximo.
struct Counting;

static CURRENT: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

// SAFETY: delega todo en el asignador del sistema; solo lleva la cuenta.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: el mismo contrato que `System::alloc`.
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let now = CURRENT.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: el mismo contrato que `System::dealloc`.
        unsafe { System.dealloc(pointer, layout) };
        CURRENT.fetch_sub(layout.size(), Ordering::Relaxed);
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        // SAFETY: el mismo contrato que `System::realloc`.
        let moved = unsafe { System.realloc(pointer, layout, size) };
        if !moved.is_null() {
            if size >= layout.size() {
                let now = CURRENT.fetch_add(size - layout.size(), Ordering::Relaxed)
                    + (size - layout.size());
                PEAK.fetch_max(now, Ordering::Relaxed);
            } else {
                CURRENT.fetch_sub(layout.size() - size, Ordering::Relaxed);
            }
        }
        moved
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Cuántas veces se abre el documento. Cada vez desde cero: con la memoria
/// de Typst vacía, como al arrancar la app.
const OPENS: usize = 5;

/// Cuántas teclas se miden.
const KEYS: usize = 40;

/// Cuántas veces se exporta.
const EXPORTS: usize = 5;

/// Lo acordado para abrir un documento de 50 páginas: hasta ver la primera
/// página. Un segundo es lo que se tolera sin que parezca que la app se ha
/// quedado colgada.
const OPEN_BUDGET: Duration = Duration::from_secs(1);

/// El de la Fase 4: lo que puede tardar una tecla.
const KEY_BUDGET: Duration = Duration::from_millis(50);

/// Lo acordado para exportar el documento entero a PDF.
const EXPORT_BUDGET: Duration = Duration::from_secs(2);

/// El texto en que se escribe: el cuerpo de la página 25.
const TYPED: &str = "cuerpo-25";

fn main() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    let dir = project(&fixtures);

    println!("documento: fixtures/grande.json");

    // 1. Abrir.
    let mut opens = Vec::with_capacity(OPENS);
    let mut opened = None;
    for _ in 0..OPENS {
        // La memoria de Typst, vacía: si no, la segunda vez no compone nada.
        comemo::evict(0);
        let started = Instant::now();
        let project = open(dir.path()).expect("se abre");
        let mut compiler = Compiler::new(project.project);
        let compiled = compiler.compile(&project.document).expect("compila");
        let (payload, _) = payload(&mut compiler, &compiled, &project.document);
        opens.push(started.elapsed());
        opened = Some((compiler, project.document, payload));
    }
    let (mut compiler, document, first) = opened.expect("se ha abierto");
    let open_memory = memory();
    println!(
        "{} páginas · {} elementos · {} para la interfaz al abrir",
        document.pages.len(),
        document
            .pages
            .iter()
            .map(|page| page.elements.len())
            .sum::<usize>(),
        bytes(first),
    );
    println!();
    println!(
        "{:<12}  {:>9}  {:>9}  {:>9}  {:>11}",
        "paso", "mediana", "p95", "peor", "presupuesto"
    );
    report("abrir", &opens, OPEN_BUDGET);

    // 2. Escribir.
    PEAK.store(CURRENT.load(Ordering::Relaxed), Ordering::Relaxed);
    let mut document = document;
    let mut at = characters(&document);
    let mut sent = Vec::with_capacity(KEYS);
    let mut parts: [Vec<Duration>; 4] = Default::default();
    let keys: Vec<Duration> = ('a'..)
        .take(KEYS)
        .map(|letter| {
            let started = Instant::now();
            document = Op::InsertText {
                id: TYPED.to_owned(),
                at,
                text: letter.to_string(),
            }
            .apply(&document)
            .expect("se aplica")
            .document;
            let compiled = compiler.compile(&document).expect("compila");
            let compiled_at = Instant::now();
            let (size, times) = payload(&mut compiler, &compiled, &document);
            compiled.glyphs(&document, TYPED);
            sent.push(size);
            parts[0].push(compiled_at - started);
            parts[1].push(times[0]);
            parts[2].push(times[1]);
            parts[3].push(times[2]);
            at += 1;
            started.elapsed()
        })
        .collect();
    report("tecla", &keys, KEY_BUDGET);
    for (name, times) in ["· compilar", "· dibujar", "· cajas", "· a JSON"]
        .iter()
        .zip(&parts)
    {
        report_part(name, times);
    }
    let typing_memory = memory();

    // 3. Exportar.
    PEAK.store(CURRENT.load(Ordering::Relaxed), Ordering::Relaxed);
    let compiled = compiler.compile(&document).expect("compila");
    let mut pdf = 0;
    let exports: Vec<Duration> = (0..EXPORTS)
        .map(|_| {
            let started = Instant::now();
            pdf = compiled.to_pdf().expect("pdf").len();
            started.elapsed()
        })
        .collect();
    report("exportar", &exports, EXPORT_BUDGET);
    let export_memory = memory();

    println!();
    println!("PDF: {}", bytes(pdf));
    println!(
        "páginas dibujadas al escribir: {} en {KEYS} teclas",
        compiler.pages_rendered() - 50
    );
    let per_key = sent.iter().sum::<usize>() / sent.len().max(1);
    println!("lo que viaja a la interfaz por tecla: {}", bytes(per_key));

    println!();
    println!("{:<12}  {:>10}  {:>10}", "memoria", "después", "máximo");
    for (name, (now, peak)) in [
        ("abrir", open_memory),
        ("escribir", typing_memory),
        ("exportar", export_memory),
    ] {
        println!("{name:<12}  {:>10}  {:>10}", bytes(now), bytes(peak));
    }
}

/// Una copia de `fixtures/` con `grande.json` como documento, para abrirlo
/// como lo abre la app.
fn project(fixtures: &Path) -> tempfile::TempDir {
    let dir = tempfile::TempDir::new().expect("carpeta temporal");
    for folder in ["fonts", "assets"] {
        fs::create_dir(dir.path().join(folder)).expect("carpeta");
        for entry in fs::read_dir(fixtures.join(folder)).expect("se lee") {
            let entry = entry.expect("entrada");
            fs::copy(
                entry.path(),
                dir.path().join(folder).join(entry.file_name()),
            )
            .expect("se copia");
        }
    }
    fs::copy(
        fixtures.join("grande.json"),
        dir.path().join("document.json"),
    )
    .expect("se copia");
    dir
}

/// Lo que la app saca de cada compilación para el lienzo y manda a la
/// interfaz: los SVG de las páginas, las cajas, los flujos y las celdas.
///
/// Devuelve cuántos bytes ocupa en JSON, que es como viaja, y lo que tardó
/// cada parte: dibujar las páginas, sacar las cajas y pasarlo a JSON.
fn payload(
    compiler: &mut Compiler,
    compiled: &galera_core::Compiled,
    document: &Document,
) -> (usize, [Duration; 3]) {
    let started = Instant::now();
    // Lo que manda la app: solo las páginas que la interfaz no tiene.
    let pages = compiler.page_update(compiled);
    let drawn = Instant::now();
    let boxes = compiled.layout();
    let flows = compiled.flows();
    let cells = compiled.cells(document);
    let measured = Instant::now();
    let size = serde_json::to_vec(&(pages, boxes, flows, cells))
        .expect("se serializa")
        .len();
    (
        size,
        [drawn - started, measured - drawn, measured.elapsed()],
    )
}

/// Cuántos caracteres tiene el texto en que se escribe.
fn characters(document: &Document) -> usize {
    match document.element(TYPED) {
        Some(Element::Text { content, .. }) => galera_core::model::text::length(content),
        _ => panic!("fixtures/grande.json tiene un texto «{TYPED}»"),
    }
}

/// La memoria reservada ahora y lo más alto desde la última vez.
fn memory() -> (usize, usize) {
    (
        CURRENT.load(Ordering::Relaxed),
        PEAK.load(Ordering::Relaxed),
    )
}

fn report(name: &str, times: &[Duration], budget: Duration) {
    let p95 = percentile(times, 95);
    println!(
        "{name:<12}  {:>9}  {:>9}  {:>9}  {:>9} {}",
        millis(percentile(times, 50)),
        millis(p95),
        millis(times.iter().copied().max().unwrap_or_default()),
        millis(budget),
        if p95 <= budget { "✓" } else { "✗" },
    );
}

/// Una parte de la tecla: sin presupuesto propio.
fn report_part(name: &str, times: &[Duration]) {
    println!(
        "{name:<12}  {:>9}  {:>9}  {:>9}",
        millis(percentile(times, 50)),
        millis(percentile(times, 95)),
        millis(times.iter().copied().max().unwrap_or_default()),
    );
}

fn percentile(times: &[Duration], percent: usize) -> Duration {
    let mut sorted = times.to_vec();
    sorted.sort_unstable();
    let at = (sorted.len() * percent).div_ceil(100).saturating_sub(1);
    sorted.get(at).copied().unwrap_or_default()
}

fn millis(time: Duration) -> String {
    format!("{:.1} ms", time.as_secs_f64() * 1000.0)
}

fn bytes(count: usize) -> String {
    if count >= 1 << 20 {
        format!("{:.1} MB", count as f64 / f64::from(1 << 20))
    } else {
        format!("{:.0} KB", count as f64 / 1024.0)
    }
}
