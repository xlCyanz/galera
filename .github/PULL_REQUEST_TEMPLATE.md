## Qué cambia

<!-- Resumen en 2-4 líneas. El porqué, no solo el qué. -->

Closes #

## Cómo probarlo

```bash
# Comandos exactos, copiables y pegables.
```

## Criterios de aceptación

<!-- Copia los de la issue y márcalos. Si alguno queda sin marcar, explica por qué. -->

- [ ] 
- [ ] 

## Comprobaciones

- [ ] `cargo fmt --all -- --check` en verde
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` sin avisos
- [ ] `cargo test --workspace` en verde
- [ ] Instantáneas de `insta` revisadas a mano, no aceptadas a ciegas
- [ ] `docs/tareas.md` actualizado con el nuevo estado de la tarea
- [ ] Pruebas nuevas o actualizadas si cambió el comportamiento

## Principios

- [ ] El JSON sigue siendo la fuente de verdad; no se parsea Typst escrito a mano
- [ ] Typst dibuja y mide todo lo que el usuario ve; la interfaz solo dibuja controles
- [ ] Las fuentes viajan con el documento
- [ ] La lógica nueva vive en `galera-core`, no en la interfaz ni en el backend Tauri
- [ ] Todo texto del usuario que entra en Typst pasa por la función de escape

## Fidelidad

<!-- Si el PR toca render, layout o exportación: adjunta captura del lienzo y del PDF exportado. -->

## Decisiones técnicas

<!-- Cambios de versión de Typst, del formato de archivo, del modelo o de los límites entre módulos. Escribe "ninguna" si no hay. -->

## Notas para quien revisa

<!-- Qué mirar primero, qué quedó fuera a propósito, deuda asumida. -->
