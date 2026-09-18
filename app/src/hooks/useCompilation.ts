/**
 * Escucha los eventos de la compilación en segundo plano y los guarda en el
 * store de compilación.
 *
 * Se monta una vez, en la raíz de la interfaz. El backend compila en su
 * propio hilo (`src-tauri/src/compile_worker.rs`), así que la interfaz nunca
 * espera: sigue respondiendo —mover el lienzo, hacer zoom— mientras tanto, y
 * pinta el resultado cuando llega.
 *
 * Nota de Tauri: `listen` devuelve una promesa con la función para dejar de
 * escuchar. Si el componente se desmonta antes de que se resuelva, se deja
 * de escuchar en cuanto llega.
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import {
  CompilationEvents,
  type CompilationFailed,
  type CompilationFinished,
  type CompilationStarted,
} from "../commands";
import { useCompilationStore } from "../store/compilation";

export function useCompilation(): void {
  useEffect(() => {
    const store = () => useCompilationStore.getState();
    const subscriptions = [
      listen<CompilationStarted>(CompilationEvents.start, (event) => store().start(event.payload)),
      listen<CompilationFinished>(CompilationEvents.finish, (event) =>
        store().finish(event.payload),
      ),
      listen<CompilationFailed>(CompilationEvents.error, (event) => store().fail(event.payload)),
    ];

    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten());
      }
    };
  }, []);
}
