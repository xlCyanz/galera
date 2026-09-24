# Recorrido con VoiceOver

F8-03 ([#90](https://github.com/xlCyanz/galera/issues/90)).

> **Estado: pendiente de la sesión a mano.** Lo que se puede comprobar solo
> ya está comprobado —abajo—. Lo que queda es oír la aplicación con VoiceOver
> y anotar aquí lo que diga, que es lo que pide el cuarto criterio.

## Lo que ya se comprueba solo

| Criterio | Dónde |
|---|---|
| Todo control tiene nombre accesible, y los iconos sin texto, etiqueta | `app/src/a11y.test.tsx`: monta la aplicación con un documento que lleva un elemento de cada tipo y recorre las pestañas, el inspector de cada elemento y los diálogos |
| Contraste de 4,5:1 en texto y 3:1 en controles, en los dos temas | `app/src/styles/tokens.node.test.ts`, con los pares de tinta y fondo que de verdad salen |
| Los cambios de estado se anuncian | Regiones vivas siempre montadas: la compilación en la barra de estado —solo lo que cambia de verdad—, «Guardado en…» y el resultado de un lote (`StatusBar.test.tsx`) |
| El movimiento reducido | Una regla general en `styles.css`; la prueba de los tokens la vigila |

Lo que ninguna prueba puede decir es **cómo suena**: si el orden tiene
sentido al oírlo, si un nombre es claro fuera de su contexto visual, si un
aviso se repite demasiado. Para eso está este recorrido.

## Cómo hacerlo

1. `pnpm tauri dev` y abrir un proyecto con algo dentro: `fixtures/` sirve.
2. Encender VoiceOver con `⌘F5`.
3. Recorrer cada paso con el tabulador y las flechas, **sin mirar la
   pantalla** si se puede, y anotar en la tabla lo que se oye.

| # | Qué hacer | Qué debería oírse | Resultado |
|---|---|---|---|
| 1 | Tabular por los botones de arriba | El nombre de cada uno y su atajo | pendiente |
| 2 | Llegar a las herramientas | «Selección», «Texto», «Rectángulo»… y cuál está pulsada | pendiente |
| 3 | Llegar al lienzo | «Lienzo, página 1», con su descripción de lienzo | pendiente |
| 4 | Llegar a la lista de capas y bajar con `↓` | «Capas de la página…, lista» y el nombre de cada capa al pasar | pendiente |
| 5 | Con una capa elegida, recorrer el inspector | «X», «Y», «Ancho»… con su valor y su unidad | pendiente |
| 6 | Llegar a la lista de páginas y bajar con `↓` | Cada página, y cuál es la actual | pendiente |
| 7 | Escribir un código Typst roto en un bloque | El error, sin tener que ir a buscarlo | pendiente |
| 8 | `⌘S` | «Guardado en…» | pendiente |
| 9 | `⌘/` | «Atajos de teclado, diálogo», y `Esc` devuelve al botón | pendiente |
| 10 | Exportar | El diálogo con su nombre; al acabar, dónde quedó el archivo | pendiente |
| 11 | Entrar en una tabla con `Intro` y usar `⇧F10` | El menú de la tabla y cada opción | pendiente |
| 12 | Cambiar el tema en la barra de estado | «Tema de la interfaz» y la opción elegida | pendiente |

Y dos comprobaciones que no son de VoiceOver pero van en la misma sesión:

| # | Qué hacer | Qué debería pasar | Resultado |
|---|---|---|---|
| 13 | Ajustes del Sistema → Accesibilidad → Pantalla → Reducir movimiento, y escribir en un texto | El cursor deja de parpadear y se queda encendido | pendiente |
| 14 | Recorrer la aplicación en tema oscuro | Todo se lee y el foco se ve siempre | pendiente |

## Qué hacer con lo que salga

Lo que suene mal —un nombre que no dice nada, un orden que no se entiende,
un aviso que se repite— va a una issue nueva, igual que en el criterio de la
Fase 3. Cuando esté la tabla llena, se pega en #90 y la issue se cierra.

Una cosa que conviene mirar con atención: la aplicación compila en cada
tecla, y anunciar cada «compilando» sería no dejar de hablar. Por eso la barra
de estado solo dice lo que cambia de verdad —que aparece un error, que se va—
y «Compilando…» únicamente cuando tarda más de un segundo. Conviene
comprobar al oírlo que esa medida es la buena.
