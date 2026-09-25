# Conceptos

Las piezas con que se hace un documento en Galera, y cómo encajan.

## Documento

Lo que editas: un conjunto de **páginas** con **elementos** encima, más las
**fuentes**, las **imágenes** y las **variables** que usan. Tiene un título,
que se cambia en el inspector cuando no hay nada seleccionado.

Galera guarda el documento en su propio formato (un archivo
`document.json`) y lo **compone con Typst** cada vez que cambia. Por eso lo
que se ve en el lienzo es lo que sale en el PDF: no hay una vista previa
aparte que pueda equivocarse.

## Proyecto: carpeta o `.galera`

Un documento vive en un **proyecto**, que lleva dentro todo lo que necesita:

```text
mi-informe/
  document.json     el documento
  fonts/            las fuentes que usa
  assets/           las imágenes
```

Así el documento se ve **igual en cualquier ordenador**: no depende de las
fuentes instaladas ni de imágenes que estén en otra parte. Todo lo que
añades —una fuente, una imagen— se **copia** dentro del proyecto.

El proyecto puede guardarse de dos formas, con el mismo contenido:

| | Carpeta | Archivo `.galera` |
|---|---|---|
| Qué es | Una carpeta normal | Un solo archivo, que es la carpeta comprimida |
| Para qué | Trabajar con control de versiones, ver los archivos | Mandarlo por correo, guardarlo en un sitio |
| Crear | «Nuevo proyecto…» (`⌘N`) | «Nuevo .galera…» (`⌘⇧N`) |
| Abrir | «Abrir carpeta…» (`⌘O`) | «Abrir .galera…» (`⌘⇧O`) |

«Guardar como carpeta…» y «Guardar como .galera…» (`⌘⇧S`) pasan de una
forma a la otra.

## Página

Cada página tiene su tamaño. Puedes tener páginas de tamaños distintos en el
mismo documento. En la pestaña **«Páginas»** están las miniaturas:
«Añadir» (una página más detrás de la actual, del mismo tamaño),
«Duplicar» y «Eliminar». Se reordenan arrastrándolas o con `⌥↑` y `⌥↓`.

## Elemento

Todo lo que se pone sobre una página es un elemento:

