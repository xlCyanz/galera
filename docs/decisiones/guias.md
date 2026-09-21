# El ajuste a las guías, con el cálculo en el núcleo y el gesto en la interfaz

Tarea F5-02 ([#68](https://github.com/xlCyanz/galera/issues/68)), sobre el
módulo `snap` de F5-01 ([#67](https://github.com/xlCyanz/galera/issues/67)).

## Contexto

A qué se engancha un elemento al moverlo lo decide el núcleo (principio 5):
`galera_core::snap` sabe de bordes, centros, márgenes y espaciados, y
devuelve el desplazamiento y las guías que hay que dibujar. Pero el núcleo
está al otro lado de la IPC de Tauri, y arrastrar produce un evento cada
pocos milisegundos: preguntar es **asíncrono** y el gesto no lo es.

Ya hay un precedente en la Fase 4, y va en sentido contrario: la selección
dentro de un texto se resuelve en la interfaz con las posiciones de los
glifos que ya están en el store, precisamente porque arrastrar no puede ir
y volver al backend en cada movimiento.

## Opciones

1. **Esperar la respuesta para dibujar.** El elemento no se mueve hasta que
   contesta el núcleo. Cada movimiento del ratón cuesta una ida y vuelta,
   así que el arrastre iría a la velocidad de la IPC, no a la de la mano.
2. **Calcular el ajuste también en TypeScript.** Sería síncrono, pero es
   copiar en la interfaz una lógica que ya está en el núcleo: dos versiones
   que se separan, y la prueba de una no dice nada de la otra. Rompe el
   principio 5.
3. **Mover sin esperar y preguntar a la vez.** El elemento sigue al ratón
   como hasta ahora, y además se pregunta. Cuando llega la respuesta, el
   elemento salta a su sitio y salen las guías.

## Decisión

**Opción 3**, con tres reglas (`app/src/canvas/useSnap.ts`):

- **Una pregunta a la vez.** Mientras hay una en el aire se guarda la última
  posición y se pregunta por ella al volver; las de en medio se tiran. Así
  no se encola una llamada por cada píxel del arrastre.
- **Una respuesta solo vale para su caja.** Se guarda junto a la posición
  por la que se preguntó, y solo se aplica si el ratón sigue exactamente
  ahí. Nunca se engancha a una respuesta de una posición anterior.
- **Lo que se manda es lo que se veía.** Al soltar, el comando lleva el
  enganche incluido, y las guías se quitan en ese momento.

El núcleo devuelve además la **caja ya ajustada**, no solo el
desplazamiento: al redimensionar hay que mover un borde y dejar el otro
donde está, y esa cuenta también es suya.

## Consecuencias

- **Mover deprisa no engancha.** Si el ratón va más rápido que la respuesta,
  no hay ninguna que valga para la posición de ahora y el elemento va donde
  lo lleva la mano. Al frenar, engancha. Es lo que se quiere: el ajuste
  ayuda cuando se está colocando algo, no cuando se está cruzando la página.
- **El enganche se ve un instante después del movimiento.** Es un salto de
  como mucho la distancia de enganche, seis píxeles de pantalla.
- **Si el núcleo no contesta**, el gesto sigue funcionando sin ajuste: el
  elemento va donde el ratón y no hay guías.
- **Las guías se dibujan en la capa de controles**, nunca dentro del SVG de
  Typst (principio 2): son una ayuda de la interfaz y no salen en el PDF.
- **Queda por medir** si con documentos muy cargados la ida y vuelta empieza
  a notarse. El cálculo en sí es geometría sobre las cajas ya compiladas, no
  vuelve a componer nada.
