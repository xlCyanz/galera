/**
 * Llamadas al backend de Tauri.
 *
 * Los tipos del modelo (`Document`, `Diagnostic`…) se importan de `./types`,
 * que se genera desde Rust. Los de las respuestas de los comandos son de la
 * app y se escriben aquí; cada uno tiene en Rust una prueba que fija su
 * forma en JSON.
 *
 * Toda comunicación con Rust pasa por aquí, con tipos, en vez de repartir
 * `invoke("nombre")` con cadenas sueltas por los componentes. Si un comando
 * cambia de nombre o de argumentos, se arregla en un solo sitio.
 *
 * Nota de Tauri: `invoke` envía un mensaje al proceso Rust y devuelve una
 * promesa con lo que responda la función marcada con `#[tauri::command]` del
 * mismo nombre. Los argumentos van en un objeto cuyas claves son los nombres
 * de los parámetros de esa función.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import type { Diagnostic } from "./types/diagnostic";
import type { Glyph, LayoutBox, MmRect } from "./types/layout";
import type { Document, TextStyle } from "./types/model";
import type { Op } from "./types/ops";
import type { Alignment, Spread } from "./types/align";
import type { Csv, Encoding, Mapping, Row } from "./types/batch";
import type { CodeError } from "./types/code";
import type { CodeSpan } from "./types/codegen";
import type { Grips, Settings as SnapSettings, Snapped } from "./types/snap";

/**
 * El estado de la sesión, tal como lo devuelve `session_status`.
 *
 * Tiene que coincidir con `SessionStatus` de
 * `src-tauri/src/commands/session.rs`. Una prueba en Rust fija los nombres de
 * los campos.
 */
export interface SessionStatus {
  /** La versión de `galera-core` con la que está compilada la app. */
  coreVersion: string;
  /** El título del documento abierto, o `null` si no hay ninguno. */
  title: string | null;
  /** Cuántas páginas tiene el documento abierto. */
  pageCount: number;
  /** Si la última compilación corresponde a lo que hay abierto. */
  compiledIsCurrent: boolean;
}

/** Pide al backend el estado de la sesión. */
export function sessionStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>("session_status");
}

/**
 * Lo que devuelve un comando cuando falla.
 *
 * Todos los errores del backend llegan con esta forma: `kind` dice qué pasó,
 * con una palabra estable, y `message` es el texto listo para enseñar. Los de
 * validación y los de Typst traen además el detalle por elemento.
 */
export interface CommandError {
  kind: string;
  message: string;
  /** Si es un error de validación (`kind: "invalid"`), cada problema. */
  problems?: ValidationProblem[];
  /** Si es un error de Typst (`kind: "typst"`), cada diagnóstico. */
  diagnostics?: Diagnostic[];
}

/**
 * Un problema de validación, tal como lo serializa `ValidationError` de
 * `galera-core` (`model/validate.rs`). Solo lo que usa la interfaz.
 */
export interface ValidationProblem {
  /** Dónde está: una página o un elemento, por su id. */
  location: { kind: "page" | "element"; id: string };
  /** El problema, en español y sin el lugar. */
  message: string;
}

/** Un proyecto recién abierto, tal como lo devuelve `open_project`. */
export interface OpenedProject {
  /** La carpeta del proyecto, con su ruta real. */
  root: string;
  /** El documento, ya validado. */
  document: Document;
  /**
   * La revisión con la que queda abierto. Los resultados de compilación de
   * revisiones anteriores son de lo que había antes.
   */
  revision: number;
  /** El `.galera` del que sale y al que se guarda, o `null` si es una carpeta. */
  archive: string | null;
}

/** Un proyecto recién guardado. */
export interface SavedProject {
  /** Dónde se ha guardado: la carpeta o el `.galera`. */
  path: string;
  /** La carpeta de trabajo del proyecto. */
  root: string;
  /** El `.galera` al que se guarda de ahora en adelante, si lo hay. */
  archive: string | null;
  /** La revisión guardada. */
  revision: number;
}

/**
 * Enseña el diálogo nativo para elegir la carpeta de un proyecto.
 *
 * Devuelve la ruta elegida, o `null` si se cancela. El backend solo abre
 * carpetas elegidas aquí: una ruta escrita a mano se rechaza.
 */
export function chooseProjectFolder(): Promise<string | null> {
  return invoke<string | null>("choose_project_folder");
}