| Elemento | Qué es | Cómo se crea |
|---|---|---|
| **Texto** | Un bloque de texto con su fuente, tamaño, color y alineación. Su alto crece con lo que escribes, salvo que le fijes uno | Herramienta «Texto» (`T`): arrastra para darle ancho |
| **Rectángulo** y **elipse** | Formas con relleno, borde y, el rectángulo, esquinas redondeadas | `R` y `O`: arrastra, o un clic para el tamaño por defecto |
| **Línea** | Un trazo, continuo, a rayas, de puntos o de raya y punto | `L`: arrastra de un extremo a otro |
| **Imagen** | Una imagen del proyecto (PNG, JPEG, GIF, WebP o SVG) | `I` y clic, o soltar el archivo sobre la página |
| **Bloque de código** | Código de Typst escrito a mano, para lo que no tiene herramienta propia | `C` |
| **Tabla** | Filas y columnas de celdas con texto | Viene en las plantillas: ver abajo |
| **Zona de texto** | Un trozo de un texto que fluye | Viene en las plantillas: ver [Texto que fluye](#texto-que-fluye) |
| **Grupo** | Varios elementos que se mueven y se giran juntos | Selecciónalos y `⌘G` |

Todos tienen posición (**X**, **Y**), tamaño (**An**, **Al**) y **giro**, en
el inspector. El resto de sus propiedades salen en el inspector al
seleccionarlos.

Con `⇧` al crear o al redimensionar, la forma se restringe: cuadrado,
círculo, ángulos de 45°, la proporción de la imagen.

## Capa

Los elementos de una página están apilados: el de arriba tapa al de abajo.
La pestaña **«Capas»** los enseña en ese orden, el de arriba primero. Desde
ahí se puede:

- **Reordenar**, arrastrando o con `⌥↑` y `⌥↓`.
- **Ocultar** (el ojo): no se ve en el lienzo ni sale al exportar.
- **Bloquear** (el candado): no se mueve por accidente. Un elemento
  bloqueado solo se selecciona desde el panel.
- **Renombrar**, con doble clic: el nombre te ayuda a encontrarlo, no sale
  en el documento.

## Fuente

Galera **solo usa las fuentes del proyecto**, nunca las instaladas en el
ordenador. Así un documento no cambia de aspecto al abrirlo en otra máquina.
En la pestaña **«Fuentes»**, «Añadir…» copia un archivo de fuente (`.ttf`,
`.otf`, `.ttc`) al proyecto. Cada fuente se enseña con una muestra
compuesta por Typst.

Un proyecto nuevo trae las fuentes de su plantilla. Uno en blanco no trae
ninguna: para escribir el primer texto, Galera te pide añadir una.

## Imagen y recurso

Las imágenes del proyecto están en la pestaña **«Recursos»**, cada una con
una **clave**: el nombre con que el documento se refiere a ella. Si cambias
la clave, se actualiza en todos los sitios que la usan.

Soltar imágenes **sobre el panel** las añade al proyecto sin ponerlas en la
página. Soltarlas **sobre la página** las añade y las coloca.

## Variable

Un **hueco con nombre** en el documento: el nombre de un cliente, una fecha,
un importe, una foto. En el texto se ve como una ficha con el valor, y en el
PDF, el valor. Se cambia en un sitio, en la pestaña «Variables», y cambia en
todos.

Hay cuatro tipos: **Texto**, **Número**, **Fecha** (AAAA-MM-DD) e
**Imagen** (la clave de un recurso). Escribiendo `{{` en un texto sale la
lista de variables para insertar una.

Las variables son lo que hace que un documento sirva de plantilla y que se
puedan generar muchos a la vez: ver
[Plantillas, variables y lotes](plantillas-y-lotes.md).

## Plantilla

**Un documento del que se parte.** Galera trae seis: «Informe sencillo»,
«Carta con membrete», «Factura», «Certificado», «Credencial de evento» y
«Boletín a dos columnas». Al usar una, se copia entera —con sus fuentes,
sus imágenes y sus variables— en un proyecto nuevo, que ya es tuyo: la
plantilla no cambia.

## Texto que fluye

Un texto largo que no cabe en una caja puede **fluir**: empieza en una
**zona**, y lo que no cabe sigue en la siguiente, en la misma página o en
otra. Es lo que hace un boletín a dos columnas o una carta cuyo cuerpo crece
sin que haya que recolocar la firma.

Doble clic en cualquier zona y se edita el texto entero. Mientras escribes,
cada zona enseña su número en la cadena («1 de 3»), que no sale al
exportar.

En esta versión, los textos que fluyen vienen hechos en las plantillas
«Boletín a dos columnas» y «Carta con membrete»: todavía no se pueden crear
zonas nuevas ni encadenarlas desde la app.

## Tabla

Filas y columnas de celdas. **Doble clic** en una celda para escribir;
`Tab` y `⇧Tab` pasan a la siguiente y a la anterior. Con el botón derecho
(o `⇧F10`) sale el menú para **insertar o quitar filas y columnas**. En el
inspector, el ancho de cada columna: automático, fijo en milímetros o una
parte del ancho que sobra. Los bordes de las columnas también se arrastran
sobre la página.

En esta versión, las tablas vienen hechas en las plantillas, como la de
«Factura»: todavía no se puede crear una nueva ni combinar celdas desde la
app.

## Bloque de código

Para lo que no tiene herramienta, un **bloque de código** deja escribir
código de Typst a mano: una fórmula, un gráfico, una tabla con reglas
propias. Lo que escribes ahí es **código**, no texto: Typst lo interpreta. Si
tiene un error, sale en el panel de problemas con su línea.

La pestaña **«Código»** enseña, de solo lectura, el código Typst que Galera
genera para todo el documento: sirve para ver qué hace por dentro o para
copiarlo.
