import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

// E-073 (WCAG 2.1.1): Nota y Rectángulo solo funcionaban con ratón. Este spec NO usa el ratón:
// todo va por teclado (y `locator.focus()`, que no es un gesto de puntero).
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** true si la caja está entera dentro del visor (px de viewport). */
async function dentroDelVisor(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const v = document.getElementById('viewer')!.getBoundingClientRect();
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return r.left >= v.left - 1 && r.right <= v.right + 1 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
  }, selector);
}

test('nota por teclado: N + Enter coloca la nota en la zona visible y abre el diálogo de texto', async ({ page }) => {
  await abrir(page);
  page.once('dialog', (d) => d.accept('Nota por teclado'));
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Nota añadida.');
  const marcador = page.locator('.note-marker');
  await expect(marcador).toHaveCount(1);
  await expect(marcador).toHaveAttribute('title', 'Nota por teclado');
  expect(await dentroDelVisor(page, '.note-marker')).toBe(true);
});

test('nota por teclado con una línea enfocada: la nota queda sobre esa línea, no en la esquina', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run').nth(3);
  await run.focus();
  const rb = (await run.boundingBox())!;
  page.once('dialog', (d) => d.accept('Sobre la línea'));
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  const marcador = page.locator('.note-marker');
  await expect(marcador).toHaveCount(1);
  const mb = (await marcador.boundingBox())!;
  expect(Math.abs(mb.y - rb.y)).toBeLessThan(rb.height + 24);
  expect(Math.abs(mb.x - rb.x)).toBeLessThan(40);
});

test('rectángulo por teclado: Enter lo crea, flechas lo mueven, Mayús+flechas lo redimensionan, Enter lo confirma', async ({ page }) => {
  await abrir(page);
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  const borrador = page.locator('.rect-preview');
  await expect(borrador).toHaveCount(1);
  expect(await dentroDelVisor(page, '.rect-preview')).toBe(true);

  const b0 = (await borrador.boundingBox())!;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const b1 = (await borrador.boundingBox())!;
  expect(b1.x).toBeGreaterThan(b0.x);
  expect(b1.y).toBeGreaterThan(b0.y);
  expect(Math.abs(b1.width - b0.width)).toBeLessThan(0.5);

  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const b2 = (await borrador.boundingBox())!;
  expect(b2.width).toBeGreaterThan(b1.width);
  expect(b2.height).toBeGreaterThan(b1.height);
  expect(Math.abs(b2.x - b1.x)).toBeLessThan(0.5);

  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Rectángulo dibujado.');
  await expect(page.locator('.rect-preview')).toHaveCount(0);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'rect-teclado.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const { data } = eng.renderPage(doc, 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) { if (data[i]! > 170 && data[i + 1]! < 100 && data[i + 2]! < 100) { rojo = true; break; } }
  expect(rojo).toBe(true);
  eng.close(doc);
});

test('rectángulo por teclado: Esc cancela el borrador sin dibujar nada', async ({ page }) => {
  await abrir(page);
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rect-preview')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rect-preview')).toHaveCount(0);
  await expect(page.locator('#status')).not.toHaveText('Rectángulo dibujado.');
});

test('con la herramienta Nota o Rectángulo inactiva, Enter en una línea sigue editándola', async ({ page }) => {
  await abrir(page);
  await page.locator('.run').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.run.editing')).toHaveCount(1);
});

test('la ayuda (?) lista las teclas nuevas y documenta que la pluma no tiene equivalente de teclado', async ({ page }) => {
  await abrir(page);
  await page.keyboard.press('?');
  const tabla = page.locator('#shortcuts-table');
  await expect(tabla).toContainText('Enter');
  await expect(tabla).toContainText('Mayús + flechas');
  await expect(page.locator('#shortcuts-pluma')).toContainText('2.1.1');
});
