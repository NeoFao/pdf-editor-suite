import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// T12: selección de texto como Acrobat. Arrastrar sobre el texto selecciona un tramo
// (varias líneas, empezando y acabando a mitad de línea); Resaltar/Subrayar/Tachar crean UNA
// anotación con un quad por línea visual recortado al tramo; Ctrl+C copia exactamente ese texto.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const ROTADA = path.resolve(AQUI, '../../fixtures/generados/rotada.pdf');

const L2 = 'La segunda linea sirve para probar la edicion in-place.';
const L3 = 'Tercera linea con numeros: 1234567890 y simbolos.';
const L4 = 'Cuarta linea para verificar el agrupamiento por renglones.';

async function abrir(page: Page, fichero = NATIVO): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** Arrastra del x relativo (0..1) de un run al de otro, con el ratón real. */
async function arrastrar(page: Page, desde: { texto: string; fx: number }, hasta: { texto: string; fx: number }): Promise<void> {
  const a = (await page.locator('.run', { hasText: desde.texto }).boundingBox())!;
  const b = (await page.locator('.run', { hasText: hasta.texto }).boundingBox())!;
  await page.mouse.move(a.x + a.width * desde.fx, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * desde.fx + 12, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width * hasta.fx, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('en reposo no hay selección ni nada que pinte', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('.sel-rect')).toHaveCount(0);
});

test('arrastrar de la mitad de la línea 2 a la mitad de la línea 4 y resaltar: UNA anotación con 3 quads recortados', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  const run2 = (await page.locator('.run', { hasText: L2 }).boundingBox())!;
  const run4 = (await page.locator('.run', { hasText: L4 }).boundingBox())!;
  await arrastrar(page, { texto: L2, fx: 0.5 }, { texto: L4, fx: 0.5 });

  // La selección se ve: un rectángulo azul translúcido por línea visual.
  await expect(page.locator('.sel-rect')).toHaveCount(3);
  const fondo = await page.locator('.sel-rect').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fondo).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d+\)$/);
  // El primero empieza a mitad de la línea 2, el último acaba a mitad de la línea 4.
  const r0 = (await page.locator('.sel-rect').nth(0).boundingBox())!;
  const r2 = (await page.locator('.sel-rect').nth(2).boundingBox())!;
  expect(r0.x).toBeGreaterThan(run2.x + run2.width * 0.3);
  expect(r0.x + r0.width).toBeGreaterThan(run2.x + run2.width - 6);
  expect(r2.x).toBeLessThan(run4.x + 6);
  expect(r2.x + r2.width).toBeLessThan(run4.x + run4.width * 0.7);
  expect(r2.x + r2.width).toBeGreaterThan(run4.x + run4.width * 0.3);

  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');
  await expect(page.locator('.sel-rect')).toHaveCount(0); // la selección se consume al marcar

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'seleccion.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const marcas = eng.getComments(doc, 0).filter((c) => c.kind === 'highlight');
  expect(marcas).toHaveLength(1);
  const quads = eng.getMarkupQuads(doc, 0, marcas[0]!.index);
  expect(quads).toHaveLength(3);
  const runs = eng.getPageText(doc, 0);
  const caja = (t: string) => runs.find((r) => r.text === t)!.boxPt;
  const [c2, c3, c4] = [caja(L2), caja(L3), caja(L4)] as const;
  const x = (q: readonly number[]) => ({ min: Math.min(q[0]!, q[2]!, q[4]!, q[6]!), max: Math.max(q[0]!, q[2]!, q[4]!, q[6]!) });
  const y = (q: readonly number[]) => Math.max(q[1]!, q[3]!, q[5]!, q[7]!);
  // De arriba abajo: línea 2, 3, 4.
  expect(y(quads[0]!)).toBeGreaterThan(y(quads[1]!));
  expect(y(quads[1]!)).toBeGreaterThan(y(quads[2]!));
  // Primero recortado al tramo: empieza a mitad de la línea 2 y llega hasta su final.
  expect(x(quads[0]!).min).toBeGreaterThan(c2.xPt + c2.wPt * 0.3);
  expect(x(quads[0]!).min).toBeLessThan(c2.xPt + c2.wPt * 0.7);
  expect(x(quads[0]!).max).toBeGreaterThan(c2.xPt + c2.wPt - 3);
  // Intermedio: la línea 3 entera.
  expect(x(quads[1]!).min).toBeLessThan(c3.xPt + 3);
  expect(x(quads[1]!).max).toBeGreaterThan(c3.xPt + c3.wPt - 3);
  // Último recortado: desde el inicio de la línea 4 hasta su mitad.
  expect(x(quads[2]!).min).toBeLessThan(c4.xPt + 3);
  expect(x(quads[2]!).max).toBeGreaterThan(c4.xPt + c4.wPt * 0.3);
  expect(x(quads[2]!).max).toBeLessThan(c4.xPt + c4.wPt * 0.7);
  // El texto de la página no se ha tocado.
  expect(runs.map((r) => r.text)).toContain(L3);
  eng.close(doc);
});

