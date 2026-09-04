# Testing

## Por qué E2E y no unit

La decisión más importante de esta suite: **los tests de comportamiento corren
en Chromium real, no en jsdom.**

No es una preferencia de estilo. Repasa `docs/ERRORES-CONOCIDOS.md` y cuenta:

| Defecto | ¿Lo detecta jsdom? | Por qué |
|---|---|---|
| E-001 · bloque de 14 px → 105 px al editar | **No** | jsdom no calcula maquetación: `offsetHeight` siempre es 0 |
| E-002 · el PDF exportado borra líneas | **No** | requiere canvas real y rasterizado real |
| E-009 · el zoom recorta la página | **No** | `transform: scale()` no se computa |
| E-015 · la cabecera desborda en móvil | **No** | no hay ancho real ni media queries efectivas |
| E-004 · el peso del PDF se multiplica | **No** | `canvas.toBlob` no existe |
| E-016 · método duplicado | Sí (via regla) | es análisis estático, no runtime |

Cinco de los seis defectos más graves son **invisibles sin motor de layout**.
Una suite de unit tests con jsdom habría estado en verde todo el tiempo mientras
el producto borraba párrafos de los documentos de los usuarios. Sería peor que
no tener tests: daría confianza falsa.

Por eso `tests/e2e/` es obligatorio y `AGENTS.md` §2.1 lo exige explícitamente.

## Qué hay

```
tests/
  fixtures/
    generar-fixtures.mjs      genera los PDF de prueba (no se versionan)
    generados/                salida, en .gitignore
  e2e/
    helpers.js                utilidades compartidas
    texto-vivo.spec.js        edición in-place (la función central)
    exportacion.spec.js       lo que sale del botón Descargar
    paginas-y-estado.spec.js  ciclo de vida, zoom, liberación de recursos
    responsive.spec.js        móvil (proyecto `movil`, Pixel 7)
    cableado-ui.spec.js       que cada control haga algo
scripts/guards/
  reglas.mjs                  catálogo de reglas deterministas
  reglas.test.mjs             tests de las reglas (node --test)
```

## Comandos

```bash
npm run test:fixtures   # regenera los PDF de prueba
npm run test:e2e        # suite completa
npm run test:e2e:ui     # modo interactivo, para depurar un test concreto
npm run test:unit       # tests de las reglas, sin navegador (rápido)
npm run verify          # TODO: lo mismo que corre CI
```

Para un solo archivo o un solo test:

```bash
npx playwright test exportacion
npx playwright test -g "E-002"
```

## Cómo escribir un test aquí

**1. Por el camino del usuario, no por la API interna.**

```js
// Bien: ejercita también el cableado, que es donde aparecieron varios defectos
await page.locator('#main-file-input').setInputFiles(rutaFixture('nativo.pdf'));

// Mal: se salta la UI y deja sin cubrir justo lo que se rompió
await page.evaluate(() => window.unifiedApp.loadPDFBuffer(...));
```

`page.evaluate` está bien para **observar** estado interno, no para provocar la
acción.

**2. Asertar sobre el resultado, no sobre el mecanismo.**

La aserción central de la exportación es *"las líneas que el usuario no tocó
siguen en el PDF"*, verificada extrayendo el texto con pdf.js. No se comparan
píxeles: eso se rompe al cambiar una fuente y no dice nada útil cuando falla.

**3. Un test por defecto, con su identificador en el nombre.**

```js
test('E-002: editar una línea NO borra las vecinas del PDF exportado', ...)
```

Así, cuando alguien lo vea fallar dentro de un año, `docs/ERRORES-CONOCIDOS.md`
le explica en treinta segundos por qué existe.

**4. Sin esperas por tiempo cuando haya una condición que esperar.**

```js
// Bien
await expect(bloque).toHaveClass(/editing/);
await page.waitForFunction(() => window.docState.totalPages === 3);

// Mal
await page.waitForTimeout(2000);
```

(Hay dos `waitForTimeout` en la suite, ambos tras un cambio de zoom con
transición CSS de 120 ms: ahí no hay evento que esperar.)

## Prohibido

- `test.skip`, `test.only`, `test.fixme` — los bloquea ESLint y la regla
  `suite-viva`.
- Reintentos locales para "ver si pasa". Si un test es inestable, es un bug:
  arréglalo o bórralo explicándolo en el PR.
- Bajar un umbral o ampliar una exclusión para poner el CI en verde.

## Añadir un defecto nuevo al registro

1. Escribe el test **que falla**. Ejecútalo y comprueba que falla de verdad,
   por la razón correcta.
2. Arregla.
3. Vuelve a ejecutarlo: ahora pasa.
4. Añade la entrada `E-0NN` en `docs/ERRORES-CONOCIDOS.md`.
5. Si el patrón puede repetirse en otro sitio del código, añade la regla en
   `scripts/guards/reglas.mjs` **y su test** en `reglas.test.mjs`.

El paso 1 no es opcional. Un test escrito después del arreglo no demuestra nada:
no sabes si detecta el fallo o si simplemente pasa siempre.
