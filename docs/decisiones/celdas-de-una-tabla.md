# Cómo se sabe dónde quedó cada celda de una tabla

F7-05 ([#87](https://github.com/xlCyanz/galera/issues/87)).

## Contexto

Editar una tabla sobre el lienzo exige saber **dónde está cada celda**: qué
celda hay bajo el doble clic, hasta dónde llega su caja para recuadrarla y
por dónde pasa el borde de una columna para arrastrarlo.

Nada de eso se puede calcular en la interfaz. Una columna `auto` mide lo que
pida su contenido, una `1fr` lo que sobre, y el alto de una fila lo decide la
celda más alta después de partir su texto: son medidas de Typst
(principio 3), como las de cualquier otro elemento.

El problema es que **Typst no deja en el marco la geometría de sus celdas**.
De un elemento sí: el codegen lo envuelve en `#place(…) <el-ID>` y el marco
trae la marca de inicio, la de fin y lo que se dibujó entre las dos
([`layout`](../../crates/galera-core/src/layout.rs)). De una tabla solo salen
el texto de cada celda, las líneas del borde —si tiene— y el rectángulo de
relleno de las celdas que lo lleven. Una tabla sin borde y sin fondo no deja
ni una sola pista de dónde empieza ni dónde acaba cada celda.

## Opciones

1. **Deducir la rejilla de lo que se dibuja.** Las líneas del borde son
   exactamente los bordes de las filas y las columnas, y los rectángulos de
   relleno, las cajas de las celdas que lo tienen. Pero una tabla `stroke:
   none` no dibuja ninguna línea y una sin `fill` no dibuja ningún
   rectángulo, así que la rejilla se sabría solo en las tablas adornadas.
2. **Repartir el ancho en la interfaz.** Traducir `auto`, `fr` y los
   milímetros a números aquí. Rompe el principio 3: `auto` depende de lo que
   mida el texto, que es lo que no se puede medir fuera de Typst.
3. **Preguntarle a Typst dentro de cada celda.** Meter en cada celda algo que
   ocupe **lo que ocupa la celda** y que deje su sitio en el marco, para
   leerlo después como se leen las cajas de los elementos.

## Decisión

La tercera. El codegen escribe en cada celda una marca:

```typst
#let galera-cell(row, column) = place(
  top + left,
  block(width: 100%, height: 100%, metadata((row: row, column: column))),
)
```

Con `place`, la marca queda **fuera de flujo**: no ocupa sitio, así que la
tabla mide exactamente lo mismo con marcas que sin ellas. Dentro, un
`metadata` dice de qué celda es. El layout recorre el marco, y cuando
encuentra ese `metadata` se queda con el marco que lo lleva: esa es la caja
de la celda, medida por Typst
([`layout::cells`](../../crates/galera-core/src/layout/cells.rs)).

De ahí salen la izquierda, el ancho y la parte de arriba de la celda,
quitándoles el margen (`inset`) que el codegen le puso a la tabla.

## Lo que la marca no dice: el alto

El bloque de la marca se estira a lo ancho de la celda, pero no a lo alto:
cuando Typst lo compone, el alto de la fila **todavía no está decidido**, así
que `height: 100%` se resuelve contra lo que queda de página. Por eso el alto
no se lee de la marca sino de las demás: la parte de arriba de las celdas de
cada fila son las rayas que separan las filas, y una celda va desde la raya
de la suya hasta la de la fila siguiente a las que ocupa. La última llega
hasta donde acaba la tabla, que es el marco que viene detrás de su marca de
inicio.

Se comprueba con una tabla de verdad: las celdas de una fila van una detrás
de otra y llenan la tabla, y una celda de dos filas mide lo que miden las
dos.

## Consecuencias

- **Funciona igual en una tabla sin borde y sin fondo**, que es donde la
  opción 1 se quedaba a oscuras.
- La celda se nombra por su **sitio en la rejilla** —fila y columna—, no por
  su posición dentro de la fila: la columna cuenta las que tapan las celdas
  combinadas de más arriba. Esa cuenta está una sola vez, en
  [`model::table::grid`](../../crates/galera-core/src/model/table.rs), y la
  usan el codegen al escribir la marca, el layout al leerla y los comandos al
  buscar la celda.
- El texto de una celda se mapea como el de un bloque: el mapa empieza justo
  detrás de la marca, que es lo que separa una celda de sus vecinas dentro
  del código de la tabla
  ([`layout::glyphs`](../../crates/galera-core/src/layout/glyphs.rs)).
- El código generado crece: una línea de preámbulo y una llamada por celda.
  Es texto que no se dibuja, y a cambio la interfaz no calcula ni una medida.
- Si un día Typst publica la geometría de sus celdas, esto se cambia por esa
  lectura sin tocar nada más: lo que sale hacia fuera es un `CellBox` en
  milímetros.
