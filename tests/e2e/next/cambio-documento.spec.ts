import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

/**
 * E-125 (ampliación, QA-01/02/03): cambiar de documento desmonta por completo el anterior
 * (visor, listeners, canvas) DESPUÉS de abrir bien el nuevo y cierra el documento del motor una sola
 * vez. Antes el visor viejo seguía vivo sobre el mismo `#viewer`: su listener de `scroll` llamaba a
 * `FPDF_LoadPage` sobre un documento cerrado (`memory access out of bounds`) y cada apertura dejaba
 * sus listeners y canvas.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const F = (n: string): string => path.resolve(AQUI, '../../fixtures/generados', n);

function vigilarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
  return errores;
}

/** Deja correr los eventos pendientes (scroll, render perezoso) sin esperar un tiempo fijo: varios fotogramas y una tarea. */
async function asentar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  });
}

async function abrir(page: Page, fichero: string): Promise<void> {
  await page.locator('#file-input').setInputFiles(F(fichero));
  await expect(page.locator('#status')).not.toHaveText('Cargando…');
  await expect(page.locator('#viewer canvas').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/index.next.html');
});

test('QA-02: PDF grande, desplazarse a la mitad y abrir otro no toca el documento cerrado', async ({ page }) => {
  const errores = vigilarErrores(page);
  await abrir(page, 'grande.pdf');
  await page.evaluate(() => { const v = document.getElementById('viewer')!; v.scrollTop = v.scrollHeight / 2; });
  await asentar(page);
  await abrir(page, 'nativo.pdf');
  await page.evaluate(() => { const v = document.getElementById('viewer')!; v.scrollTop = 40; });
  await asentar(page);
  expect(errores).toEqual([]);
});

test('QA-03: userunit -> fuentes -> Duplicar y nativo -> userunit -> fuentes sin errores', async ({ page }) => {
  const errores = vigilarErrores(page);
  await abrir(page, 'userunit.pdf');
  await abrir(page, 'fuentes.pdf');
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-duplicate').click();
  await asentar(page);
  await abrir(page, 'nativo.pdf');
  await abrir(page, 'userunit.pdf');
  await abrir(page, 'fuentes.pdf');
  await asentar(page);
  expect(errores).toEqual([]);
});

/** Listeners vivos en window, document y todos los elementos (API de línea de comandos de CDP). */
async function medir(page: Page): Promise<{ listeners: number; canvas: number; canvasPagina: number; heapMB: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(() => { let n = 0; for (const t of [window, document, ...document.querySelectorAll('*')]) { const l = getEventListeners(t); for (const k in l) n += l[k].length; } return n; })()`,
    includeCommandLineAPI: true,
    returnByValue: true
  });
  const heap = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  const dom = await page.evaluate(() => ({
    canvas: document.querySelectorAll('canvas').length,
    canvasPagina: document.querySelectorAll('#viewer canvas').length
  }));
  return { listeners: r.result.value as number, ...dom, heapMB: heap.usedSize / 1048576 };
}

test('QA-01: tras 10 cambios entre dos PDF, listeners y canvas vuelven al de una sola apertura', async ({ page }) => {
  test.setTimeout(180_000);
  await abrir(page, 'nativo.pdf');
  await asentar(page);
  const unaApertura = await medir(page);

  const ciclo = async (): Promise<void> => { await abrir(page, 'fuentes.pdf'); await abrir(page, 'nativo.pdf'); };
  for (let i = 0; i < 3; i++) await ciclo();
  await asentar(page);
  const calentado = await medir(page);
  for (let i = 0; i < 7; i++) await ciclo(); // 10 cambios de ida y vuelta en total
  await asentar(page);
  const final = await medir(page);

  // Por TRABAJO, no por tiempo (E-040): contadores exactos del estado vivo.
  expect(final.listeners).toBe(unaApertura.listeners);
  expect(final.canvas).toBe(unaApertura.canvas);
  expect(final.canvasPagina).toBe(unaApertura.canvasPagina);
  // Heap JS: con 7 ciclos más tras el calentamiento no puede crecer sin límite. Margen de 15 MB: el heap de JS de
  // un documento pequeño (texto, modelo, DOM) pesa pocos MB y el GC fuerza la recolección antes de medir; una
  // retención por apertura (35-50 MB de RSS en QA-01) superaría el margen en 14 aperturas.
  expect(final.heapMB - calentado.heapMB).toBeLessThan(15);
});