test('subrayar y tachar con una selección de texto crean cada uno su anotación', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await arrastrar(page, { texto: L3, fx: 0.2 }, { texto: L3, fx: 0.8 });
  await expect(page.locator('.sel-rect')).toHaveCount(1);
  await page.locator('#btn-underline').click();
  await expect(page.locator('#status')).toHaveText('Subrayado.');
  await arrastrar(page, { texto: L3, fx: 0.3 }, { texto: L4, fx: 0.4 });
  await page.locator('#btn-strike').click();
  await expect(page.locator('#status')).toHaveText('Tachado.');
  await page.locator('#tab-comments').click();
  await expect(page.locator('.comentario-item')).toHaveCount(2);
});

test('Ctrl+C copia exactamente el texto seleccionado (cola de L2, L3 entera, cabeza de L4)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await arrastrar(page, { texto: L2, fx: 0.5 }, { texto: L4, fx: 0.5 });
  await expect(page.locator('.sel-rect')).toHaveCount(3);
  await page.keyboard.press('Control+C');
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  const trozos = copiado.split('\n');
  expect(trozos).toHaveLength(3);
  expect(L2.endsWith(trozos[0]!)).toBe(true);
  expect(trozos[0]!.length).toBeGreaterThan(15);
  expect(trozos[0]!.length).toBeLessThan(45);
  expect(trozos[1]).toBe(L3);
  expect(L4.startsWith(trozos[2]!)).toBe(true);
  expect(trozos[2]!.length).toBeGreaterThan(15);
  expect(trozos[2]!.length).toBeLessThan(45);
});

test('un clic corto sin arrastre sigue entrando a editar y no deja selección', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run', { hasText: L3 });
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await expect(page.locator('.sel-rect')).toHaveCount(0);
});

test('arrastrar una selección no entra a editar ni inserta texto, y un clic posterior la descarta', async ({ page }) => {
  await abrir(page);
  await arrastrar(page, { texto: L3, fx: 0.2 }, { texto: L3, fx: 0.8 });
  await expect(page.locator('.sel-rect')).toHaveCount(1);
  await expect(page.locator('.run.editing')).toHaveCount(0);
  await page.locator('.page').first().click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.sel-rect')).toHaveCount(0);
});

test('el tirador de mover sigue funcionando (no lo secuestra la selección)', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run', { hasText: L3 });
  await run.hover();
  const h = (await run.locator('.run-drag').boundingBox())!;
  const antes = (await run.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.sel-rect')).toHaveCount(0);
  const despues = (await page.locator('.run', { hasText: L3 }).boundingBox())!;
  expect(Math.abs(despues.x - antes.x) + Math.abs(despues.y - antes.y)).toBeGreaterThan(20);
});

test('con otra herramienta activa (pluma) arrastrar no selecciona texto', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-pen').click();
  await arrastrar(page, { texto: L3, fx: 0.2 }, { texto: L3, fx: 0.8 });
  await expect(page.locator('.sel-rect')).toHaveCount(0);
});

test('página con /Rotate: la selección y su quad caen sobre el texto', async ({ page }) => {
  await abrir(page, ROTADA);
  await abrirPestana(page, 'comentar');
  for (const pagina of [0, 1, 2]) {
    const wrapper = page.locator('.page').nth(pagina);
    const run = wrapper.locator('.run').first();
    await run.scrollIntoViewIfNeeded();
    const b = (await run.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    const rect = wrapper.locator('.sel-rect');
    await expect(rect).toHaveCount(1);
    const r = (await rect.boundingBox())!;
    // El rectángulo visible está DENTRO de la caja del run y cubre buena parte (no rota ni se desplaza).
    expect(r.x).toBeGreaterThanOrEqual(b.x - 2);
    expect(r.x + r.width).toBeLessThanOrEqual(b.x + b.width + 2);
    expect(r.width).toBeGreaterThan(b.width * 0.3);
    expect(r.width).toBeLessThan(b.width * 0.8);
    expect(r.y).toBeGreaterThanOrEqual(b.y - 4);
    expect(r.y + r.height).toBeLessThanOrEqual(b.y + b.height + 4);
    await page.locator('#btn-highlight').click();
    await expect(page.locator('#status')).toHaveText('Resaltado.');
  }
});
