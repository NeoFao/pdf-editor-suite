import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/** Dispara `beforeunload` y dice si la página pidió confirmar (preventDefault). */
async function avisaAlSalir(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

async function editarLinea(page: Page, texto: string): Promise<void> {
  await page.locator('.run', { hasText: 'ORIGINAL-TIMES' }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(texto);
  await page.keyboard.press('Enter');
  await expect(page.locator('.run', { hasText: texto })).toBeVisible();
}

test('sin guardar: limpio al abrir; sucio tras ejecutar y tras deshacer; limpio al guardar', async ({ page }) => {
  await page.goto('/index.next.html');
  const tituloBase = await page.title();
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  const nombre = page.locator('.doc-name');
  await expect(nombre).not.toContainText('•');
  expect(await page.title()).not.toContain('•');
  expect(await avisaAlSalir(page)).toBe(false);

  await editarLinea(page, 'CAMBIO UNO');
  await expect(nombre).toContainText('•');
  expect(await page.title()).toContain('•');
  expect(await avisaAlSalir(page)).toBe(true);

  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  await descarga.path();
  await expect(nombre).not.toContainText('•');
  expect(await page.title()).toBe(tituloBase);
  expect(await avisaAlSalir(page)).toBe(false);

  // Deshacer tras guardar también deja el documento distinto del guardado.
  await page.keyboard.press('Control+Z');
  await expect(nombre).toContainText('•');
  expect(await avisaAlSalir(page)).toBe(true);
});

test('sin guardar: cerrar la pestaña con cambios muestra el diálogo beforeunload; sin cambios, no', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  await editarLinea(page, 'CAMBIO DOS');

  const tipos: string[] = [];
  page.on('dialog', (d) => { tipos.push(d.type()); void d.dismiss(); });
  await page.evaluate(() => { document.body.click(); });
  await page.goto('about:blank').catch(() => undefined);
  expect(tipos).toContain('beforeunload');
});

test('sin guardar: abrir otro documento o Nuevo con cambios pide confirmación', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  await editarLinea(page, 'CAMBIO TRES');

  // Nuevo: cancelar conserva el documento.
  const mensajes: string[] = [];
  page.once('dialog', (d) => { mensajes.push(d.message()); void d.dismiss(); });
  await page.locator('#btn-new').click();
  await expect.poll(() => mensajes.length).toBe(1);
  await expect(page.locator('.run', { hasText: 'CAMBIO TRES' })).toBeVisible();

  // Abrir otro fichero: cancelar conserva el documento.
  page.once('dialog', (d) => { mensajes.push(d.message()); void d.dismiss(); });
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect.poll(() => mensajes.length).toBe(2);
  await expect(page.locator('.run', { hasText: 'CAMBIO TRES' })).toBeVisible();

  // Aceptar sí descarta y deja el documento limpio.
  page.once('dialog', (d) => { void d.accept(); });
  await page.locator('#btn-new').click();
  await expect(page.locator('.page')).toHaveCount(1);
  await expect(page.locator('.run')).toHaveCount(0);
  await expect(page.locator('.doc-name')).not.toContainText('•');
});

test('sin guardar: con el documento limpio, Nuevo y abrir no preguntan', async ({ page }) => {
  await page.goto('/index.next.html');
  let dialogos = 0;
  page.on('dialog', (d) => { dialogos++; void d.accept(); });
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#btn-new').click();
  await expect(page.locator('.run')).toHaveCount(0);
  expect(dialogos).toBe(0);
});
