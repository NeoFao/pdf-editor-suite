import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// T11: resaltar, subrayar y tachar crean anotaciones PDF REALES (/Highlight,
// /Underline, /StrikeOut con QuadPoints), no paths de contenido. Aparecen en el
// panel de Comentarios, se deshacen y se borran sin tocar el texto de la página.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');
const ROTADA = path.resolve(AQUI, '../../fixtures/generados/rotada.pdf');

async function abrir(page: Page, fichero: string): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function descargar(page: Page, nombre: string) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  return { eng, doc };
}

test('resaltar, subrayar y tachar aparecen en Comentarios como anotaciones; deshacer y borrar desde el panel', async ({ page }) => {
  await abrir(page, FUENTES);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await abrirPestana(page, 'comentar');

  for (const [boton, estado] of [['#btn-highlight', 'Resaltado.'], ['#btn-underline', 'Subrayado.'], ['#btn-strike', 'Tachado.']] as const) {
    await run.click();
    await page.locator(boton).click();
    await expect(page.locator('#status')).toHaveText(estado);
  }

  // El visor repinta la página con la apariencia de la anotación (hay píxeles amarillos).
  await expect.poll(() => page.locator('.page').first().locator('canvas').first().evaluate((cv: HTMLCanvasElement) => {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 160 && d[i + 2]! < 120) n++;
    return n;
  })).toBeGreaterThan(200);

  await page.locator('#tab-comments').click();
  const items = page.locator('.comentario-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Resaltado');
  await expect(items.nth(1)).toContainText('Subrayado');
  await expect(items.nth(2)).toContainText('Tachado');

  // El PDF guardado lleva las 3 anotaciones reales y el texto intacto.
  const g = await descargar(page, 'markup.pdf');
  expect(g.eng.getComments(g.doc, 0).map((c) => c.kind)).toEqual(['highlight', 'underline', 'strikeout']);
  expect(g.eng.getPageText(g.doc, 0).map((r) => r.text).join(' ')).toContain('ORIGINAL-TIMES');
  g.eng.close(g.doc);

  // Deshacer quita la última.
  await page.locator('#btn-undo').click();
  await expect(items).toHaveCount(2);

  // Borrar desde el panel quita solo la anotación; el texto sigue ahí.
  await page.getByRole('button', { name: /Borrar comentario de la página 1/ }).first().click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Subrayado');
  await expect(run).toBeVisible();
  await expect(run).toContainText('ORIGINAL-TIMES');
});

test('un clic en el comentario de un resaltado navega a su página', async ({ page }) => {
  await abrir(page, ROTADA);
  await abrirPestana(page, 'comentar');
  await page.locator('.page').nth(1).locator('.run').first().click();
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');
  await page.locator('.page').nth(0).scrollIntoViewIfNeeded();
  await page.locator('#tab-comments').click();
  await page.locator('.comentario-item').first().click();
  await expect(page.locator('#page-indicator')).toHaveText(/^2 \//);
});

for (const [pagina, rot] of [[0, 90], [1, 270], [2, 180]] as const) {
  test(`rotación ${rot}: el quad del resaltado cae sobre el texto`, async ({ page }) => {
    await abrir(page, ROTADA);
    await abrirPestana(page, 'comentar');
    const wrapper = page.locator('.page').nth(pagina);
    await wrapper.scrollIntoViewIfNeeded();
    await wrapper.locator('.run').first().click();
    await page.locator('#btn-highlight').click();
    await expect(page.locator('#status')).toHaveText('Resaltado.');

    const g = await descargar(page, `rotada-${rot}.pdf`);
    const run = g.eng.getPageText(g.doc, pagina).find((r) => r.text.includes('ESQUINA-SUP-IZQ'))!;
    const c = g.eng.getComments(g.doc, pagina).find((x) => x.kind === 'highlight')!;
    const quads = g.eng.getMarkupQuads(g.doc, pagina, c.index);
    expect(quads).toHaveLength(1); // una sola línea visual
    const xs = [quads[0]![0], quads[0]![2], quads[0]![4], quads[0]![6]];
    const ys = [quads[0]![1], quads[0]![3], quads[0]![5], quads[0]![7]];
    const tol = 1; // pt
    expect(Math.min(...xs)).toBeLessThanOrEqual(run.boxPt.xPt + tol);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(run.boxPt.xPt + run.boxPt.wPt - tol);
    expect(Math.min(...ys)).toBeLessThanOrEqual(run.boxPt.yPt + tol);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(run.boxPt.yPt + run.boxPt.hPt - tol);
    // Y no es una caja desproporcionada: envuelve la del texto con holgura pequeña.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(run.boxPt.wPt + 2 * tol);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(run.boxPt.hPt + 2 * tol);
    g.eng.close(g.doc);
  });
}
