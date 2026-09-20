/**
 * Spike de entrada de texto (#55): ¿un campo invisible dentro del webview
 * captura todo lo que una persona puede escribir?
 *
 * No es parte de la aplicación: es una página aparte, `/spike/ime.html`,
 * sin Tauri ni almacén ni lienzo, para poder mirar solo la entrada. Lo que
 * se aprenda aquí se escribe en `docs/decisiones/ime.md` y lo hereda F4-02
 * (#56).
 *
 * # Cómo está montado
 *
 * - Un `textarea` de un píxel, transparente, **colocado en el cursor**: el
 *   IME de macOS enseña su ventana de candidatos justo donde está el campo
 *   que tiene el foco, así que tiene que viajar con el cursor.
 * - El navegador escribe en ese campo con total normalidad: es el
 *   **espejo**, lo que de verdad entiende el sistema.
 * - A la vez, cada `beforeinput` pasa por [`apply`] y construye el
 *   **modelo**, que es como editará Galera: el texto lo lleva la
 *   aplicación, no el DOM.
 *
 * Si los dos textos coinciden, el camino de F4-02 sirve. Si se separan, el
 * spike ha encontrado justo lo que venía a buscar, y se ve en la página.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Composition, type Field, apply } from "./input";
import "./ime.css";

/** Una línea del registro de eventos. */
type Entry = {
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
};

/** Lo que hay que probar a mano, que es lo que pide la issue. */
const CHECKS = [
  "Teclado español: tilde con tecla muerta (´ + a), diéresis (¨ + u), ñ y ç",
  "Emojis desde el panel del sistema (control + comando + espacio)",
  "Otro sistema de entrada: japonés (にほん → 日本), chino o coreano",
  "Dictado del sistema (fn fn) escribiendo una frase entera",
  "Pegar desde otra aplicación, texto de varias líneas incluido",
  "Cortar, arrastrar y soltar texto, y deshacer del sistema (⌘Z)",
  "Borrar con ⌫ un emoji y una letra con tilde",
  "Teclas de flecha para mover el cursor y ⇧ + flecha para seleccionar",
];

