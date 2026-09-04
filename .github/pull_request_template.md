<!--
  Antes de abrir el PR ejecuta `npm run verify` y pega la salida abajo.
  Reglas completas: AGENTS.md. Defectos ya cometidos: docs/ERRORES-CONOCIDOS.md.
-->

## Qué cambia y por qué

<!-- Dos o tres frases. El "por qué" importa más que el "qué": el diff ya dice el qué. -->

## Verificación

<!--
  OBLIGATORIO: pega la salida real de `npm run verify`.
  "Los tests pasan" sin la salida no cuenta como verificación.
-->

```
(pega aquí la salida de npm run verify)
```

## Comprobaciones

- [ ] **Hay un test que fallaba antes de este cambio y ahora pasa**
      (o el cambio no altera comportamiento observable — explica por qué abajo).
- [ ] El test de comportamiento está en `tests/e2e/` (Chromium real), no solo
      en un test unitario.
- [ ] `npm run verify` en verde en local, con la salida pegada arriba.
- [ ] Si toqué la interfaz, la geometría o la exportación: **lo abrí en el
      navegador y lo comprobé a ojo**.
- [ ] Si arreglé un defecto: añadí su entrada `E-0NN` en
      `docs/ERRORES-CONOCIDOS.md` con síntoma y causa raíz.
- [ ] Si el patrón puede repetirse en otro sitio: añadí su regla en
      `scripts/guards/reglas.mjs` con su test.
- [ ] No añadí ningún `guard-disable-next-line` para poner el CI en verde.
- [ ] No hay `test.skip` / `test.only` / `test.fixme`.
- [ ] Si toqué clases de Tailwind: ejecuté `npm run build` y commiteé el CSS.
- [ ] Si cambié `AGENTS.md`: ejecuté `npm run reglas:sync`.
- [ ] Sin secretos, sin ficheros temporales, sin capturas sueltas.

## Escapes usados

<!--
  Lista aquí cada `guard-disable-next-line` que hayas añadido, con su razón.
  Si no hay ninguno: "ninguno".
-->

ninguno
