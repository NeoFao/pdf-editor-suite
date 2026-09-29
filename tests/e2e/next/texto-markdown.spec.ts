import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/estructurado.pdf');
const FIXTURE_FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('Texto…: el textarea trae el documento entero en orden de lectura y Descargar .txt sale con BOM y tildes intactas', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'convertir');
  await page.locator('#btn-extract-text').click();
  const textarea = page.locator('#text-output');
  await expect(textarea).toBeVisible();
  const texto = await textarea.inputValue();

  expect(texto).toContain('Informe anual');
  expect(texto).toContain('Página dos');
  // El título va ANTES que el párrafo de cuerpo (orden de lectura, arriba abajo).
  expect(texto.indexOf('Informe anual')).toBeLessThan(texto.indexOf('parrafo'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-download-txt').click()
  ]);
  const destino = path.join(test.info().outputDir, 'texto.txt');
  await download.saveAs(destino);
  const buf = fs.readFileSync(destino);
  // BOM UTF-8: EF BB BF.
  expect(buf[0]).toBe(0xef);
  expect(buf[1]).toBe(0xbb);
  expect(buf[2]).toBe(0xbf);
  const contenido = buf.toString('utf-8');
  expect(contenido).toContain('Página dos'); // tilde intacta
});

test('Copiar: el portapapeles recibe exactamente el texto del textarea', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'convertir');
  await page.locator('#btn-extract-text').click();
  const textarea = page.locator('#text-output');
  await expect(textarea).toBeVisible();
  const texto = await textarea.inputValue();

  await page.locator('#btn-copy-text').click();
  await expect(page.locator('#text-copy-aviso')).toHaveText('Copiado.');
  const portapapeles = await page.evaluate(() => navigator.clipboard.readText());
  // El portapapeles de Windows normaliza \n a \r\n al escribir/leer texto
  // (un comportamiento del sistema operativo, no de esta app): se compara
  // tras normalizar los finales de línea, no el string byte a byte.
  expect(portapapeles.replace(/\r\n/g, '\n')).toBe(texto);
});

test('Exportar Markdown: encabezado, viñeta, escape de Markdown y separador entre páginas', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'convertir');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-md').click()
  ]);
  const destino = path.join(test.info().outputDir, 'estructurado.md');
  await download.saveAs(destino);
  const md = fs.readFileSync(destino, 'utf-8');

  expect(md.startsWith('# Informe anual')).toBe(true);
  expect(md).toContain('- punto uno');
  expect(md).toContain('precio \\*especial\\*\\_2');
  expect(md).toContain('\n\n---\n\n');
});

test('Texto…: un documento con texto nativo (sin pasar por OCR) también se extrae bien', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE_FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'convertir');
  await page.locator('#btn-extract-text').click();
  const texto = await page.locator('#text-output').inputValue();
  expect(texto).toContain('ORIGINAL-TIMES');
});
