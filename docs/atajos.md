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
| Seleccionar todo lo de la página | `⌘A` | `Ctrl+A` |
| Copiar | `⌘C` | `Ctrl+C` |
| Cortar | `⌘X` | `Ctrl+X` |
| Pegar | `⌘V` | `Ctrl+V` |
| Duplicar | `⌘D` | `Ctrl+D` |
| Borrar lo seleccionado | `⌫` | `Supr` |
| Agrupar | `⌘G` | `Ctrl+G` |
| Desagrupar | `⌘⇧G` | `Ctrl+Shift+G` |
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
- En una tabla, el doble clic entra en la celda que haya debajo y `Tab` y
  `⇧Tab` pasan a la siguiente y a la anterior, dando la vuelta al llegar al
  final. `⇧` o `⌘` + clic en otra celda la suma a las marcadas, y entonces
  `⌘B`, `⌘I` y `⌘U` van al texto entero de todas ellas de una vez. El botón
  derecho sobre una celda abre el menú de la tabla: meter y quitar filas y
  columnas, combinar la celda con las marcadas y separar una combinada. Con
  la tabla seleccionada, el borde de cada columna se arrastra
  para cambiar lo que mide.
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
| Tabla | `B` | `B` |
| Zona de texto | `F` | `F` |
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
- **Copiar y pegar.** Lo copiado se queda en la aplicación con los
  recursos y las fuentes que necesita, así que se puede pegar **en otro
  documento** sin que quede una imagen rota ni un texto con otra
  tipografía. Lo pegado estrena ids y aparece desplazado unos milímetros,
  ya seleccionado. Al portapapeles del sistema va el **texto plano** de lo
  copiado, para pegarlo fuera. Dentro de un texto, `⌘C`, `⌘X` y `⌘V` son
  del texto.
- **Borrar.** `⌫` (`Supr` fuera de macOS; valen las dos) borra lo
  seleccionado en un solo paso, que se deshace de una vez. Solo con el foco
  en el lienzo, en la lista de capas o en ninguna parte: en un diálogo, un
  menú, la lista de páginas o un botón no hace nada, y escribiendo borra
  texto. Lo bloqueado no se borra y se queda seleccionado. Es cortar sin
  copiar.
- **Los grupos.** `⌘G` mete lo seleccionado en un grupo, que a partir de
  ahí se mueve, se gira y se estira como un solo elemento; `⌘⇧G` lo
  deshace. Agrupar no mueve nada de sitio: lo que cambia es desde dónde se
  cuentan las posiciones de los hijos. **Doble clic** en un grupo entra en
  él para trabajar con lo que lleva dentro, y `Esc` sale.
- **La multiselección.** `⇧` + clic añade un elemento a la selección o lo
  quita, en el lienzo y en el panel de capas. Arrastrar desde una zona
  vacía dibuja el rectángulo de selección, que coge lo que toca (con `⇧`,
  sumando a lo que ya hubiera); `Esc` lo cancela. Con varios seleccionados
  el lienzo enseña una sola caja: se mueve y se estira, pero no se gira.
- **El ajuste a las guías.** Al mover y al redimensionar, el elemento se
  engancha a los bordes y los centros de los demás, a los de la página y a
  los espaciados que ya hay, y salen las guías con las distancias.
  Mantener `⌘` (`Ctrl` fuera de macOS) lo desactiva mientras dure el gesto;
  `⇧` y `⌥` al redimensionar también, porque entonces manda la forma.
- **La barra espaciadora**, mantenida, deja desplazar la página arrastrando.
  Tampoco es un atajo: cuenta mientras está pulsada.

## Sin ratón

Todo lo que se hace con el ratón tiene su camino con el teclado (F8-02,
[#89](https://github.com/xlCyanz/galera/issues/89)). El tabulador recorre la
ventana en el orden en que se ve: los botones de arriba, las herramientas, el
lienzo, los paneles, el inspector y la barra de estado. Donde está el foco se
ve siempre, con un anillo que contrasta 3:1 con cualquier fondo en los dos
temas.

- **El lienzo** es una parada del tabulador. Con una herramienta de crear,
  `Intro` pone el elemento del tamaño por defecto en el centro de la página,
  como un clic sin arrastrar; con la de imagen, abre el diálogo para
  elegirla. Con algo seleccionado, `Intro` entra: a escribir en un texto,
  una zona o una tabla —como el doble clic— o a lo que lleva dentro un
  grupo. `⌘A` selecciona todo lo de la página, o todo lo del grupo en el que
  se ha entrado; lo bloqueado y lo oculto se quedan fuera. Las flechas lo
  mueven, como siempre.
- **El panel de capas** es una lista: `↑` y `↓` seleccionan la capa de
  encima o de debajo, y con `⇧` la suman; `Inicio` y `Fin` van a los
  extremos. `⌥↑` y `⌥↓` suben o bajan la capa un puesto, que es lo que hace
  arrastrarla, e `Intro` o `F2` la renombran. Mientras el foco está en la
  lista, las flechas no mueven el elemento en el lienzo.
- **El panel de páginas**, igual: `↑` y `↓` cambian de página, `Inicio` y
  `Fin` van a la primera y a la última, y `⌥↑` y `⌥↓` mueven la página.
- **Escribiendo**, `⌥F10` lleva el foco a la barra de formato —el color y el
  enlace no son solo del ratón—; `←` y `→` la recorren y `Esc` vuelve al
  texto, que sigue abierto. En una celda, `⇧F10` o la tecla de menú abren
  el menú de la tabla; `↑` y `↓` recorren sus opciones y `Esc` vuelve a la
  celda.
- **Los diálogos** —exportar, los atajos, los cambios sin guardar, el
  selector de color— se llevan el foco al abrirse, no lo sueltan con el
  tabulador, se cierran con `Esc` y lo devuelven a donde estaba.

## La hoja de atajos en la app

El botón **Atajos** de la barra, o `⌘/`, abre la lista completa dentro de la
app, con las teclas de este sistema. Se cierra con `Esc`, con el botón o
pulsando fuera.

## Pendiente

El brief de diseño (F1-13, [#29](https://github.com/xlCyanz/galera/issues/29))
todavía no está en el repositorio. Estos atajos siguen la convención de los
editores de diseño; cuando llegue el brief, se ajustan en
`app/src/shortcuts.ts` y esta lista se actualiza con ellos.
