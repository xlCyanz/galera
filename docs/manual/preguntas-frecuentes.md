# Preguntas frecuentes

## Sobre el texto

**No puedo crear un texto: me pide añadir una fuente.**
El proyecto no tiene ninguna fuente. Galera solo usa las del proyecto, nunca
las instaladas en el ordenador, para que el documento se vea igual en
cualquier sitio. Pulsa «Añadir fuente…» y elige un archivo `.ttf` u `.otf`,
o empieza desde una plantilla, que ya trae las suyas.

**Algunos caracteres salen en blanco: emojis, chino, japonés, símbolos.**
La fuente del proyecto no los tiene. Añade una fuente que sí los tenga (por
ejemplo, Noto Sans CJK para chino y japonés, o Noto Color Emoji) y úsala en
ese texto. Galera no busca en las fuentes del sistema.

**La cursiva o la negrita no se ven como esperaba.**
Cada estilo de una fuente es un archivo aparte. Para que la negrita y la
cursiva salgan con su diseño, añade también los archivos *Bold* e *Italic*
de esa familia en la pestaña «Fuentes».

**Sale «No cabe por X mm» sobre un texto.**
El texto tiene un alto fijo y no le cabe lo que lleva. Pulsa «Ajustar el
alto» para que crezca solo con el texto, o hazlo más ancho, o baja el tamaño
de la letra. Mientras tanto, el texto se sale de su caja, en el lienzo y en
el PDF: no se corta.

**Escribí `{{algo}}` y no salió la ficha de la variable.**
La lista aparece al escribir `{{` si el documento tiene variables. Crea
antes la variable en la pestaña «Variables».

## Sobre los elementos

**¿Cómo borro un elemento?**
Selecciónalo y pulsa `⌫` (`Supr` en Windows). Si lo borraste sin querer,
`⌘Z`. Si no se borra, mira si está bloqueado: lo bloqueado no se borra.

**No puedo seleccionar un elemento en la página.**
Puede estar **bloqueado** (el candado en la pestaña «Capas»): los bloqueados
solo se seleccionan desde el panel. O puede estar **debajo** de otro:
selecciónalo en «Capas».

**Un elemento no sale en el PDF.**
Mira en «Capas» si está **oculto** (el ojo tachado): lo oculto no se
exporta.

**¿Cómo cambio el tamaño de la página?**
Sin nada seleccionado, el inspector enseña la página: elige el papel (A4,
A5, Carta…), pulsa «Vertical» u «Horizontal», o escribe el ancho y el alto
en milímetros para un tamaño a medida. Cada página tiene el suyo, y las
nuevas copian el de la actual. Los elementos no se mueven: lo que quede
fuera de una página más pequeña, fuera se queda, y no se ve.

**¿Cómo hago una tabla?**
Con la herramienta «Tabla» (`B`): arrastra sobre la página para darle el
ancho. Sale de tres por tres; con el botón derecho en una celda se añaden o
se quitan filas y columnas, y se combinan celdas (ver
[Tabla](conceptos.md#tabla)).

**¿Cómo hago un texto a dos columnas?**
Con la herramienta «Zona de texto» (`F`): dibuja la primera columna, y con
ella seleccionada, dibuja la segunda. El texto que no quepa en la primera
sigue en la segunda, y de ahí puede seguir en otra página del mismo modo.
Ver [Texto que fluye](conceptos.md#texto-que-fluye).

## Sobre los archivos

**¿Dónde se guarda lo que hago?**
En el proyecto que elegiste al crearlo: una carpeta o un archivo `.galera`.
Las fuentes y las imágenes que añades se copian dentro.

**Se cerró la app y no había guardado.**
Vuelve a abrirla. Si había cambios sin guardar, arriba aparece un aviso con
**«Recuperar»**. Recupéralos, revísalos y guarda.

**Moví o borré una imagen del disco y el documento sigue bien.**
Es lo esperado: al añadirla, Galera la copió dentro del proyecto. Lo que usa
es esa copia.

**Mandé el documento a otra persona y no se abre bien.**
Mándale el proyecto **entero**: la carpeta con `fonts/` y `assets/`, o
mejor, un solo archivo `.galera` («Guardar como .galera…», `⌘⇧S`).

**¿Puedo abrir un archivo de Word, de Canva o un PDF?**
No. Galera trabaja con sus propios documentos. Tampoco abre archivos `.typ`
escritos a mano: Typst es el formato de salida, no de entrada.

## Sobre la compilación

**La barra de estado dice «No compila».**
Algo del documento no se puede componer. Pulsa el contador de errores de la
barra de estado para abrir el panel de problemas: cada error dice qué pasa y,
con «Ir al elemento en el lienzo», dónde. Lo más habitual es un error en un
**bloque de código** escrito a mano. Mientras tanto, el lienzo sigue
enseñando la última versión buena.

**Los mensajes de error están en inglés.**
Los errores de Typst salen tal como los da Typst. Los de Galera están en
español.

**¿Por qué el lienzo tarda un momento en actualizarse?**
Cada cambio vuelve a componer el documento con Typst, que es lo que
garantiza que lo que ves es el PDF. Suele tardar unas milésimas; en
documentos largos, algo más. Mientras compone, la barra de estado dice
«Compilando…».

## Sobre la instalación

**Windows dice que no conoce al editor de la app.**
El instalador de Windows todavía no va firmado. Pulsa «Más información» y
«Ejecutar de todas formas».

**macOS dice que no puede comprobar la app y no la abre.**
En la 0.1 el `.dmg` todavía no va firmado ni notarizado por Apple. Abre
**Ajustes del Sistema → Privacidad y seguridad** y pulsa **«Abrir
igualmente»** junto al aviso de Galera; solo hace falta la primera vez.

**¿Hay versión para Linux?**
Todavía no se publica. Se puede compilar desde el código: ver el
[README](../../README.md#puesta-en-marcha).

**Encontré un fallo.**
Ábrelo en [GitHub](https://github.com/xlCyanz/galera/issues/new): qué
hiciste, qué esperabas y qué pasó. Si puedes, adjunta el proyecto.
