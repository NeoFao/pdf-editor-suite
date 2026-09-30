import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarSondaCSP, leerCSP, instalarStubIframeImpresion } from './_csp';

/**
 * Bajo la CSP REAL de producción (`vercel.json`, aplicada de verdad por
 * `scripts/servir-despliegue.mjs` — ver su comentario de cabecera), no solo
 * bajo el empaquetado (eso ya lo cubre `humo.spec.ts`).
 *
 * Este fichero se escribió y se ejecutó primero contra la CSP ACTUAL (con
 * 'unsafe-eval' y sin 'wasm-unsafe-eval'/'frame-src'), como línea base — spec
 * §3. Sigue funcionando sin cambios tras el endurecimiento (§4): la única
 * diferencia de comportamiento esperada, la de imprimir, se detecta leyendo
 * la CSP real que manda el servidor en cada ejecución (`leerCSP`), no con un
 * flag de fase editado a mano.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const FIXTURE_MD = path.resolve(AQUI, '../../fixtures/ejemplo.md');
const FIXTURE_DOCX = path.resolve(AQUI, '../../fixtures/generados/word-basico.docx');

test('/ : abrir un PDF nativo (motor WASM), editar una línea y guardar, sin ninguna violación de CSP', async ({ page }) => {
  const sonda = await instalarSondaCSP(page);

  await page.goto('/');
  await page.locator('#file-input').setInputFiles(FIXTURE_NATIVO);
  const run = page.locator('.run').first();
  await expect(run).toBeVisible();

  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('TEXTO EDITADO BAJO CSP');
  await page.keyboard.press('Enter');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click()
  ]);
  const destino = path.join(test.info().outputDir, 'editado-bajo-csp.pdf');
  await download.saveAs(destino);
  expect(fs.statSync(destino).size).toBeGreaterThan(0);

  expect(sonda.mensajesConsola, 'no debe haber mensajes de consola de CSP').toEqual([]);
  expect(await sonda.violaciones(), 'no debe haber violaciones de CSP').toEqual([]);
});

test('/ : abrir un .md lo convierte a PDF vectorial sin ninguna violación de CSP', async ({ page }) => {
  const sonda = await instalarSondaCSP(page);

  await page.goto('/');
  await page.locator('#file-input').setInputFiles(FIXTURE_MD);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#status')).toContainText('Convertido desde Markdown');

  expect(sonda.mensajesConsola).toEqual([]);
  expect(await sonda.violaciones()).toEqual([]);
});

test('/ : abrir un .docx lo convierte a PDF vectorial sin ninguna violación de CSP', async ({ page }) => {
  const sonda = await instalarSondaCSP(page);

  await page.goto('/');
  await page.locator('#file-input').setInputFiles(FIXTURE_DOCX);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#status')).toContainText('Convertido desde Word');

  expect(sonda.mensajesConsola).toEqual([]);
  expect(await sonda.violaciones()).toEqual([]);
});

/**
 * Imprimir es el ÚNICO caso de esta suite cuyo resultado depende de la fase
 * (CSP actual vs. endurecida), porque `vercel.json` HOY no declara
 * `frame-src` (cae en `default-src 'self'`, que no incluye `blob:`) y la
 * autorización del dueño (2026-09-29, paso 3) añade
 * `frame-src 'self' blob:`. La app YA maneja ambos casos en producción
 * (`App.print()`, `src/ui/App.ts`): un oyente de `securitypolicyviolation`
 * detecta el bloqueo del propio blob: y cae a abrir el PDF en una pestaña
 * nueva. Este test lee la CSP real que manda el servidor (`leerCSP`) para
 * saber qué comportamiento exigir, así que sigue siendo válido sin tocarlo
 * ni antes ni después del endurecimiento.
 */
test('/ : imprimir — con frame-src blob: permitido va por iframe; si no, cae a pestaña nueva sin violaciones sin manejar', async ({ page, baseURL }) => {
  const csp = await leerCSP(page, '/', baseURL);
  const permiteFrameBlob = /frame-src[^;]*\bblob:/.test(csp);

  const sonda = await instalarSondaCSP(page);
  await instalarStubIframeImpresion(page);

  await page.addInitScript(() => {
    (window as unknown as { __opens: string[] }).__opens = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opens: string[] }).__opens.push(String(url ?? ''));
      return null;
    }) as typeof window.open;
  });

  await page.goto('/');
  await page.locator('#file-input').setInputFiles(FIXTURE_NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-print').click();

  if (permiteFrameBlob) {
    // CSP endurecida: el iframe imprime directamente, sin fallback y sin violaciones.
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __printLlamadas: unknown[] }).__printLlamadas.length))
      .toBeGreaterThan(0);
    const opens = await page.evaluate(() => (window as unknown as { __opens: string[] }).__opens);
    expect(opens, 'con frame-src blob: permitido no debe caer al respaldo de pestaña').toEqual([]);
    expect(sonda.mensajesConsola).toEqual([]);
    expect(await sonda.violaciones()).toEqual([]);
  } else {
    // CSP actual: el navegador bloquea el iframe hacia blob: (frame-src cae
    // en default-src 'self'), la app lo detecta y abre una pestaña nueva.
    // Es la ÚNICA violación esperada de toda esta suite, y desaparece en
    // cuanto se añada frame-src 'self' blob: (autorización del dueño).
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __opens: string[] }).__opens.length))
      .toBeGreaterThan(0);
    const url = await page.evaluate(() => (window as unknown as { __opens: string[] }).__opens[0]!);
    expect(url).toMatch(/^blob:/);

    const violaciones = await sonda.violaciones();
    expect(violaciones.length, 'se esperaba exactamente la violación de frame-src del blob: de impresión').toBe(1);
    expect(violaciones[0]!.blockedURI).toMatch(/^blob/);
    expect(violaciones[0]!.violatedDirective).toMatch(/frame-src|default-src/);
  }
});