/**
 * Abre la carpeta de un proyecto, elegida antes con `chooseProjectFolder`.
 *
 * Además, el backend empieza a compilarlo en segundo plano: el resultado
 * llega con los eventos de compilación (ver `hooks/useCompilation.ts`).
 *
 * Si falla, la promesa se rechaza con un `CommandError`, y lo que hubiera
 * abierto sigue abierto.
 */
export function openProject(path: string): Promise<OpenedProject> {
  return invoke<OpenedProject>("open_project", { path });
}

/**
 * Crea un proyecto vacío donde se diga en el diálogo nativo —una carpeta o
 * un `.galera`— y lo abre. `null` si se cancela el diálogo.
 *
 * El proyecto nace con una página A4 vacía y el nombre de lo elegido como
 * título.
 */
export function newProject(archive: boolean): Promise<OpenedProject | null> {
  return invoke<OpenedProject | null>("new_project", { archive });
}

/**
 * Enseña el diálogo nativo para elegir un archivo `.galera`. Devuelve el
 * elegido, o `null` si se cancela.
 */
export function chooseProjectFile(): Promise<string | null> {
  return invoke<string | null>("choose_project_file");
}

/**
 * Guarda el proyecto abierto donde ya estaba: el `document.json` de su
 * carpeta y, si vino de un `.galera`, también el archivo.
 */
export function saveProject(): Promise<SavedProject> {
  return invoke<SavedProject>("save_project");
}

/**
 * Guarda el proyecto en otro sitio y sigue guardando ahí: un `.galera`
 * (`archive`) o una carpeta vacía. `null` si se cancela el diálogo.
 */
export function saveProjectAs(archive: boolean): Promise<SavedProject | null> {
  return invoke<SavedProject | null>("save_project_as", { archive });
}

/** Si un valor recibido del backend es un `CommandError`. */
export function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/**
 * El texto que se enseña para un error, venga de donde venga: un
 * `CommandError` del backend, un `Error` de JavaScript o cualquier otra cosa.
 */
