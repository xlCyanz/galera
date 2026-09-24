/**
 * La hoja de atajos: la lista entera, por grupos, sacada del registro
 * (`shortcuts.ts`). Se abre con ⌘/ o con el botón «Atajos», y se cierra con
 * Esc, con el botón o pulsando fuera.
 *
 * No hay una segunda lista que mantener: lo que se ve aquí es lo mismo que
 * responde al teclado, y `docs/atajos.md` se comprueba contra ello.
 */
import { useRef, useState } from "react";

import { useDialogFocus } from "../hooks/useDialogFocus";

import { useShortcut } from "../hooks/useShortcuts";
import { GROUPS, SHORTCUTS, type Shortcut, isMac, shortcutLabel } from "../shortcuts";

const mac = isMac();

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useShortcut("help", () => setOpen((shown) => !shown));

  const dialog = useRef<HTMLDivElement>(null);
  // El foco entra al abrir, no se sale con el tabulador, Esc cierra y el
  // foco vuelve a donde estaba.
  useDialogFocus(dialog, { active: open, onEscape: () => setOpen(false) });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts={mac ? "Meta+/" : "Control+/"}
        title={`Atajos de teclado (${shortcutLabel("help", mac)})`}
      >
        Atajos <kbd>{shortcutLabel("help", mac)}</kbd>
      </button>
      {open && (
        // Pulsar el fondo cierra; lo de dentro, no.
        <div className="close-dialog-backdrop" onPointerDown={() => setOpen(false)}>
          <div
            ref={dialog}
            tabIndex={-1}
            className="shortcuts-help"
            role="dialog"
            aria-modal="true"
            aria-label="Atajos de teclado"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="shortcuts-header">
              <h2>Atajos de teclado</h2>
              <button type="button" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>
            <div className="shortcuts-groups">
              {GROUPS.map((group) => (
                <section key={group}>
                  <h3>{group}</h3>
                  <dl>
                    {(SHORTCUTS as ReadonlyArray<Shortcut>)
                      .filter((one) => one.group === group)
                      .map((one) => (
                        <div key={one.id} className="shortcuts-row">
                          <dt>{one.label}</dt>
                          <dd>
                            <kbd>{shortcutLabel(one.id, mac)}</kbd>
                          </dd>
                        </div>
                      ))}
                  </dl>
                </section>
              ))}
            </div>
            <p className="shortcuts-note">
              Mientras se escribe en un campo, las teclas sueltas son texto: solo valen los atajos con{" "}
              {mac ? "⌘" : "Ctrl"}.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
