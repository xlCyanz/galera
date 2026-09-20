# Compilación incremental y caché por página

Tarea F4-04 ([#58](https://github.com/xlCyanz/galera/issues/58)).

## Contexto

En la Fase 4 se escribe sobre el render de Typst: cada tecla cambia el
documento, y el lienzo tiene que enseñar el resultado. El criterio de salida
de la fase son **menos de 50 ms entre tecla y render en un documento de
cinco páginas**.

Hasta ahora, cada cambio hacía el camino entero desde cero: leer las fuentes
del disco, construir el índice tipográfico, generar el código Typst,
compilarlo y dibujar **todas** las páginas a SVG. Correcto, pero se paga
entero en cada tecla.

## Opciones

1. **Guardar el compilador entre cambios.** Un `Compiler` por proyecto
   abierto que conserva el entorno (`World`) con sus fuentes, cambia el
   código por dentro en vez de rehacerlo, y deja viva la memoización de
   Typst (`comemo`) de una compilación a la siguiente.
2. **Compilar solo la página que cambió.** Generar un archivo Typst por
   página y compilarlos por separado. Rompe cosas que son del documento
   entero —la numeración, el texto que fluye de una página a otra en la Fase
   7— y multiplica los entornos.
3. **Esperar a que deje de escribir** (*debounce*) y compilar al parar. No
   es más rápido: es enseñar menos veces. El lienzo se quedaría atrás
   mientras se escribe, que es justo lo que la fase quiere evitar.
4. **Dejarlo como está** y confiar en que Typst es rápido. Con una página
   quizá; el coste crece con el documento, y el objetivo es de cinco páginas
   en adelante.

## Decisión

**Opción 1, más una caché del dibujo por página**, en
[`compile/cache.rs`](../../crates/galera-core/src/compile/cache.rs):

- **El entorno y las fuentes se reutilizan.** Se cargan una vez por proyecto
  abierto, no una vez por tecla.
- **El código se cambia por dentro**: `Source::replace` busca el trozo que
  cambió de verdad y solo vuelve a analizar ese.
- **La memoización de Typst sigue viva** entre compilaciones, y se poda
  después de cada una (`comemo::evict`) para que escribir un rato largo no
  se coma la memoria.
- **Solo se dibuja la página que ha cambiado.** El SVG de cada página se
  guarda con la huella de la página compuesta; las que no han cambiado se
  devuelven tal cual. Dos páginas idénticas comparten dibujo.

La compilación por páginas separadas (opción 2) se descarta: no es
compatible con el texto que fluye de la Fase 7 ni con la numeración.

## Medido

Las cifras de una tecla, con el camino entero y su percentil 95, están en
[rendimiento.md](../rendimiento.md). Lo de aquí es el desglose que llevó a
esta decisión.

`cargo bench -p galera-core`, con el binario optimizado, en un Apple M4 con
rustc 1.97.0. Una tecla al final de la última página; se mide el camino
entero —generar el código, compilar y dibujar todas las páginas—, mediana de
nueve teclas. Cada página lleva un párrafo justificado de unos 3.600
caracteres con la fuente Inter.

| Páginas | Desde cero | Con caché | Mejora |
|--:|--:|--:|--:|
| 1 | 8,9 ms | 8,3 ms | 7 % |
| 5 | 13,9 ms | 8,5 ms | 39 % |
| 10 | 20,1 ms | 8,7 ms | 56 % |

Lo que importa no es solo la mejora: es que **con la caché el coste deja de
crecer con el documento**. A cinco páginas quedan 8,5 ms de los 50 ms del
criterio de la fase, y a diez páginas sigue igual.

De dónde sale cada cosa, midiendo las piezas por separado (compilación sin
optimizar, cinco páginas):

| Pieza | Coste |
|---|--:|
| Generar el código Typst | 1,4 ms |
| Crear el entorno, con la fuente | 0,6 ms |
| Cambiar el código por dentro (`Source::replace`) | 0,007 ms |
| Compilar sin cambios (todo memoizado) | 1,5 ms |
| Compilar con una letra distinta | 14 ms |
| Dibujar las cinco páginas a SVG | 10 ms |
| Dibujar solo la que cambió | 2 ms |
| Sacar las cajas del layout | 0,06 ms |

Dos cosas que conviene saber:

- **Cambiar una letra recompone el documento entero**, no solo su página:
  compilar sin cambios cuesta 1,5 ms y con una letra distinta, 14 ms, sin
  que importe en qué página esté. La memoización de Typst reutiliza el
  trabajo cuando la entrada es idéntica, no por trozos independientes. Lo
  que sí se salva por páginas es el dibujo.
- **La caché de `comemo` es global**, así que también ayuda un poco cuando
  se compila desde cero; por eso la mejora con una sola página es pequeña.
  Lo que aporta guardar el compilador es el entorno, las fuentes y el
  dibujo.

## Cuándo deja de valer lo guardado

| Cambia | Qué se rehace |
|---|---|
| El texto, una caja, un color | Se recompone; se dibuja solo la página tocada |
| Las fuentes que declara el documento | El entorno entero, fuentes incluidas |
| Un archivo del proyecto (una imagen que se importa, una fuente que se añade) | Las lecturas: `Compiler::forget_files`, que la app llama al importar |
| El proyecto abierto, o «Guardar como» a otra carpeta | Otro `Compiler` |

Las pruebas de `compile::cache` fijan cada una de esas reglas, incluida la
de que **sin invalidar, la imagen vieja se seguiría viendo**: así la prueba
falla si alguien quita la llamada.

## Consecuencias

- El compilador vive en el estado de la app, uno por proyecto abierto, y se
  coge con un cerrojo propio: compilar sigue sin bloquear el resto de
  comandos.
- `galera_core::compile` sigue existiendo y se usa donde solo se compila una
  vez (la terminal, exportar): es un `Compiler` de usar y tirar.
- El presupuesto se vigila con una prueba (`compile::cache`), que además
  comprueba que el entorno se construye una sola vez y que solo se dibuja la
  página que cambió. La prueba corre sin optimizar, así que su presupuesto
  es holgado; el número que cuenta es el del banco de pruebas.
- Queda para más adelante bajar los 14 ms de recomponer: pasa por que el
  código generado de una página no dependa de las demás, y eso choca con el
  texto que fluye de la Fase 7. Hasta los 50 ms hay sitio de sobra.
