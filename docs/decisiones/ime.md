# Entrada de teclado e IME dentro del webview

Spike F4-01 ([#55](https://github.com/xlCyanz/galera/issues/55)).

## Contexto

En la Fase 4 se escribe **encima del render de Typst**. El lienzo es un SVG
que devuelve el núcleo: no es un campo de texto, no tiene cursor propio y el
DOM no lleva el texto. Pero el texto tiene que poder escribirse con todo lo
que una persona usa de verdad: tildes con tecla muerta, diéresis, ñ, emojis
del panel del sistema, otro sistema de entrada (japonés, chino, coreano),
dictado, y pegar desde otra aplicación.

La sección 8 de `guide.md` lo marca como **el riesgo de la fase**: si el
webview no deja capturar todo eso, la Fase 4 entera cambia de enfoque. Por
eso esta tarea es un spike y va antes que el editor.

## Opciones

1. **Campo invisible que recibe el foco.** Un `<textarea>` de un píxel,
   transparente, colocado donde está el cursor. El sistema le habla a él
   —teclado, IME, dictado, portapapeles— y la aplicación lee los eventos
   `beforeinput`, `compositionstart/update/end` y `paste`. El texto lo lleva
   el modelo; el campo solo hace de antena. Es lo que hacen CodeMirror 6,
   ProseMirror y Monaco.
2. **`contenteditable` sobre el render.** El DOM llevaría el texto y el
   navegador lo editaría solo. Choca con el principio 1 (el documento lo
   manda el backend) y con el 2 (el lienzo enseña el render de Typst, no una
   imitación en HTML): habría dos textos que mantener iguales.
3. **Solo `keydown`, componiendo a mano.** No sirve: una tecla muerta no es
   un carácter, el IME no manda teclas y el dictado tampoco. Habría que
   reimplementar lo que ya decide el sistema, por sistema de entrada.
4. **Un campo nativo de macOS encima del webview.** Control total del IME,
   pero hay que colocarlo, darle el foco y sincronizarlo desde Rust por cada
   bloque de texto, y no vale para ningún otro sistema operativo.

## Decisión

**Opción 1**, con dos reglas que salen del prototipo:

- El campo es **invisible pero enfocable**: transparente y de un píxel, no
  `display: none` ni `visibility: hidden`, que le quitarían el foco y con él
  el IME.
- El campo **viaja con el cursor**. La ventana de candidatos del IME de
  macOS sale pegada al campo que tiene el foco: si el campo se queda en una
  esquina, los candidatos aparecen lejos del texto que se está escribiendo.
  Colocarlo necesita saber dónde está el cursor, que es lo que dan las
  posiciones de glifos de F4-05 ([#59](https://github.com/xlCyanz/galera/issues/59)).

El texto sigue viviendo **en el documento**, que lleva el backend
(principio 1): el campo es una copia de trabajo y cada cambio se manda como
un comando, con su paso en el historial.

### Corrección de F4-02: el campo lleva una copia del texto

Al implementarlo ([#56](https://github.com/xlCyanz/galera/issues/56)) se vio
que hay dos formas de usar el campo, y que la buena no es la que parecía:

- **Campo vacío**, con el modelo construido evento a evento
  ([`spike/input.ts`](../../app/src/text/spike/input.ts)). Obliga a
  reimplementar a mano todo lo que no es un evento de entrada: ⌘A, inicio y
  fin, ⌥← y ⌥→, seleccionar con ⇧, y las costumbres de cada plataforma.
- **Campo con una copia del texto**, que es lo que se hace: el sistema mueve
  el cursor y selecciona dentro del campo con sus propias reglas, y la
  aplicación solo mira el resultado. Cada cambio se manda igualmente como un
  comando, y si el documento cambia por otro lado (deshacer, el inspector)
  la copia se vuelve a poner al día.

`spike/input.ts` se queda como está, documentando qué significa cada
`inputType`; el editor de verdad es
[`app/src/text/HiddenInput.tsx`](../../app/src/text/HiddenInput.tsx).

## El prototipo

- [`app/src/text/spike/`](../../app/src/text/spike/): `input.ts` (qué hace
  cada evento sobre el texto, sin DOM), `Ime.tsx` (la página) y sus pruebas.
- Enseña a la vez el **modelo** (lo que Galera construiría a partir de los
  eventos) y el **espejo** (lo que el navegador escribió por su cuenta en el
  campo). Si los dos textos no coinciden, el spike ha encontrado un hueco, y
  se ve en rojo. Un `inputType` que no se maneje también sale en rojo.
- Lleva el registro de eventos, con `inputType`, `data`, si llegaron a
  medias de una composición y cuánto tardó la última tecla. «Copiar el
  registro» lo deja en el portapapeles para pegarlo en la issue.
- Trae **los ocho casos de la sesión**, cada uno con «funciona» y «falla».
  Marcar uno guarda cómo estaban el modelo, el espejo y los doce últimos
  eventos en ese momento; volver a marcar lo mismo lo desmarca. «Copiar el
  informe» saca una tabla en Markdown con los ocho —los que no se probaron
  salen como pendientes— y, debajo, los eventos de los que fallaron. Esa
  tabla es la que va a la issue y la que sustituye a la de aquí abajo.

Cómo abrirlo:

```bash
VITE_SPIKE=ime pnpm tauri dev   # dentro del webview de la aplicación, que es lo que cuenta
pnpm --dir app dev              # y en http://localhost:1420/spike/ime.html, en un navegador
```

## Qué se ha comprobado y qué falta

Comprobado automáticamente (2026-09-20), en el navegador integrado
(Chromium), sobre la página del spike:

- Escribir texto normal llega como `beforeinput` con `inputType: insertText`,
  se aplica al modelo y **modelo y espejo coinciden**.
- La composición, el borrado por caracteres, por palabras y de emojis
  enteros, el pegado y el dictado están cubiertos por las pruebas de
  `input.ts`, con las secuencias de eventos que manda el navegador
  (`´` + `a` → `café`, `にほん` → `日本`, `insertFromPaste`,
  `insertReplacementText`).

**Falta la sesión a mano**, que es la que cierra la issue: la automatización
del navegador inyecta texto (`Input.insertText`) y no produce los eventos de
edición del sistema, y `execCommand` dispara `input` pero no `beforeinput`.
Nada de esto se puede afirmar sin un teclado de verdad:

| Caso | Resultado |
|---|---|
| Teclado español: `´` + `a`, `¨` + `u`, `ñ`, `ç` | pendiente |
| Emojis desde el panel del sistema | pendiente |
| Japonés (にほん → 日本) u otro sistema de entrada | pendiente |
| Dictado (fn fn) de una frase entera | pendiente |
| Pegar desde otra aplicación, con varias líneas | pendiente |
| Cortar, arrastrar y soltar, ⌘Z del sistema | pendiente |
| ⌫ sobre un emoji y sobre una letra con tilde | pendiente |
| Flechas y ⇧ + flecha | pendiente |

Cómo se hace, en cinco minutos:

1. `VITE_SPIKE=ime pnpm tauri dev`, que abre el spike **dentro del webview de
   la aplicación**, que es el que cuenta. En un navegador normal el resultado
   no vale: el webview de macOS es otro.
2. Probar los casos de arriba a abajo, marcando cada uno en la página según
   salga. Lo que se marca se queda con los dos textos y los últimos eventos.
3. «Copiar el informe» y pegarlo en la issue.
4. Traer aquí la tabla del informe, en lugar de esta, y escribir debajo la
   conclusión: si el campo invisible sirve o hay que ir a la opción 4.

Un caso que falle no cierra el spike por sí solo: lo que decide es si el
**modelo y el espejo se separan**. Que un `inputType` salga «sin manejar» en
el registro es trabajo para `input.ts`, no un fallo del enfoque.

## Consecuencias

- **F4-02 hereda `input.ts`** y el campo invisible; lo que cambia es de
  dónde sale la selección (del modelo del documento, no del campo).
- **Índices**: el DOM cuenta en unidades UTF-16 y el núcleo en bytes. La
  conversión es de quien junte las dos piezas —el mismo sitio que traduzca
  un `Glyph` a una posición de cursor—, y no se mezclan los dos criterios en
  una misma estructura.
- **Mientras hay composición no se manda nada al núcleo.** Compilar a medias
  de una tecla muerta enseñaría el `´` suelto en el PDF. El cambio se manda
  al terminar la composición, y hasta entonces se enseña subrayado, como
  hace el sistema.
- **Si la sesión a mano falla**, la alternativa es la opción 4: un campo
  nativo de macOS por encima del webview, colocado desde Rust, con el texto
  llegando por un comando de Tauri. Es más trabajo y no es portable, pero no
  depende de lo que el webview decida mandar.
