# Atajos de teclado

Todos los atajos de Galera. Es la misma lista que responde al teclado: sale
de `app/src/shortcuts.ts`, y una prueba (`app/src/shortcuts.test.ts`)
comprueba que este archivo no se separa de ella.

En macOS el modificador es ⌘; en Windows y Linux, Ctrl.

## La lista

### Archivo

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Nuevo proyecto en una carpeta | `⌘N` | `Ctrl+N` |
| Nuevo proyecto .galera | `⌘⇧N` | `Ctrl+Shift+N` |
| Abrir una carpeta de proyecto | `⌘O` | `Ctrl+O` |
| Abrir un archivo .galera | `⌘⇧O` | `Ctrl+Shift+O` |
| Guardar | `⌘S` | `Ctrl+S` |
| Guardar como .galera… | `⌘⇧S` | `Ctrl+Shift+S` |
| Exportar a PDF… | `⌘⇧E` | `Ctrl+Shift+E` |

### Edición

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Deshacer | `⌘Z` | `Ctrl+Z` |
| Rehacer | `⌘⇧Z` | `Ctrl+Shift+Z` |
| Quitar la selección | `Esc` | `Esc` |
| Negrita | `⌘B` | `Ctrl+B` |
| Cursiva | `⌘I` | `Ctrl+I` |
| Subrayado | `⌘U` | `Ctrl+U` |
| Mover 1 mm a la izquierda (10 mm con ⇧) | `←` | `←` |
| Mover 1 mm a la derecha | `→` | `→` |
| Mover 1 mm hacia arriba | `↑` | `↑` |
| Mover 1 mm hacia abajo | `↓` | `↓` |

### Escribiendo en un texto

Doble clic en un bloque de texto entra a escribirlo. Mientras dura, las
teclas van al texto y no a las herramientas:

- El puntero coloca el cursor y selecciona: arrastrar elige un tramo, doble
  clic una palabra, triple clic un párrafo, y `⇧` + clic estira lo que ya
  hubiera. Pulsar fuera del texto sale de escribir.
- Las flechas mueven el cursor, no el elemento. `↑` y `↓` van por las líneas
  **que decidió Typst** —no por las del campo, que tiene otro ancho— y
  conservan la columna de la que se salió.
- `⌘A`, inicio, fin y `⌥←` / `⌥→` hacen dentro del texto lo que hacen en
  cualquier campo del sistema.
- `⌘B`, `⌘I` y `⌘U` aplican y quitan negrita, cursiva y subrayado sobre lo
  seleccionado. Encima de la selección sale una barra con esos tres botones,
  el color del texto y el enlace, que enseña el formato de lo elegido. El
  botón del enlace abre un campo con el destino: `Enter` lo pone, vaciarlo
  lo quita y `Esc` cierra el campo.
- Los botones de lista de la barra hacen de las líneas que toca la selección
  una lista con viñetas o numerada, y vuelven a pulsarse para quitarla.
  Dentro de una lista, `Tab` y `⇧Tab` cambian el nivel de anidado; fuera de
  una lista no hacen nada, y nunca se llevan el foco del texto.
- `Esc` sale de escribir. `⌘Z` deshace el documento, no el campo: cada
  cambio del texto ya es un paso del historial.

### Herramientas

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Selección | `V` | `V` |
| Texto | `T` | `T` |
| Rectángulo | `R` | `R` |
| Elipse | `O` | `O` |
| Línea | `L` | `L` |
| Imagen | `I` | `I` |
| Bloque de código | `C` | `C` |
| Mano | `H` | `H` |

### Vista

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Acercar | `⌘+` | `Ctrl++` |
| Alejar | `⌘−` | `Ctrl+−` |
| Zoom al 100 % | `⌘0` | `Ctrl+0` |
| Ajustar la página a la ventana | `⌘1` | `Ctrl+1` |
| Enseñar u ocultar las reglas | `⇧R` | `Shift+R` |

### Ayuda

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Ver todos los atajos | `⌘/` | `Ctrl+/` |

## Cómo funcionan

- **Un solo sitio.** Cada atajo está en `app/src/shortcuts.ts` con su nombre,
  su grupo y sus teclas. Quien lo atiende lo registra por su id
  (`useShortcut("save", …)`), y hay **un único** listener de teclado en toda
  la app (`app/src/hooks/useShortcuts.ts`).
- **Mientras se escribe.** En un campo de texto una letra suelta es texto:
  ahí solo valen los atajos con ⌘ o Ctrl, y ni siquiera deshacer y rehacer,
  que son los del propio campo.
- **Dentro de un gesto.** Mientras se arrastra, se redimensiona, se gira o se
  dibuja, `Esc` cancela **ese gesto** y `⇧` lo restringe (proporción, ángulos
  de 45°, movimiento recto). No son atajos: son parte del gesto, y solo
  valen mientras dura.
- **La barra espaciadora**, mantenida, deja desplazar la página arrastrando.
  Tampoco es un atajo: cuenta mientras está pulsada.

## La hoja de atajos en la app

El botón **Atajos** de la barra, o `⌘/`, abre la lista completa dentro de la
app, con las teclas de este sistema. Se cierra con `Esc`, con el botón o
pulsando fuera.

## Pendiente

El brief de diseño (F1-13, [#29](https://github.com/xlCyanz/galera/issues/29))
todavía no está en el repositorio. Estos atajos siguen la convención de los
editores de diseño; cuando llegue el brief, se ajustan en
`app/src/shortcuts.ts` y esta lista se actualiza con ellos.
