# Rendimiento

Lo que cuesta escribir una letra, medido.

El criterio de salida de la Fase 4 es que **escribir se sienta fluido**:
menos de 50 ms entre la pulsación y el render nuevo en un documento de cinco
páginas. Esta página anota cómo se mide, con qué y qué sale.

## Qué se mide

El camino entero que recorre la app cada vez que se escribe una letra en un
texto, no solo la compilación:

1. **El comando de texto** (`Op::InsertText`), que es lo que manda la
   interfaz al pulsar una tecla.
2. **Generar el código Typst y compilarlo.**
3. **Dibujar las páginas a SVG**, sacar **las cajas del layout** y **las
   posiciones de los glifos**: es lo que el lienzo necesita para enseñar el
   resultado con su cursor en su sitio.

Lo que queda fuera es lo que no es de Galera: el viaje del evento por el
webview, React pintando el SVG que le llega y el compositor del sistema.

## Cómo se mide

```bash
cargo bench -p galera-core
```

El banco (`crates/galera-core/benches/compile.rs`) escribe 40 letras
seguidas al final del último párrafo de
[`fixtures/denso.json`](../fixtures/denso.json) —cinco páginas con un
párrafo justificado denso en cada una— y mide cada tecla por separado. De
esas 40 medidas saca la mediana, el percentil 95 y el peor caso.

Se mide dos veces:

- **desde cero**, preparando el entorno en cada tecla, que es como
  funcionaba antes de `compile::cache`;
- **con caché**, guardando el compilador entre teclas, que es como funciona
  la app (ver [decisiones/compilacion-incremental.md](decisiones/compilacion-incremental.md)).

## Resultados

Apple M4, macOS 26.6, rustc 1.97.0, binario optimizado (`cargo bench`), 20
de septiembre de 2026.

| Caso | Mediana | p95 | Peor | Presupuesto |
|---|--:|--:|--:|--:|
| Desde cero | 10,5 ms | 13,5 ms | 21,1 ms | 50 ms |
| **Con caché** | **6,4 ms** | **8,8 ms** | **15,2 ms** | **50 ms** |

**El percentil 95 es de 8,8 ms**: el presupuesto de la fase se cumple con
cinco veces de margen. El peor caso de las 40 teclas tampoco se acerca.

Con la caché, además, el coste **deja de crecer con el documento**: la
medición por número de páginas está en
[decisiones/compilacion-incremental.md](decisiones/compilacion-incremental.md).

## Qué vigila que no se estropee

El banco no corre en CI: mide tiempos, y una máquina compartida no da
números comparables. Lo que corre con el resto de las pruebas es
`compile::cache::typing_in_five_pages_stays_within_budget`, que mide el
mismo camino, comprueba que el entorno se construye **una sola vez** y que
solo se vuelve a dibujar **la página que cambió**, y falla si una tecla se
pasa de su presupuesto. Ese presupuesto es holgado a propósito: las pruebas
corren sin optimizar, así que el número que cuenta para el criterio de la
fase es el del banco.

Si alguna vez deja de cumplirse, lo primero que hay que mirar es lo que ya
está medido pieza a pieza en
[decisiones/compilacion-incremental.md](decisiones/compilacion-incremental.md):
hoy el grueso de una tecla es recomponer el documento en Typst, que no se
reutiliza por trozos cuando cambia el código.

## Al medir

- **Con el binario optimizado.** Sin optimizar, Typst va varias veces más
  lento y las cifras no dicen nada del producto.
- **Una tecla es una letra más**, nunca la misma dos veces: repetir el mismo
  documento mide la memoización de Typst, no el trabajo de verdad.
- **Se anota la máquina.** Un número sin la máquina que lo produjo no se
  puede comparar con nada.
