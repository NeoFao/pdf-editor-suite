import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * §9 fila #4: abrir un `.docx` desde `#file-input` lo convierte a un PDF con
 * texto REAL y vectorial (nunca rasteriza), usando el motor PDFium — a
 * diferencia de la app vieja (`docx-preview` + `html2pdf`, que rasteriza).
 * `word-basico.docx`/`word-tabla-imagen.docx` (tests/fixtures) se generan
 * con `npm run test:fixtures` (ver `generar-fixtures.mjs`).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WORD_BASICO = path.resolve(AQUI, '../../fixtures/generados/word-basico.docx');
const WORD_TABLA_IMAGEN = path.resolve(AQUI, '../../fixtures/generados/word-tabla-imagen.docx');

async function dataTransferConFichero(page: Page, bytes: number[], fileName: string, mime: string) {
  return page.evaluateHandle(({ bytes, fileName, mime }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], fileName, { type: mime }));
    return dt;
  }, { bytes, fileName, mime });
}

test('abrir word-basico.docx lo convierte a un PDF de 2 páginas con el texto en la capa de texto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_BASICO);
  await expect(page.locator('.run').first()).toBeVisible();

  await expect(page.locator('#status')).toContainText('Convertido desde Word');

  const indicador = await page.locator('#page-indicator').textContent();
  const total = Number((indicador ?? '').split('/')[1]?.trim());
  expect(total).toBe(2);

  const textos = await page.locator('.run').allTextContents();
  const todo = textos.join(' ');
  expect(todo).toContain('Título');
  expect(todo).toMatch(/ñ/);
  expect(todo).toContain('negrita');

  // Sin advertencias (word-basico.docx no tiene contenido no soportado): el aviso no se muestra.
  await expect(page.locator('#conversion-warnings')).toBeHidden();
});

test('abrir word-tabla-imagen.docx muestra un aviso visible con las advertencias (tabla e imagen omitidas)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_TABLA_IMAGEN);
  await expect(page.locator('.run').first()).toBeVisible();

  await expect(page.locator('#conversion-warnings')).toBeVisible();
  const avisoTexto = await page.locator('#conversion-warnings').textContent();
  expect(avisoTexto ?? '').toMatch(/tabla/i);
  expect(avisoTexto ?? '').toMatch(/imagen/i);

  // La tabla, aunque no es una tabla real, no se pierde: su texto aplanado está en la capa de texto.
  const textos = await page.locator('.run').allTextContents();
  expect(textos.join(' ')).toContain('Producto');

  // Cerrar el aviso lo oculta.
  await page.locator('#conversion-warnings-close').click();
  await expect(page.locator('#conversion-warnings')).toBeHidden();
});

test('soltar un .doc (Word 97 binario) muestra el mensaje de formato antiguo, sin intentar convertirlo', async ({ page }) => {
  await page.goto('/index.next.html');
  const dt = await dataTransferConFichero(page, [1, 2, 3, 4], 'viejo.doc', 'application/msword');

  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });

  await expect(page.locator('#status')).toContainText('.doc antiguo no soportado');
  await expect(page.locator('.page')).toHaveCount(0);
});
