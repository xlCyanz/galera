# Cómo se reparte el texto entre las zonas de un flujo

F7-02 ([#84](https://github.com/xlCyanz/galera/issues/84)).

## Contexto

Un flujo es un texto y una cadena de zonas ([F7-01](https://github.com/xlCyanz/galera/issues/83)): lo que no cabe en una
zona sigue en la siguiente, que puede estar en otra página. Es el
diferenciador del producto frente a un editor de cajas sueltas.

El problema es que **Typst no tiene texto enlazado entre rectángulos**.
Reparte el texto entre páginas y entre columnas, pero no entre dos `place`
puestos donde diga un documento: cada uno compone lo suyo y lo que sobra se
dibuja fuera del marco.

Y el principio 3 dice que **solo Typst conoce las medidas**: el corte no lo
puede decidir Galera contando caracteres, porque dependería de la fuente,
del interlineado, de la partición de palabras y de la justificación, que son
cosas de Typst y cambian con su versión.

## Opciones

1. **Medir en Rust con las métricas de la fuente.** Leer la fuente, medir
   cada palabra y repartir. Rompe el principio 3 y da un corte que no es el
   de Typst: basta que Typst parta una línea distinto —ligaduras, guionado,
   espacios de justificación— para que lo que se ve no sea lo que se calculó.
2. **Una página por zona y recortar.** Componer el texto entero en una
   página del tamaño de la zona y quedarse con lo que cabe. El corte sería de
   Typst, pero no hay forma de saber **qué parte del texto** quedó dentro:
   del recorte solo salen píxeles, y sin el rango no se puede continuar en la
   siguiente zona ni llevar el cursor de una a otra.
3. **Buscar el corte con el medidor de Typst.** Partir el texto en palabras
   y preguntarle a Typst, con `measure`, cuántas caben en la zona. La
   búsqueda es de Galera; **la medida es de Typst**, con el mismo estilo con
   el que va a dibujar.

## Decisión

La tercera. El codegen emite, por documento, una función que busca los
cortes, y por flujo sus piezas —palabra y espacio—, sus zonas y su estilo.
Cada zona compone el trozo que le toca:

```typst
#let galera-flow-ranges(pieces, zones, style) = {
  // por cada zona, búsqueda binaria del mayor número de piezas que cabe
  let fits = (k) => measure(block(
    width: zone.w,
    style(pieces.slice(at, k).map(p => p.body).join()),
  )).height <= zone.h
  …
}
```

Tres detalles que hacen que esto funcione:

- **El estilo va en una función**, y se usa igual para medir y para dibujar.
  Si la medida no llevara la fuente y el interlineado del flujo, el corte
  saldría de un texto que no es el que se ve.
- **Las piezas son palabras con su espacio.** Más fino no sirve —Typst no
  parte una palabra— y más grueso dejaría zonas a medio llenar.
- **Cada pieza lleva cuántos caracteres del modelo ocupa**, así que el rango
  que sale es del texto que se escribe, no del que se compone: es lo que hará
  falta para editar (F7-03).

Cada zona deja además un `metadata((from, to))` dentro de su marca, y
`layout::flows` lo lee al recorrer los marcos. Por eso el rango se ata a su
zona por la marca y no por el orden en que aparecen.

## Consecuencias

- **El corte es el de Typst.** Si cambia la fuente, el tamaño, el ancho de la
  zona o la versión de Typst, el corte cambia con ellos, sin tocar Galera.
- **Coste.** Cada zona hace del orden de `log2(piezas)` medidas; Typst memoiza
  cada una, y el documento de prueba de tres zonas y un párrafo largo compone
  sin diferencia apreciable. Si un flujo de muchas páginas llegara a notarse,
  el sitio donde arreglarlo es la función de búsqueda, no el modelo.
- **Lo que sobra al final de la cadena no se dibuja en ninguna parte**, a
  diferencia de un texto que se sale de su caja. Por eso se avisa
  explícitamente (`layout::flows::overflowing`), y el aviso señala la última
  zona.
- **Una zona sola no es nada**: su texto está en el flujo. De ahí que copiar
  una zona al portapapeles no la copie (F7-01) y que el editor tenga que
  tratar la cadena entera como un solo texto (F7-03).
