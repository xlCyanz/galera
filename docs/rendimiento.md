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

## Un documento de 50 páginas

F8-04 ([#91](https://github.com/xlCyanz/galera/issues/91)). Lo de arriba es
escribir en cinco páginas; el criterio de salida de la Fase 8 es que la app
siga **fluida con cincuenta**, y eso no es solo escribir: también abrir el
documento, exportarlo y lo que ocupa en memoria.

```bash
cargo bench -p galera-core --bench grande
```

El banco (`crates/galera-core/benches/grande.rs`) usa
[`fixtures/grande.json`](../fixtures/grande.json): cincuenta páginas A4 con
cabecera, título, dos párrafos justificados, una foto de 640×427 o una tabla
de siete filas, y pie. 425 elementos en total. Mide:

- **Abrir**: leer y validar el proyecto, compilar por primera vez, dibujar
  las cincuenta páginas y sacar las cajas, los flujos y las celdas, pasado
  todo a JSON. Es lo que hace la app hasta poder enseñar la primera página.
  Cinco veces, cada una con la memoria de Typst vacía, como al arrancar.
- **Una tecla**: 40 letras al final del cuerpo de la página 25, con el mismo
  camino que el banco de cinco páginas, desglosado por partes.
- **Exportar** el documento entero a PDF, cinco veces.
- **La memoria**: con un asignador que cuenta lo que se reserva, lo que
  queda reservado después de cada paso y lo más alto a lo que llegó. Es
  memoria del montón —la de Galera y la de Typst—, no el tamaño del proceso.
- **Lo que viaja a la interfaz**: los bytes de JSON del evento
  `compilation:finish`, que no se ven en el tiempo del núcleo pero sí en el
  puente de Tauri.

### Lo acordado

| Paso | Presupuesto | Por qué |
|---|--:|---|
| Abrir | 1 s | Lo que se tolera sin que parezca que la app se ha colgado |
| Una tecla | 50 ms | El de la Fase 4, que no cambia con el tamaño |
| Exportar | 2 s | Una exportación es una acción puntual: se espera, pero poco |

### Resultados

Apple M4, macOS 26.6, rustc 1.97.0, binario optimizado (`cargo bench`), 24
de septiembre de 2026, ya con solo las páginas que cambian en cada entrega
(#208, abajo).

| Paso | Mediana | p95 | Peor | Presupuesto |
|---|--:|--:|--:|--:|
| Abrir | 105,8 ms | 130,9 ms | 130,9 ms | 1 000 ms |
| **Una tecla** | **13,5 ms** | **15,9 ms** | **18,1 ms** | **50 ms** |
| · compilar | 6,3 ms | 8,0 ms | 9,4 ms | |
| · dibujar la página que cambió | 0,8 ms | 0,9 ms | 1,1 ms | |
| · cajas, flujos y celdas | 3,8 ms | 4,2 ms | 6,2 ms | |
| · pasarlo a JSON | 0,3 ms | 0,4 ms | 0,4 ms | |
| Exportar a PDF (900 KB) | 6,4 ms | 11,0 ms | 11,0 ms | 2 000 ms |

| Memoria | Después | Máximo |
|---|--:|--:|
| Abrir | 62,6 MB | 147,5 MB |
| Escribir 40 letras | 65,3 MB | 74,8 MB |
| Exportar | 63,8 MB | 67,3 MB |

- **Abrir** tarda la séptima parte de lo acordado.
- **Escribir sigue dentro del presupuesto de la Fase 4**, con más de dos
  tercios de margen: 15,9 ms en el percentil 95. **Solo se vuelve a dibujar
  la página que se toca** —40 páginas dibujadas en 40 teclas—, y lo vigila
  `tests/grande.rs`, que corre con el resto de las pruebas.
- **Exportar** es inmediato: la composición ya está hecha.
- **La memoria no crece al escribir**: después de 40 letras queda donde
  estaba al abrir, porque `comemo` suelta lo que deja de usarse (ver
  `compile::cache`). El pico de abrir es la primera composición entera.

### Lo que no cabía: 21,6 MB por tecla

La primera medida encontró que **cada tecla mandaba a la interfaz el SVG de
las cincuenta páginas**: 21,6 MB de JSON. El núcleo solo volvía a *dibujar*
la que cambió, pero el evento llevaba todas. Una página con foto ocupa unos
740 KB —la imagen va dentro, en base64—, y una sin foto, unos 210 KB de
glifos. Pasarlo a JSON era el 40 % de la tecla, y luego el webview tenía que
leerlo: solo `JSON.parse` de algo de ese tamaño son unos 14 ms en V8.

Desde [#208](https://github.com/xlCyanz/galera/issues/208), el evento lleva
la **huella** de cada página y el SVG **solo de las que la interfaz no
tiene** (`Compiler::page_update`); el resto va como `null` y la interfaz lo
toma de lo que ya tenía en ese sitio. Si le falta alguna —se ha recargado, o
ignoró un resultado que llegó tarde—, lo ve porque no le cuadra la huella y
pide `resend_pages`: la siguiente entrega va entera.

| | Antes | Después |
|---|--:|--:|
| Lo que viaja por tecla | 21,6 MB | 387 KB |
| Pasarlo a JSON (mediana) | 10,4 ms | 0,3 ms |
| Una tecla en el núcleo (p95) | 28,2 ms | 15,9 ms |
| Memoria al escribir (máximo) | 129,3 MB | 74,8 MB |

Lo que queda por tecla es la página que cambió: la 25, con el logotipo y sus
glifos.

### En la app

Lo que el banco no mide es lo que pasa en el webview. Se probó abriendo
`fixtures/grande.json` como proyecto en la app compilada en modo release
(`pnpm tauri build --bundles app`), en la misma máquina, el 25 de septiembre
de 2026:

| | Lo que se vio |
|---|---|
| Abrirlo | «Compilado en 59,3 ms», y la primera página enseguida |
| Ir de la página 1 a la 25 | 24 pasos seguidos, sin espera en ninguno |
| Escribir 19 caracteres seguidos en la página 25 | «Compilado en 15,4 ms» por tecla; el texto de la página, al día en menos de un segundo después de la última tecla, sin quedarse atrás mientras se escribía |

Es una prueba a ojo: la barra de estado dice lo que tarda el núcleo, no el
camino entero hasta la pantalla, y la app de release no trae las
herramientas del navegador para medirlo con precisión. Lo que sí se ve es
que escribir en un documento de cincuenta páginas no se nota distinto de
hacerlo en uno de una.

## Qué vigila que no se estropee

El banco no corre en CI: mide tiempos, y una máquina compartida no da
números comparables. Lo que corre con el resto de las pruebas, en
`compile::cache`, mide el mismo camino y comprueba que el entorno se
construye **una sola vez**, que solo se vuelve a dibujar **la página que
cambió** y que una tecla con caché cuesta **menos que compilar desde cero**.
Escribir en un flujo de cinco zonas se compara con escribir en un bloque:
puede costar hasta seis veces más (hoy, unas tres).

Ninguna de esas pruebas compara con un número de milisegundos. Corren sin
optimizar y en máquinas muy distintas —un runner de CI va unas cuatro veces
más despacio que un M4—, así que un número fijo o falla sin motivo en la
lenta o no vigila nada en la rápida. Se compara con algo medido en la misma
máquina y al mismo tiempo, y el número que cuenta para el criterio de la
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
