import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables } from '../../../src/texto/lineasEditables';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(AQUI, '../../fixtures/generados');
const TEX = path.join(GEN, 'sin-espacio-tex.pdf');

/**
 * E-086 en Chromium real. `sin-espacio-tex.pdf`: Type 1 sin glifo de espacio como el de pdfTeX (editar una línea con espacios
 * conserva la fuente en vez de pasar a Helvetica).
 */

async function abrir(page: Page, fichero: string): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function descargar(page: Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

async function editar(page: Page, actual: string, nuevo: string): Promise<void> {
  const run = page.locator('.run', { hasText: actual }).first();
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(nuevo);
  await page.keyboard.press('Enter');
}

test('E-086: editar una línea con espacios en una fuente sin glifo de espacio conserva la fuente y no cae a Helvetica', async ({ page }) => {
  await abrir(page, TEX);
  await editar(page, 'HOLA MUNDO', 'HOLA DUMNO');
  // Ni aviso de sustitución de fuente ni edición rechazada: el estado es el normal.
  await expect(page.locator('#status')).toHaveText('Editado.');
  await expect(page.locator('.run', { hasText: 'HOLA DUMNO' })).toBeVisible();

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await descargar(page, 'tex.pdf'));
  const runs = eng.getPageText(doc, 0);
  const linea = agruparLineasEditables(runs, 0).find((l) => l.text === 'HOLA DUMNO');
  expect(linea).toBeDefined();
  for (const id of linea!.runIds) expect(runs.find((r) => r.runId === id)!.fontName).toMatch(/TeXSinEspacio$/);
  expect(eng.findText(doc, 0, 'HOLA DUMNO').length).toBe(1);
  eng.close(doc);

  // Deshacer devuelve la línea original (por snapshot, porque se crearon objetos nuevos).
  await page.locator('#btn-undo').click();
  await expect(page.locator('.run', { hasText: 'HOLA MUNDO' })).toBeVisible();
});