export function errorMessage(reason: unknown): string {
  if (isCommandError(reason)) {
    return reason.message;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

/** Una página compilada, tal como la devuelve `render_page`. */
export interface RenderedPage {
  /** El SVG de la página, o `null` si el documento no compila. */
  svg: string | null;
  /** Los avisos si compiló; los errores de Typst si no. */
  diagnostics: Diagnostic[];
  /** Por qué no compila, o `null` si compiló. */
  error: CommandError | null;
  /** Lo que tardó la compilación de la que sale, en milisegundos. */
  ms: number;
  /** Si sale de una compilación anterior, sin compilar ahora. */
  reused: boolean;
  /** La revisión del documento que se compiló. */
  revision: number;
  /** La caja real de cada elemento de esta página. Vacía si no compila. */
  boxes: LayoutBox[];
}

/**
 * Pide el SVG de una página del documento abierto, contando desde 0.
 *
 * Un documento que no compila **no** rechaza la promesa: llega como datos,
 * con `svg: null` y el `error`. Solo se rechaza si no hay nada abierto o la
 * página no existe.
 */
export function renderPage(page: number): Promise<RenderedPage> {
  return invoke<RenderedPage>("render_page", { page });
}

/** Un PDF recién guardado, tal como lo devuelve `export_pdf`. */
export interface ExportedPdf {
  /** Dónde se guardó. */
  path: string;
  /** Cuánto ocupa, en bytes. */
  bytes: number;
}

/**
 * Exporta el documento abierto a PDF. El backend pregunta dónde guardarlo
 * con el diálogo nativo, proponiendo el título del documento como nombre.
 *
 * Devuelve `null` si se cancela el diálogo. Se rechaza con un
 * `CommandError` si no hay nada abierto, si el documento no compila o si el
 * archivo no se puede escribir.
 */
export function exportPdf(): Promise<ExportedPdf | null> {
  return invoke<ExportedPdf | null>("export_pdf");
}

/**
 * Pide compilar el documento abierto en segundo plano. Vuelve enseguida: el
 * resultado llega con los eventos de compilación.
 */
export function requestCompilation(): Promise<void> {
  return invoke<void>("request_compilation");
}

/**
 * Los eventos de la compilación en segundo plano, emitidos por
 * `src-tauri/src/compile_worker.rs`.
 */
export const CompilationEvents = {
  start: "compilation:start",
  finish: "compilation:finish",
  error: "compilation:error",
} as const;

/** `compilation:start`: empieza una compilación. */
export interface CompilationStarted {
  revision: number;
}

/** `compilation:finish`: una compilación ha salido bien. */
export interface CompilationFinished {
  revision: number;
  /** Lo que tardó, en milisegundos. */
  ms: number;
  /** Si salió de una compilación anterior de la misma revisión. */
  reused: boolean;
  /** Los avisos de Typst. */
  diagnostics: Diagnostic[];
  /** El SVG de cada página. */
  pages: string[];
  /** La caja real de cada elemento, de todas las páginas. */
  boxes: LayoutBox[];
}

/** `compilation:error`: una compilación ha fallado. */
export interface CompilationFailed {
  revision: number;
  ms: number;
  reused: boolean;
  /** Los errores de Typst, si el fallo es de Typst. */
  diagnostics: Diagnostic[];
  /** Por qué falló. */
  error: CommandError;
}

/**
 * Dónde quedó cada glifo de un bloque de texto, en mm de la página y sin
 * girar, según la última compilación buena: la que se está viendo.
 *
 * Sale vacío si todavía no hay nada compilado, si el elemento no existe o
 * si no es un bloque de texto.
 */
export function glyphs(id: string): Promise<Glyph[]> {
  return invoke<Glyph[]>("glyphs", { id });
}

/**
 * El id del elemento bajo un punto de la página, en mm, o `null` si no hay
 * ninguno. Lo decide el núcleo con la última compilación buena, la que se ve.
 *
 * `tolerance` ensancha cada elemento, en mm. Con `below` se pide atravesar:
 * si ese elemento está bajo el punto, devuelve el siguiente hacia abajo.
 */
export function elementAt(
  page: number,
  x: number,
  y: number,
  tolerance: number,
  below: string | null,
): Promise<string | null> {
  return invoke<string | null>("element_at", { page, x, y, tolerance, below });
}

/**
 * A dónde se engancha la caja que se está moviendo o redimensionando, y qué
 * guías dibujar mientras tanto. `ids` son los elementos que se mueven: no
 * se engancha a ellos. Lo decide el núcleo (`galera_core::snap`)
 * con la última compilación buena, la que se ve.
 *
 * `rect` es dónde la tiene el ratón ahora mismo, en mm de la página;
 * `grips` dice qué se está moviendo en cada eje (la caja entera al
 * arrastrar, un borde al redimensionar). `dx` y `dy` de la respuesta son
 * cuánto hay que correr **eso que se agarra**, no siempre la caja entera.
 *
 * Sale todo a cero y sin guías si todavía no hay nada compilado.
 */
export function snapTo(
  page: number,
  ids: readonly string[],
  rect: MmRect,
  grips: Grips,
  settings: SnapSettings,
): Promise<Snapped> {
  return invoke<Snapped>("snap", { page, ids, rect, grips, settings });
}

/**
 * Los elementos de la página que toca el rectángulo de selección, en mm, de
 * abajo arriba. Lo decide el núcleo con la última compilación buena, la que
 * se ve; los bloqueados no entran.
 *
 * Se puede arrastrar en cualquier dirección: un ancho o un alto negativos
 * valen.
 */
export function elementsIn(page: number, rect: MmRect): Promise<string[]> {
  return invoke<string[]>("elements_in", { page, rect });
}

/**
 * Lleva varios elementos de la caja conjunta `from` a la caja `to`, en mm.
 *
 * Qué le toca a cada uno lo reparte el núcleo, y entra como **un solo**
 * cambio del documento: una compilación y un paso del historial.
 */
export function scaleGroup(ids: readonly string[], from: MmRect, to: MmRect): Promise<AppliedOp> {
  return invoke<AppliedOp>("scale_group", { ids, from, to });
}

/**
 * Alinea varios elementos, respecto a la selección o a la página.
 *
 * Las cuentas son del núcleo, con las cajas de la compilación que se ve.
 * Devuelve `null` si no había nada que mover: entonces no se apunta ningún
 * paso del historial.
 */
export function alignElements(
  ids: readonly string[],
  how: Alignment,
  toPage: boolean,
): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("align_elements", { ids, how, toPage });
}

/**
 * Reparte varios elementos con el mismo hueco entre ellos: entre los dos que
 * están más lejos, o de borde a borde de la página con `toPage`.
 */
export function spreadElements(
  ids: readonly string[],
  axis: Spread,
  toPage: boolean,
): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("spread_elements", { ids, axis, toPage });
}

