import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MIXTOS = path.resolve(AQUI, '../../fixtures/generados/tamanos-mixtos.pdf'); // P1 A4, P2 apaisada, P3 diminuta, P4 A4

// E-065: con páginas de tamaños muy distintos, tras mover/duplicar/borrar la "página actual" tenía que
// quedarse en la página que el usuario espera; el IntersectionObserver del visor elegía otra y la
// siguiente acción (otro "Subir", "Eliminar"…) actuaba sobre una página distinta de la elegida.

async function orden(rutaPdf: string): Promise<string[]> {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(rutaPdf)));
  const out: string[] = [];
  for (let i = 0; i < eng.pageCount(doc); i++) out.push(eng.getPageText(doc, i).map((r) => r.text).join(' ').trim());
  eng.close(doc);
  return out;
}

async function guardar(page: Page, nombre: string): Promise<string[]> {
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await d.saveAs(destino);
  return orden(destino);
}

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MIXTOS);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#thumbs canvas')).toHaveCount(4);
}

/** El indicador y la miniatura activa dicen `n` (1-based), y se mantienen así tras el reposo del observer. */
async function esperaActual(page: Page, n: number, total = 4): Promise<void> {
  await expect(page.locator('#page-indicator')).toHaveText(`${n} / ${total}`);
  await expect(page.locator('#thumbs canvas').nth(n - 1)).toHaveClass(/active/);
  await page.waitForTimeout(500); // el observer ya ha tenido ocasión de pisarla
  await expect(page.locator('#page-indicator')).toHaveText(`${n} / ${total}`);
}

test.describe('E-065: la página actual sigue a la página movida con tamaños mixtos', () => {
  test('Subir dos veces desde la 3 deja P3,P1,P2,P4 (la actual sigue a P3)', async ({ page }) => {
    await abrir(page);
    await page.locator('#thumbs canvas').nth(2).click();
    await esperaActual(page, 3);
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-page-up').click();
    await esperaActual(page, 2);
    await page.locator('#btn-page-up').click();
    await esperaActual(page, 1);
    expect(await guardar(page, 'subir.pdf')).toEqual(['P3', 'P1', 'P2', 'P4']);
  });

  test('Bajar dos veces desde la 2 deja P1,P3,P4,P2', async ({ page }) => {
    await abrir(page);
    await page.locator('#thumbs canvas').nth(1).click();
    await esperaActual(page, 2);
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-page-down').click();
    await esperaActual(page, 3);
    await page.locator('#btn-page-down').click();
    await esperaActual(page, 4);
    expect(await guardar(page, 'bajar.pdf')).toEqual(['P1', 'P3', 'P4', 'P2']);
  });

  test('arrastrar la miniatura 3 antes de la 1 y luego Bajar mueve esa misma página', async ({ page }) => {
    await abrir(page);
    const m = page.locator('#thumbs canvas');
    const c3 = (await m.nth(2).boundingBox())!;
    const c1 = (await m.nth(0).boundingBox())!;
    await page.mouse.move(c3.x + c3.width / 2, c3.y + c3.height / 2);
    await page.mouse.down();
    await page.mouse.move(c1.x + c1.width / 2, c1.y + 2, { steps: 8 });
    await page.mouse.up();
    await esperaActual(page, 1);
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-page-down').click();
    await esperaActual(page, 2);
    expect(await guardar(page, 'arrastre.pdf')).toEqual(['P1', 'P3', 'P2', 'P4']);
  });

  test('Duplicar la 3 deja la actual en la copia y Eliminar borra esa copia, no otra', async ({ page }) => {
    await abrir(page);
    await page.locator('#thumbs canvas').nth(2).click();
    await esperaActual(page, 3);
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-duplicate').click();
    await esperaActual(page, 4, 5);
    page.on('dialog', (d) => d.accept());
    await page.locator('#btn-delete-page').click();
    await expect(page.locator('#thumbs canvas')).toHaveCount(4);
    expect(await guardar(page, 'duplicar.pdf')).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  test('Eliminar la 3 deja la actual en la siguiente (P4) y una segunda vez borra P4', async ({ page }) => {
    await abrir(page);
    page.on('dialog', (d) => d.accept());
    await page.locator('#thumbs canvas').nth(2).click();
    await esperaActual(page, 3);
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-delete-page').click();
    await expect(page.locator('#thumbs canvas')).toHaveCount(3);
    await esperaActual(page, 3, 3);
    expect(await guardar(page, 'borrar.pdf')).toEqual(['P1', 'P2', 'P4']);
  });

  test('Rotar la 3 la deja como actual', async ({ page }) => {
    await abrir(page);
    await page.locator('#thumbs canvas').nth(2).click();
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-rotate').click();
    await esperaActual(page, 3);
  });

  test('Insertar un PDF tras la 2 deja la actual en la 2 o en la primera página insertada, nunca en otra', async ({ page }) => {
    await abrir(page);
    await page.locator('#thumbs canvas').nth(1).click();
    await esperaActual(page, 2);
    await abrirPestana(page, 'organizar');
    await page.locator('#btn-insert-pdf').setInputFiles(MIXTOS);
    await expect(page.locator('#thumbs canvas')).toHaveCount(8);
    await esperaActual(page, 3, 8); // la primera página insertada (índice 2)
  });
});
