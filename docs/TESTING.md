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
npm run e2e:liberar     # libera los puertos 4173/3100 si quedaron ocupados (ver abajo)
```

## El webServer de la app nueva nunca reutiliza un proceso vivo (E-033)

`playwright.config.js` arranca dos servidores. El de la app vieja
(`node server.js`, puerto 3100) lee los ficheros del disco en cada petición,
así que reutilizar un proceso que ya estaba vivo nunca sirve código
desactualizado: su `webServer` usa `reuseExistingServer: !process.env.CI`
(en CI, siempre arranca uno nuevo).

El de la app nueva (`npm run build:next && npm run preview:next`, puerto
4173) es distinto: `vite preview` sirve un `dist/` **congelado en el momento
del build**. Por eso su `reuseExistingServer` es **siempre `false`**, incluso
en local: si un `vite preview` de una sesión anterior sigue vivo en el 4173,
Playwright falla con un error de "puerto ya en uso" en vez de reutilizarlo en
silencio y correr los tests de `tests/e2e/next/` contra un build viejo. Ese
fallo alto es intencional — la alternativa (E-033) es peor: `npm run verify`
dando un resultado falso sobre código que ya no existe.

Si te encuentras ese error de puerto ocupado:

```bash
npm run e2e:liberar     # mata SOLO si el proceso en 4173/3100 es node o vite
npm run test:e2e        # vuelve a intentar: ahora reconstruye de verdad
```

`scripts/liberar-puertos.mjs` es multiplataforma (netstat/taskkill en
Windows, lsof/kill en Unix) y nunca mata un proceso que no pueda identificar
como `node` o `vite` — si no logra determinar el nombre, avisa y lo deja
vivo. No forma parte de `npm run verify`: matar procesos automáticamente en
un pipeline es invasivo, y el propio mensaje de error de Playwright ya dice
qué hacer.

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

## Capturas de píxeles

Solo dos ficheros comparan píxeles byte a byte hoy:
`tests/e2e/next/fidelidad-reposo.spec.ts` y
`tests/e2e/next/sustituir-fuente.spec.ts` (la prueba de oro de reposo de
E-029: capturar la página con `.run` visible y con `.run` oculta por script,
y exigir `Buffer.compare(antes, despues) === 0`).

**Toda `screenshot()` de este tipo pasa `{ animations: 'disabled' }`.**

```js
// Bien
const antes = await wrapper.screenshot({ animations: 'disabled' });

// Mal — puede capturar una transición CSS a medias (E-039)
const antes = await wrapper.screenshot();
```

Motivo (E-039, `docs/ERRORES-CONOCIDOS.md`): una transición CSS real (p. ej.
`.run-drag { transition: opacity .1s }`, el tirador de arrastre de una línea)
puede seguir en curso en el instante de la captura — sobre todo tras un
re-render que reconstruye la capa de texto, porque el navegador reaplica
`:hover` al elemento que reemplaza al que tenía el foco del cursor SIN que
el test haya movido el ratón. Esa transición corre por el reloj de pared del
navegador, no por la velocidad del hilo de JS del test, así que dos capturas
separadas por un `page.evaluate()` de por medio pueden caer en dos frames
distintos de la misma animación bajo carga de máquina — un `Buffer.compare`
distinto de `0` que no tiene nada que ver con lo que el test dice comparar.

`animations: 'disabled'` congela cualquier transición/animación CSS a su
estado FINAL antes de capturar. Es determinista y **no relaja la
comparación**: sigue exigiendo `Buffer.compare === 0` byte a byte, solo
elimina la variable de en qué frame de una animación en curso cayó la
captura. La regla `captura-pixel-sin-animations-disabled`
(`scripts/guards/reglas.mjs`) exige la opción en cualquier `.screenshot(`
nuevo dentro de `tests/e2e/next/*.spec.ts`.

## No se aserta sobre tiempo de reloj en tests unitarios (E-040)

`tests/unit/**` corre en Node, sin motor de layout, así que aquí la
disciplina es la contraria a la de "Capturas de píxeles" de arriba: nunca
`performance.now()`/`Date.now()` para verificar que algo "es rápido".

```js
// Mal — frágil bajo carga: la MISMA operación, sin cambiar código de
// producción, puede tardar más en una máquina compartida o cargada.
const t0 = performance.now();
engine.applyPageOps(doc, 0, ops);
expect(performance.now() - t0).toBeLessThan(200);

// Bien — aserta sobre el TRABAJO realizado, no sobre cuánto tardó.
const spy = vi.spyOn(p, 'FPDFPage_GenerateContent');
engine.applyPageOps(doc, 0, ops);
expect(spy).toHaveBeenCalledTimes(1); // una sola regeneración, sin importar el nº de ops
```

Un umbral de milisegundos mide la velocidad del hardware en el instante de
la corrida, no la propiedad que el test dice proteger — y esa propiedad
casi siempre tiene una versión determinista:

- **Nº de llamadas.** `vi.spyOn` sobre un método del motor
  (`engine.applyPageOps`, `engine.save`/`open`/`close`) o sobre una función
  del módulo WASM (`p.FPDFPage_GenerateContent`). Sirve para "esto se hace
  UNA vez, no una por elemento/edición" — el patrón de E-037/E-038.
- **Pasos expuestos por el propio código bajo prueba.** Si hay una cota
  explícita de trabajo (un presupuesto, un contador de iteraciones), pásala
  como parámetro diagnóstico opcional y aserta sobre el valor devuelto en
  vez de inferirlo por el reloj — ver `parseInline(text, stats?)` en
  `src/convert/markdown/parse.ts`.
- **Comparar el trabajo de N y 2N.** Si de verdad no hay otra propiedad
  disponible, compara el trabajo (pasos, llamadas) entre dos tamaños de
  entrada y exige que NO crezca más rápido que linealmente — nunca compares
  milisegundos entre las dos corridas.
- **Estructura del resultado.** A veces la cota se refleja directamente en
  la forma de la salida (p. ej. un anidamiento que no puede superar una
  constante) y no hace falta instrumentar nada.

**Excepción — red anti-cuelgue.** Si además quieres conservar una
salvaguarda contra un CUELGUE real (no contra lentitud), dale un margen muy
holgado (p. ej. `< 10 s`) y coméntala explícitamente como anti-cuelgue, no
como medida de rendimiento — y ten en cuenta que el timeout por test de
Vitest (5 s por defecto) ya cumple ese papel en la mayoría de los casos sin
necesitar código adicional.

La regla `sin-cronometraje-en-unit` (`scripts/guards/reglas.mjs`) bloquea
cualquier `performance.now()`/`Date.now()` nuevo en `tests/unit/**/*.test.ts`
salvo con el escape estándar del repositorio y una razón real (AGENTS.md
§3). Ver `docs/ERRORES-CONOCIDOS.md` (E-040) para el caso real que lo
motivó: un test con umbral `< 500 ms` que dio `598 ms` y falló en una
corrida local cargada, sin ninguna regresión.

## Prohibido

- `test.skip`, `test.only`, `test.fixme` — los bloquea ESLint y la regla
  `suite-viva`.
- Reintentos locales para "ver si pasa". Si un test es inestable, es un bug:
  arréglalo o bórralo explicándolo en el PR.
- Bajar un umbral o ampliar una exclusión para poner el CI en verde.
- Asertar sobre tiempo de reloj en `tests/unit/**` (ver arriba, E-040) salvo
  una red anti-cuelgue muy holgada y comentada como tal.

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
