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
#let galera-flow-ranges(pieces, zones, style, upto) = {
  // por cada zona, el mayor número de piezas que cabe
  let fits = (k) => measure(block(
    width: zone.w,
    style(pieces.slice(at, k).map(p => p.body).join()),
  )).height <= zone.h
  …
}
```

**Cómo se busca importa tanto como qué se mide.** Cada `fits(k)` compone las
`k` piezas, así que una búsqueda binaria sobre todo el texto mide, una y otra
vez, trozos tan grandes como el texto entero: en un flujo de cinco páginas
eso era más de un segundo por tecla. La búsqueda va por otro camino:

- **se tantea desde lo que se llevó la zona anterior**, que en zonas
  parecidas es casi la respuesta;
- **se avanza doblando** hasta pasarse, así lo que se mide crece con lo que
  cabe en la zona y no con lo que queda de texto;
- y solo entonces **se afina con una binaria** entre lo último que cabe y lo
  primero que no.

Con eso, escribir en un flujo de cinco zonas llenas cuesta unos 80 ms por
tecla, dentro del presupuesto de F4-11, y hay una prueba que lo vigila
(`typing_in_a_flow_of_five_zones_stays_within_budget`).

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
- **Coste.** Unas pocas medidas por zona, del tamaño de lo que cabe en ella.
  Lo que sí se nota es un flujo con **mucho más texto del que su cadena puede
  llevar**: lo que sobra se mide aunque no se dibuje. El sitio donde
  arreglarlo, si llega a hacer falta, es la función de búsqueda, no el
  modelo.
- **Lo que sobra al final de la cadena no se dibuja en ninguna parte**, a
  diferencia de un texto que se sale de su caja. Por eso se avisa
  explícitamente (`layout::flows::overflowing`), y el aviso señala la última
  zona.
- **Una zona sola no es nada**: su texto está en el flujo. De ahí que copiar
  una zona al portapapeles no la copie (F7-01) y que el editor trate la
  cadena entera como un solo texto (F7-03): el cursor cruza de una zona a la
  siguiente porque los índices son del texto del flujo, y cada glifo dice en
  qué página cayó.
