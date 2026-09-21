/**
 * Preguntar al núcleo a dónde se engancha lo que se está moviendo.
 *
 * El cálculo es del núcleo (principio 5), así que hay que ir y volver por
 * IPC, y eso es asíncrono. Para que el arrastre no dependa de la respuesta:
 *
 * - **El gesto no espera.** Cada movimiento coloca el elemento donde lo
 *   tiene el ratón y, además, pregunta. Cuando llega la respuesta, el
 *   elemento salta a su sitio: eso es el enganche.
 * - **Una pregunta a la vez.** Mientras hay una en el aire se guarda la
 *   última posición y se pregunta por ella al volver; las de en medio se
 *   tiran. Así no se encola una llamada por cada píxel.
 * - **Una respuesta solo vale para su caja.** Si el ratón ya está en otra,
 *   no se aplica: mover deprisa deja de enganchar, y al frenar vuelve. Más
 *   vale no ajustar que ajustar a donde el elemento ya no está.
 */
import { useRef, useState } from "react";

import { snapTo } from "../commands";
import type { MmRect } from "../types/layout";
import type { Grips, Settings, Snapped } from "../types/snap";
import { sameRect } from "./snapping";

export interface Snapping {
  /**
   * Pregunta por esta caja. Se llama desde el manejador del gesto, no al
   * dibujar.
   */
  ask: (page: number, id: string, rect: MmRect, grips: Grips, settings: Settings) => void;
  /** El ajuste que ya haya llegado **para esta caja**, o `null`. */
  at: (rect: MmRect) => Snapped | null;
  /** Olvida el ajuste: al soltar, al cancelar y mientras se desactiva. */
  clear: () => void;
}

/** Lo que se ha preguntado y todavía no se ha contestado. */
interface Question {
  page: number;
  id: string;
  rect: MmRect;
  grips: Grips;
  settings: Settings;
}

export function useSnap(): Snapping {
  /** La última respuesta, con la caja por la que se preguntó. */
  const answer = useRef<{ rect: MmRect; snapped: Snapped } | null>(null);
  /** La siguiente pregunta, si hay una en el aire. */
  const queued = useRef<Question | null>(null);
  const waiting = useRef(false);
  /** Sube con cada `clear`: lo que se contestó antes ya no vale. */
  const generation = useRef(0);
  /** Solo para volver a dibujar cuando llega una respuesta. */
  const [, redraw] = useState(0);

  const pump = () => {
    const question = queued.current;
    if (waiting.current || question === null) {
      return;
    }
    queued.current = null;
    waiting.current = true;
    const asked = generation.current;
    snapTo(question.page, question.id, question.rect, question.grips, question.settings)
      .then((snapped) => {
        // Puede haber llegado un `clear` mientras tanto: entonces sobra.
        if (asked === generation.current) {
          answer.current = { rect: question.rect, snapped };
          redraw((count) => count + 1);
        }
      })
      .catch(() => {
        // Sin respuesta del núcleo, el gesto sigue sin ajuste.
      })
      .finally(() => {
        waiting.current = false;
        pump();
      });
  };

  return {
    ask: (page, id, rect, grips, settings) => {
      queued.current = { page, id, rect, grips, settings };
      pump();
    },
    at: (rect) => {
      const found = answer.current;
      return found !== null && sameRect(found.rect, rect) ? found.snapped : null;
    },
    clear: () => {
      queued.current = null;
      generation.current += 1;
      if (answer.current !== null) {
        answer.current = null;
        redraw((count) => count + 1);
      }
    },
  };
}