/**
 * Copia esos elementos y devuelve su texto plano, para dejarlo en el
 * portapapeles del sistema.
 *
 * Lo copiado se queda en la aplicación, con los recursos y las fuentes que
 * necesita, para poder pegarlo en otro documento.
 */
export function copyElements(ids: readonly string[]): Promise<string> {
  return invoke<string>("copy_elements", { ids });
}

/**
 * Pega lo último que se copió en esa página, en el punto `(x, y)` en mm o
 * desplazado si no se dice dónde. `null` si no hay nada copiado.
 */
export function pasteElements(
  page: string,
  at?: { x: number; y: number },
): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("paste_elements", {
    page,
    x: at?.x ?? null,
    y: at?.y ?? null,
  });
}

/** Duplica esos elementos en su misma página, sin tocar lo copiado. */
export function duplicateElements(ids: readonly string[]): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("duplicate_elements", { ids });
}

/**
 * El código Typst del documento abierto, tal como lo devuelve
 * `generated_code`, con dónde está cada elemento dentro de él.
 */
export interface GeneratedCode {
  /** El código entero. */
  code: string;
  /** Dónde empieza y acaba el código de cada elemento, en bytes. */
  spans: CodeSpan[];
  /** La revisión del documento del que salió. */
  revision: number;
}

/**
 * El código Typst del documento abierto: **la salida** del editor, para
 * verla. Se genera del documento de ahora, no de la última compilación.
 */
export function generatedCode(): Promise<GeneratedCode> {
  return invoke<GeneratedCode>("generated_code");
}

/**
 * Dónde está roto el código de un bloque, por líneas.
 *
 * Son los errores **de sintaxis**, los que se ven sin compilar: es lo que
 * hace falta mientras se escribe. Lo que falla al evaluar sale al compilar,
 * con el resto de los problemas del documento.
 */
export function checkCode(source: string): Promise<CodeError[]> {
  return invoke<CodeError[]>("check_code", { source });
}

/** Lo que se sabe de una variable, además de su valor. */
export interface VariableStatus {
  /** Los elementos que la usan, por su id y en orden del documento. */
  usedBy: string[];
  /** Por qué su valor no vale para su tipo, o `null` si vale. */
  invalid: string | null;
}

/**
 * Dónde se usa una variable y si su valor vale para su tipo. Las dos cosas
 * las decide el núcleo.
 */
export function variableStatus(name: string): Promise<VariableStatus> {
  return invoke<VariableStatus>("variable_status", { name });
}

/** Una plantilla de las que trae la aplicación, lista para enseñar. */
export interface TemplateCard {
  /** Su carpeta: `informe`. */
  id: string;
  /** Cómo se llama. */
  name: string;
  /** Una línea de qué es. */
  description: string;
  /** De qué grupo es, si lo dice. */
  category?: string | null;
  /** Su primera página compuesta por Typst, o `null` si no compone. */
  preview: string | null;
  /** Las variables que declara. */
  variables: string[];
}

/** Las plantillas que trae la aplicación, con su vista previa. */
export function templates(): Promise<TemplateCard[]> {
  return invoke<TemplateCard[]>("templates");
}

/**
 * Empieza un documento desde una plantilla: pregunta dónde guardarlo, copia
 * la plantilla entera y abre la copia. `null` si se cancela.
 */
export function newFromTemplate(id: string, archive: boolean): Promise<OpenedProject | null> {
  return invoke<OpenedProject | null>("new_from_template", { id, archive });
}

/** Un CSV leído, tal como lo devuelve `choose_csv`. */
export interface LoadedCsv extends Csv {
  /** De dónde salió. */
  path: string;
  /** Qué columna le toca a cada variable. */
  mapping: Mapping;
  /** Las filas ya miradas: lo que valdría cada variable y lo que falta. */
  checked: Row[];
}

/**
 * Enseña el diálogo para elegir un CSV y lo lee, con el separador y la
 * codificación adivinados. `null` si se cancela.
 */
export function chooseCsv(): Promise<LoadedCsv | null> {
  return invoke<LoadedCsv | null>("choose_csv");
}

/** Vuelve a leer un CSV ya elegido con otro separador u otra codificación. */
export function readCsv(
  path: string,
  separator: string,
  encoding: Encoding,
): Promise<LoadedCsv> {
  return invoke<LoadedCsv>("read_csv", { path, separator, encoding });
}

/** Vuelve a mirar las filas con otro emparejamiento, sin releer el archivo. */
export function checkRows(csv: Csv, mapping: Mapping): Promise<Row[]> {
  return invoke<Row[]>("check_rows", { csv, mapping });
}