export function Ime() {
  const [field, setField] = useState<Field>({ text: "", start: 0, end: 0 });
  const [composition, setComposition] = useState<Composition>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [mirror, setMirror] = useState("");
  /** Lo que tardó el último cambio desde que se pulsó la tecla. */
  const [latency, setLatency] = useState<number | null>(null);

  /** El modelo tal como está ahora mismo: los escuchadores se montan una
   * vez y no ven el estado de React. */
  const current = useRef<Field>({ text: "", start: 0, end: 0 });
  const input = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const pressed = useRef<number | null>(null);
  const counter = useRef(0);
  /** Si hay una composición a medias, y qué tramo ocupa. Son referencias
   * porque los escuchadores del campo se montan una sola vez. */
  const composing = useRef(false);
  const compositionRange = useRef<Composition>(null);

  const note = (entry: Omit<Entry, "id" | "at">) => {
    counter.current += 1;
    const line = { ...entry, id: counter.current, at: Math.round(performance.now()) };
    setLog((entries) => [line, ...entries].slice(0, 80));
  };

  // El campo invisible va donde está el cursor: la ventana de candidatos
  // del IME sale pegada a él, no en una esquina.
  useLayoutEffect(() => {
    const target = caret.current;
    const field = input.current;
    if (target !== null && field !== null) {
      field.style.left = `${target.offsetLeft}px`;
      field.style.top = `${target.offsetTop}px`;
      field.style.height = `${target.offsetHeight}px`;
    }
  });

  useEffect(() => {
    const field = input.current;
    if (field === null) {
      return;
    }
    field.focus();

    const onBeforeInput = (event: InputEvent) => {
      // Fuera de una composición, la selección buena es la del campo: ahí
      // es donde el navegador va a escribir.
      const range = composing.current
        ? current.current
        : { ...current.current, start: field.selectionStart, end: field.selectionEnd };
      const data = event.data ?? textOf(event);
      const applied = apply(range, compositionRange.current, { inputType: event.inputType, data });
      note({
        type: "beforeinput",
        inputType: event.inputType,
        data,
        composing: event.isComposing,
        outcome: applied === null ? "sin manejar" : "aplicado",
      });
      if (applied === null) {
        return;
      }
      current.current = applied.field;
      compositionRange.current = applied.composition;
      setField(applied.field);
      setComposition(applied.composition);
      if (pressed.current !== null) {
        setLatency(Math.round(performance.now() - pressed.current));
        pressed.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      pressed.current = performance.now();
      note({
        type: "keydown",
        inputType: null,
        data: event.key,
        composing: event.isComposing,
        outcome: "nota",
      });
    };

    const onCompositionStart = (event: CompositionEvent) => {
      composing.current = true;
      compositionRange.current = null;
      note({
        type: "compositionstart",
        inputType: null,
        data: event.data,
        composing: true,
        outcome: "nota",
      });
    };

    const onCompositionEnd = (event: CompositionEvent) => {
      composing.current = false;
      compositionRange.current = null;
      setComposition(null);
      note({
        type: "compositionend",
        inputType: null,
        data: event.data,
        composing: false,
        outcome: "nota",
      });
    };

    const onInput = () => setMirror(field.value);

    field.addEventListener("beforeinput", onBeforeInput);
    field.addEventListener("keydown", onKeyDown);
    field.addEventListener("compositionstart", onCompositionStart);
    field.addEventListener("compositionupdate", (event) =>
      note({
        type: "compositionupdate",
        inputType: null,
        data: event.data,
        composing: true,
        outcome: "nota",
      }),
    );
    field.addEventListener("compositionend", onCompositionEnd);
    field.addEventListener("input", onInput);

    return () => {
      field.removeEventListener("beforeinput", onBeforeInput);
      field.removeEventListener("keydown", onKeyDown);
      field.removeEventListener("compositionstart", onCompositionStart);
      field.removeEventListener("compositionend", onCompositionEnd);
      field.removeEventListener("input", onInput);
    };
  }, []);

  const same = mirror === field.text;

  return (
    <main className="spike">
      <h1>Spike de entrada de texto</h1>
      <p className="spike-lead">
        El campo que recibe el teclado es invisible y mide un píxel: está donde se ve el cursor. Escribe
        aquí debajo y compara el <strong>modelo</strong> (lo que Galera construiría a partir de los
        eventos) con el <strong>espejo</strong> (lo que el navegador escribió por su cuenta).
      </p>

      <section
        className="spike-canvas"
        onMouseDown={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <pre className="spike-text">
          {field.text.slice(0, composition?.start ?? field.start)}
          {composition !== null && (
            <span className="spike-composing">{field.text.slice(composition.start, composition.end)}</span>
          )}
          <span className="spike-caret" ref={caret} />
          {field.text.slice(composition?.end ?? field.start)}
        </pre>
        <textarea
          ref={input}
          className="spike-input"
          aria-label="Campo invisible del spike"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </section>

      <section className="spike-state">
        <p>
          <span className={same ? "spike-ok" : "spike-bad"}>{same ? "coinciden" : "no coinciden"}</span>{" "}
          modelo y espejo{latency === null ? "" : ` · última tecla: ${latency} ms`}
        </p>
        <dl>
          <dt>Modelo</dt>
          <dd>{quote(field.text)}</dd>
          <dt>Espejo</dt>
          <dd>{quote(mirror)}</dd>
          <dt>Selección</dt>
          <dd>
            {field.start}–{field.end}
            {composition === null ? "" : ` · componiendo ${composition.start}–${composition.end}`}
          </dd>
        </dl>
        <button type="button" onClick={() => navigator.clipboard.writeText(report(log, field.text, mirror))}>
          Copiar el registro
        </button>
      </section>

      <section className="spike-checks">
        <h2>Qué hay que probar</h2>
        <ul>
          {CHECKS.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </section>

      <section className="spike-log">
        <h2>Eventos</h2>
        <table>
          <thead>
            <tr>
              <th>ms</th>
              <th>evento</th>
              <th>inputType</th>
              <th>data</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {log.map((entry) => (
              <tr key={entry.id} className={entry.outcome === "sin manejar" ? "spike-bad" : undefined}>
                <td>{entry.at}</td>
                <td>
                  {entry.type}
                  {entry.composing ? " ⏳" : ""}
                </td>
                <td>{entry.inputType ?? ""}</td>
                <td>{entry.data === null ? "" : quote(entry.data)}</td>
                <td>{entry.outcome === "nota" ? "" : entry.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

/** Si el evento no trae `data`, lo que se pega o se arrastra viene en el
 * portapapeles del propio evento. */
function textOf(event: InputEvent): string | null {
  return event.dataTransfer?.getData("text/plain") ?? null;
}

/** El texto entre comillas y con los saltos de línea a la vista. */
function quote(text: string): string {
  return `«${text.replace(/\n/gu, "⏎")}»`;
}

/** El registro en texto plano, para pegarlo en la issue. */
function report(log: Entry[], model: string, mirror: string): string {
  const lines = log
    .slice()
    .reverse()
    .map(
      (entry) =>
        `${entry.at}\t${entry.type}\t${entry.inputType ?? ""}\t${entry.data ?? ""}\t${entry.outcome}`,
    );
  return [
    `navegador: ${navigator.userAgent}`,
    `modelo: ${model}`,
    `espejo: ${mirror}`,
    "",
    ...lines,
  ].join("\n");
}
