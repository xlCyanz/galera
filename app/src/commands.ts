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

import type { Diagnostic } from "./types/diagnostic";
import type { LayoutBox } from "./types/layout";
import type { Document } from "./types/model";
import type { Op } from "./types/ops";

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

/** Un comando de edición aplicado, tal como lo devuelve `apply_op`. */
export interface AppliedOp {
  /** La revisión con la que queda el documento; su compilación ya incluye el cambio. */
  revision: number;
  /** El documento con el cambio. */
  document: Document;
  /** Un nombre legible del cambio: «Mover r1». */
  description: string;
}

/**
 * Aplica un comando de edición al documento abierto. El backend lo aplica,
 * pide compilar y devuelve el documento nuevo; la compilación llega por
 * eventos. Se rechaza con un `CommandError` (`kind: "op"`) si no se puede
 * aplicar, y entonces no cambia nada.
 */
export function applyOp(op: Op): Promise<AppliedOp> {
  return invoke<AppliedOp>("apply_op", { op });
}