/** Un comando de edición aplicado, tal como lo devuelve `apply_op`. */
export interface AppliedOp {
  /** La revisión con la que queda el documento; su compilación ya incluye el cambio. */
  revision: number;
  /** El documento con el cambio. */
  document: Document;
  /** Un nombre legible de lo que se ha hecho, deshecho o rehecho: «Mover r1». */
  description: string;
  /** Qué se desharía ahora, o `null` si no hay nada. */
  undo: string | null;
  /** Qué se reharía ahora, o `null` si no hay nada. */
  redo: string | null;
}

/**
 * Aplica un comando de edición al documento abierto. El backend lo aplica,
 * pide compilar y devuelve el documento nuevo; la compilación llega por
 * eventos. Se rechaza con un `CommandError` (`kind: "op"`) si no se puede
 * aplicar, y entonces no cambia nada.
 *
 * Se apunta en el historial; los comandos seguidos con el mismo `group` son
 * un único paso (varios empujones con las flechas, por ejemplo).
 */
export function applyOp(op: Op, group?: string): Promise<AppliedOp> {
  return invoke<AppliedOp>("apply_op", { op, group: group ?? null });
}

/**
 * Deshace el último paso del historial. `null` si no había nada que
 * deshacer. Como `applyOp`, el backend pide compilar y el resultado llega
 * por eventos.
 */
export function undo(): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("undo");
}

/** Rehace el último paso deshecho. `null` si no había nada que rehacer. */
export function redo(): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("redo");
}

/**
 * El estilo con el que nace un texto nuevo en el documento abierto: el del
 * primer texto que ya hay, o la primera fuente del proyecto a 12 pt. `null`
 * si el proyecto no tiene ninguna fuente, y entonces no se puede crear un
 * texto hasta añadir una (`addFont`).
 */
export function textDefaults(): Promise<TextStyle | null> {
  return invoke<TextStyle | null>("text_defaults");
}

/**
 * Pide un archivo de fuente con el diálogo nativo, lo copia en la carpeta
 * `fonts/` del proyecto y lo añade al documento, que se recompila. `null`
 * si se cancela el diálogo. Se rechaza con `kind: "font"` si el archivo no
 * es una fuente.
 */
export function addFont(): Promise<AppliedOp | null> {
  return invoke<AppliedOp | null>("add_font");
}

/** Una imagen ya copiada en el proyecto y registrada en `assets`. */
export interface ImageAsset {
  /** Su clave en `assets`, para el elemento. */
  key: string;
  /** Su ruta dentro del proyecto. */
  path: string;
}

/** Un archivo que no se pudo añadir, y por qué. */
export interface RejectedFile {
  file: string;
  message: string;
}

/** El resultado de añadir imágenes al proyecto. */
export interface ImportedImages {
  /** El documento con las imágenes registradas, o `null` si no se añadió ninguna. */
  applied: AppliedOp | null;
  /** Las añadidas, en orden. */
  images: ImageAsset[];
  /** Las que no, con su motivo. */
  rejected: RejectedFile[];
}

/**
 * Copia en `assets/` del proyecto las imágenes soltadas sobre la ventana y
 * las registra en el documento. Solo acepta archivos que de verdad se han
 * soltado (lo comprueba el backend); los demás, y los que no son imágenes,
 * vuelven en `rejected`.
 */
export function importImages(paths: string[]): Promise<ImportedImages> {
  return invoke<ImportedImages>("import_images", { paths });
}

/** Pide imágenes con el diálogo nativo y las añade al proyecto. */
export function chooseImages(): Promise<ImportedImages> {
  return invoke<ImportedImages>("choose_images");
}

/** Algo que se arrastra desde el sistema sobre la ventana, en píxeles CSS. */
export type FileDrop =
  | { type: "over"; x: number; y: number }
  | { type: "drop"; paths: string[]; x: number; y: number }
  | { type: "leave" };

/**
 * Escucha lo que se arrastra desde el sistema (el Finder, el escritorio)
 * sobre la ventana. Devuelve cómo dejar de escuchar.
 *
 * Tauri da la posición en píxeles físicos; aquí se pasa a píxeles CSS,
 * que son los de `clientX` y `clientY`. Fuera de Tauri no escucha nada.
 */
