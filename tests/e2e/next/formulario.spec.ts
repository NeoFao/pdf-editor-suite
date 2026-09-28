import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/formulario.pdf');

test('formulario: se ven los campos, se rellenan, se guardan y persisten; deshacer revierte la casilla', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);

  const textos = page.locator('.form-layer input[type="text"]');
  await expect(textos).toHaveCount(2);
  const casilla = page.locator('.form-layer input[type="checkbox"]');
  await expect(casilla).toHaveCount(1);

  const nombreInput = page.locator('.form-layer input[data-field-name="nombre"]');
  await expect(nombreInput).toHaveValue('');
  const ciudadInput = page.locator('.form-layer input[data-field-name="ciudad"]');
  await expect(ciudadInput).toHaveValue('Lima');
  await expect(casilla).not.toBeChecked();

  // Escribe y sale del campo (blur/Tab) para disparar 'change', como pide la UI.
  await nombreInput.fill('José Ñúñez');
  await nombreInput.press('Tab');
  await expect(page.locator('#status')).toHaveText('Campo de formulario actualizado.');

  await casilla.check();
  await expect(page.locator('#status')).toHaveText('Casilla actualizada.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'formulario.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const fields = eng.listFormFields(doc, 0);
  expect(fields.find((f) => f.name === 'nombre')!.value).toBe('José Ñúñez');
  expect(fields.find((f) => f.name === 'ciudad')!.value).toBe('Lima');
  expect(fields.find((f) => f.name === 'acepto')!.checked).toBe(true);
  eng.close(doc);

  // El último comando ejecutado fue marcar la casilla: un deshacer la revierte.
  await page.locator('#btn-undo').click();
  await expect(casilla).not.toBeChecked();
});
