import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables } from '../../../src/texto/lineasEditables';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(AQUI, '../../fixtures/generados');
const JUSTIFICADO = path.join(GEN, 'justificado-tw.pdf');

/**
 * E-085 en Chromium real. `justificado-tw.pdf`: «cooperativa» partida en dos objetos con `Tw`/`TJ` (una línea editable, no dos).
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

test('E-085: la palabra partida por Tw/TJ es UNA línea y editar la primera mitad no abre hueco en «cooperativa»', async ({ page }) => {
  await abrir(page, JUSTIFICADO);
  await expect(page.locator('.run')).toHaveCount(2); // dos líneas, no cuatro
  await editar(page, 'Los clientes de la cooperativa trabajan bien', 'Los usuarios de la cooperativa trabajan bien');
  await expect(page.locator('#status')).toHaveText('Editado.');
  await expect(page.locator('.run', { hasText: 'Los usuarios de la cooperativa trabajan bien' })).toBeVisible();

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await descargar(page, 'justificado.pdf'));
  const lineas = agruparLineasEditables(eng.getPageText(doc, 0), 0).map((l) => l.text);
  expect(lineas).toContain('Los usuarios de la cooperativa trabajan bien');
  expect(eng.findText(doc, 0, 'coop erativa').length).toBe(0);
  eng.close(doc);
});
