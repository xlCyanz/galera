/**
 * Llamadas al backend de Tauri.
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

/**
 * El estado de la sesión, tal como lo devuelve `session_status`.
 *
 * Tiene que coincidir con `SessionStatus` de
 * `src-tauri/src/commands/session.rs`. Una prueba en Rust fija los nombres de
 * los campos; a partir de F1-06 este tipo se generará desde Rust en vez de
 * escribirse a mano.
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
 * validación y los de Typst traen además el detalle por elemento, que se
 * tipará con F1-06.
 */
export interface CommandError {
  kind: string;
  message: string;
}

/**
 * El documento de un proyecto.
 *
 * Provisional: solo lo que la interfaz usa hoy. F1-06 lo sustituye por los
 * tipos generados desde el modelo de `galera-core`.
 */
export interface GaleraDocument {
  version: number;
  meta: { title: string };
  pages: readonly unknown[];
}

/** Un proyecto recién abierto, tal como lo devuelve `open_project`. */
export interface OpenedProject {
  /** La carpeta del proyecto, con su ruta real. */
  root: string;
  /** El documento, ya validado. */
  document: GaleraDocument;
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