export function subscribeToFileDrops(handler: (drop: FileDrop) => void): Promise<() => void> {
  let webview;
  try {
    webview = getCurrentWebview();
  } catch {
    // Fuera de Tauri (en las pruebas o en un navegador) no hay ventana a la
    // que soltar nada.
    return Promise.resolve(() => undefined);
  }
  return webview.onDragDropEvent(({ payload }) => {
    const scale = window.devicePixelRatio || 1;
    if (payload.type === "leave") {
      handler({ type: "leave" });
    } else if (payload.type === "drop") {
      handler({ type: "drop", paths: payload.paths, x: payload.position.x / scale, y: payload.position.y / scale });
    } else {
      handler({ type: "over", x: payload.position.x / scale, y: payload.position.y / scale });
    }
  });
}

/** Un recurso del documento, para el panel de recursos. */
export interface AssetInfo {
  /** Su clave en `assets`. */
  key: string;
  /** Su ruta dentro del proyecto. */
  path: string;
  /** Su formato («PNG»), o `null` si el archivo no está o no es una imagen. */
  format: string | null;
  /** Su tipo MIME, o `null` como `format`. */
  mime: string | null;
  /** Cuánto ocupa, en bytes, o `null` si el archivo no está. */
  bytes: number | null;
  /** Los elementos que lo usan. */
  users: string[];
}

/** Los recursos del documento abierto, en orden de clave. */
export function listAssets(): Promise<AssetInfo[]> {
  return invoke<AssetInfo[]>("list_assets");
}

/** El contenido de un recurso, para su miniatura. Vacío si no se puede leer. */
export function assetData(key: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("asset_data", { key });
}

/** Una fuente que declara el documento, para el panel de fuentes. */
export interface FontInfo {
  /** Su ruta, tal como está en `fonts`. */
  path: string;
  /** Las familias que trae; vacío si el archivo no está o no es una fuente. */
  families: string[];
  /** Cuánto ocupa, en bytes, o `null` si no está. */
  bytes: number | null;
  /** Los textos que se quedarían sin tipografía si se quitara. */
  users: string[];
}

/** Las fuentes que declara el documento abierto, en su orden. */
export function listFonts(): Promise<FontInfo[]> {
  return invoke<FontInfo[]>("list_fonts");
}

/**
 * Las familias de las fuentes del proyecto: las únicas que puede usar un
 * texto. Nunca las del sistema (principio 4).
 */
export function fontFamilies(): Promise<string[]> {
  return invoke<string[]>("font_families");
}

/** Una muestra de la fuente, en SVG, dibujada por Typst con ese archivo. */
export function fontSample(path: string): Promise<string> {
  return invoke<string>("font_sample", { path });
}

/**
 * Deja de declarar una fuente. Se rechaza con `kind: "font_in_use"` y los
 * textos que la usan si alguno la necesita. Entra en el historial.
 */
export function removeFont(path: string): Promise<AppliedOp> {
  return invoke<AppliedOp>("remove_font", { path });
}

/** Una copia de autoguardado que se puede recuperar. */
export interface Recovery {
  /** El proyecto al que pertenece: su carpeta o su `.galera`. */
  target: string;
  /** Cuándo se autoguardó, en segundos desde 1970. */
  savedAt: number;
  /** Cuándo se guardó el proyecto de verdad, o `null` si ya no está. */
  projectSavedAt: number | null;
}

/**
 * Las copias de autoguardado más nuevas que lo guardado, de la más reciente
 * a la más antigua. Vacío si no hay nada que recuperar.
 */
export function pendingRecoveries(): Promise<Recovery[]> {
  return invoke<Recovery[]>("pending_recoveries");
}

/**
 * Abre un proyecto con el documento de su copia de autoguardado. Queda con
 * cambios sin guardar: recuperar no guarda nada.
 */
export function recover(target: string): Promise<OpenedProject> {
  return invoke<OpenedProject>("recover", { target });
}

/** Tira la copia de un proyecto: se sigue con lo guardado. */
export function discardRecovery(target: string): Promise<void> {
  return invoke<void>("discard_recovery", { target });
}

/** Cierra la ventana de verdad, tras preguntar por los cambios sin guardar. */
export function closeWindow(): Promise<void> {
  return invoke<void>("close_window");
}

/**
 * Avisa cuando se intenta cerrar la ventana con cambios sin guardar: el
 * backend no la cierra hasta que se decide (ver `ui/CloseDialog.tsx`).
 * Fuera de Tauri no escucha nada.
 */
export function onCloseRequested(handler: () => void): Promise<() => void> {
  return listen("app:close-requested", () => handler()).catch(() => () => undefined);
}
