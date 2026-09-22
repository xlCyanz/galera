/**
 * Lo que hay que probar a mano en el spike, y el informe que sale de
 * probarlo.
 *
 * La automatización no sirve para esto: inyectar texto en el campo no pasa
 * por el sistema de entrada, así que no hay tecla muerta, ni IME, ni
 * dictado (ver `docs/decisiones/ime.md`). La sesión la hace una persona con
 * un teclado de verdad, y lo que cierra la issue es **lo que anota**.
 *
 * Por eso la página no se queda en una lista de recordatorios: cada caso se
 * marca como que funciona o que falla, y al marcarlo se guarda una foto de
 * cómo estaban el modelo, el espejo y los últimos eventos. De ahí sale un
 * informe en Markdown listo para pegar en la issue y en la decisión, sin
 * tener que recordar nada ni copiar tablas a mano.
 */

/** Un caso de los que pide la issue. */
export interface Check {
  /** Cómo se llama en la tabla de `docs/decisiones/ime.md`. */
  id: string;
  /** Qué hay que hacer, tal cual se lee en la página. */
  title: string;
}

/** Los ocho casos, en el orden en que conviene probarlos. */
export const CHECKS: Check[] = [
  {
    id: "teclado-espanol",
    title: "Teclado español: tilde con tecla muerta (´ + a), diéresis (¨ + u), ñ y ç",
  },
  { id: "emojis", title: "Emojis desde el panel del sistema (control + comando + espacio)" },
  { id: "otro-sistema", title: "Otro sistema de entrada: japonés (にほん → 日本), chino o coreano" },
  { id: "dictado", title: "Dictado del sistema (fn fn) escribiendo una frase entera" },
  { id: "pegar", title: "Pegar desde otra aplicación, texto de varias líneas incluido" },
  { id: "cortar-arrastrar", title: "Cortar, arrastrar y soltar texto, y deshacer del sistema (⌘Z)" },
  { id: "borrar", title: "Borrar con ⌫ un emoji y una letra con tilde" },
  { id: "flechas", title: "Teclas de flecha para mover el cursor y ⇧ + flecha para seleccionar" },
];

/** Una línea del registro de eventos de la página. */
export interface Entry {
  id: number;
  /** Milisegundos desde que se abrió la página. */
  at: number;
  /** `keydown`, `beforeinput`, `compositionupdate`… */
  type: string;
  /** El `inputType`, si el evento lo trae. */
  inputType: string | null;
  /** El texto del evento, si trae. */
  data: string | null;
  /** Si el evento llegó a medias de una composición. */
  composing: boolean;
  /** Qué se hizo con él. */
  outcome: "aplicado" | "sin manejar" | "nota";
}

/** Cómo quedó un caso al probarlo, con la foto del momento. */
export interface CheckResult {
  /** Si el caso pasó o no. */
  verdict: "ok" | "fail";
  /** El texto que llevaba el modelo al marcarlo. */
  model: string;
  /** Y el que llevaba el campo. */
  mirror: string;
  /** Los últimos eventos, del más viejo al más nuevo. Solo se enseñan los
   * de un caso que falla, que es donde hacen falta. */
  events: Entry[];
}

/** Cuántos eventos se guardan al marcar un caso. */
export const KEPT_EVENTS = 12;

/** Lo que se sabe de la sesión, además de los casos. */
export interface Session {
  /** El `navigator.userAgent` del webview donde se probó. */
  agent: string;
  /** El día, en `AAAA-MM-DD`. */
  date: string;
}

/** El texto entre comillas y con los saltos de línea a la vista. */
export function quote(text: string): string {
  return `«${text.replace(/\n/gu, "⏎")}»`;
}

/**
 * El informe de la sesión, en Markdown: la tabla de casos y, debajo, los
 * eventos de los que fallaron.
 *
 * Un caso sin marcar sale como pendiente, para que se vea qué quedó sin
 * probar en vez de dar por bueno lo que nadie miró.
 */
export function markdown(results: Readonly<Record<string, CheckResult>>, session: Session): string {
  const rows = CHECKS.map((check) => {
    const result = results[check.id];
    if (result === undefined) {
      return `| ${check.title} | pendiente | | |`;
    }
    return [
      `| ${check.title}`,
      result.verdict === "ok" ? "funciona" : "**falla**",
      quote(result.model),
      quote(result.mirror),
      "",
    ].join(" | ");
  });

  const failed = CHECKS.filter((check) => results[check.id]?.verdict === "fail");
  const detail = failed.flatMap((check) => {
    const result = results[check.id];
    if (result === undefined) {
      return [];
    }
    return [
      "",
      `### ${check.title}`,
      "",
      `Modelo ${quote(result.model)}, espejo ${quote(result.mirror)}.`,
      "",
      "| ms | evento | inputType | data | |",
      "|---|---|---|---|---|",
      ...result.events.map((entry) =>
        [
          `| ${entry.at}`,
          entry.type + (entry.composing ? " ⏳" : ""),
          entry.inputType ?? "",
          entry.data === null ? "" : quote(entry.data),
          entry.outcome === "nota" ? "" : entry.outcome,
          "",
        ].join(" | "),
      ),
    ];
  });

  return [
    `# Sesión a mano del spike de entrada (#55)`,
    "",
    `- Fecha: ${session.date}`,
    `- Webview: ${session.agent}`,
    `- Casos probados: ${Object.keys(results).length} de ${CHECKS.length}`,
    "",
    "| Caso | Resultado | Modelo | Espejo |",
    "|---|---|---|---|",
    ...rows,
    ...(failed.length === 0 ? [] : ["", "## Lo que falló", ...detail]),
    "",
  ].join("\n");
}
