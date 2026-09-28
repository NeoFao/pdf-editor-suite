import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/formulario.pdf');

test('formulario fase 2: radio, combo y lista se ven, se eligen, se guardan y persisten; deshacer revierte el último cambio', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);

  // Los campos de fase 2 viven en la página 1 (índice 1) del fixture.
  const p1 = page.locator('.page[data-page="1"]');
  const pais = p1.locator('select[data-field-name="pais"]');
  const frutas = p1.locator('select[data-field-name="frutas"]');
  const radios = p1.locator('input[type="radio"]');

  await expect(pais).toHaveValue('Chile');
  await expect(radios).toHaveCount(3);
  await expect(p1.locator('input[type="radio"]:checked')).toHaveCount(0);
  const opcionesFrutas = frutas.locator('option');
  await expect(opcionesFrutas).toHaveCount(3);
  await expect(frutas).toHaveJSProperty('multiple', true);

  // Elegir país.
  await pais.selectOption({ label: 'Perú' });
  await expect(page.locator('#status')).toHaveText('Campo de elección actualizado.');

  // Marcar el radio "azul".
  await p1.locator('input[type="radio"][value="azul"]').check();
  await expect(page.locator('#status')).toHaveText('Opción marcada.');
  await expect(p1.locator('input[type="radio"][value="azul"]')).toBeChecked();
  await expect(p1.locator('input[type="radio"][value="rojo"]')).not.toBeChecked();
  await expect(p1.locator('input[type="radio"][value="verde"]')).not.toBeChecked();

  // Seleccionar dos frutas (lista multiselección).
  await frutas.selectOption(['manzana', 'uva']);
  await expect(page.locator('#status')).toHaveText('Campo de elección actualizado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'formulario-fase2.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const fields = eng.listFormFields(doc, 1);
  expect(fields.find((f) => f.name === 'pais')!.value).toBe('Perú');
  const azul = fields.find((f) => f.name === 'color' && f.exportValue === 'azul')!;
  expect(azul.checked).toBe(true);
  expect(fields.filter((f) => f.name === 'color' && f.checked)).toHaveLength(1);
  const frutasField = fields.find((f) => f.name === 'frutas')!;
  expect(frutasField.options.filter((o) => o.selected).map((o) => o.label).sort()).toEqual(['manzana', 'uva']);
  eng.close(doc);

  // El último comando ejecutado fue elegir las frutas: un deshacer lo revierte
  // (la lista queda sin selección, su estado inicial en el fixture).
  await page.locator('#btn-undo').click();
  await expect(page.locator('.page[data-page="1"] select[data-field-name="frutas"] option:checked')).toHaveCount(0);
  // El resto de cambios (país, radio) siguen aplicados: el deshacer solo revierte el último paso.
  await expect(page.locator('.page[data-page="1"] select[data-field-name="pais"]')).toHaveValue('Perú');
  await expect(page.locator('.page[data-page="1"] input[type="radio"][value="azul"]')).toBeChecked();
});
