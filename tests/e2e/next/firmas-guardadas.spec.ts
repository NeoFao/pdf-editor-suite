import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrirDoc(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
  await abrirPestana(page, 'firmar');
}

/** Abre el pad, dibuja un trazo y confirma; `guardar` marca la casilla y pone nombre. */
async function dibujarFirma(page: Page, guardar: string | null): Promise<void> {
  await page.locator('#btn-sign').click();
  const canvas = page.locator('#sig-canvas');
  await expect(canvas).toBeVisible();
  // La casilla nace desmarcada: no se guarda nada sin pedirlo.
  await expect(page.locator('#sig-guardar')).not.toBeChecked();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 110, { steps: 8 });
  await page.mouse.move(b.x + 320, b.y + 60, { steps: 8 });
  await page.mouse.up();
  if (guardar !== null) {
    await page.locator('#sig-guardar').check();
    await page.locator('#sig-nombre').fill(guardar);
  }
  await page.locator('#sig-confirm').click();
}

test('guardar la firma dibujada: aparece en Mis firmas tras recargar y se inserta desde ahí', async ({ page }) => {
  await abrirDoc(page);
  await dibujarFirma(page, 'Juan');
  await expect(page.locator('#status')).toHaveText('Firma insertada.');

  // Tras recargar la página la firma sigue en este navegador.
  await abrirDoc(page);
  await page.locator('#btn-mis-firmas').click();
  const panel = page.locator('#mis-firmas-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#mis-firmas-privacidad')).toHaveText(
    'Tus firmas se guardan solo en este navegador. Cualquiera con acceso a este equipo y navegador podría usarlas.'
  );
  const insertar = panel.getByRole('button', { name: 'Insertar firma «Juan»' });
  await expect(insertar).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Borrar firma «Juan»' })).toBeVisible();
  await expect(insertar.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);

  await insertar.click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Firma «Juan» insertada.');
  // Queda seleccionada para colocarla.
  await expect(page.locator('.image-box.selected')).toHaveCount(1);
});

test('sin la casilla no se guarda nada en localStorage', async ({ page }) => {
  await abrirDoc(page);
  await dibujarFirma(page, null);
  await expect(page.locator('#status')).toHaveText('Firma insertada.');
  expect(await page.evaluate(() => window.localStorage.getItem('pdfeditor.firmas.v1'))).toBeNull();
  await page.locator('#btn-mis-firmas').click();
  await expect(page.locator('#mis-firmas-vacio')).toBeVisible();
  await expect(page.locator('.mis-firmas-insertar')).toHaveCount(0);
});

test('borrar una firma pide confirmación y «Borrar todas» vacía la lista', async ({ page }) => {
  await abrirDoc(page);
  await dibujarFirma(page, 'Ana');
  await dibujarFirma(page, 'Luis');
  await page.locator('#btn-mis-firmas').click();
  const panel = page.locator('#mis-firmas-panel');
  await expect(panel.locator('.mis-firmas-insertar')).toHaveCount(2);

  // Cancelar la confirmación no borra.
  page.once('dialog', (d) => void d.dismiss());
  await panel.getByRole('button', { name: 'Borrar firma «Ana»' }).click();
  await expect(panel.locator('.mis-firmas-insertar')).toHaveCount(2);

  page.once('dialog', (d) => void d.accept());
  await panel.getByRole('button', { name: 'Borrar firma «Ana»' }).click();
  await expect(panel.locator('.mis-firmas-insertar')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Insertar firma «Luis»' })).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await panel.locator('#mis-firmas-borrar-todas').click();
  await expect(panel.locator('.mis-firmas-insertar')).toHaveCount(0);
  await expect(panel.locator('#mis-firmas-vacio')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('pdfeditor.firmas.v1'))).toBeNull();
});

test('el sexto guardado avisa del límite de 5 y la firma se inserta igualmente', async ({ page }) => {
  await abrirDoc(page);
  for (let i = 1; i <= 5; i++) await dibujarFirma(page, `f${i}`);
  await dibujarFirma(page, 'extra');
  await expect(page.locator('#status')).toContainText('Ya tienes 5 firmas guardadas');
  await page.locator('#btn-mis-firmas').click();
  await expect(page.locator('.mis-firmas-insertar')).toHaveCount(5);
});

test('una entrada corrupta o con dataURL que no es PNG se ignora sin romper la app', async ({ page }) => {
  await abrirDoc(page);
  await page.evaluate(() => window.localStorage.setItem('pdfeditor.firmas.v1', JSON.stringify([
    { id: 'a', nombre: '<img src=x onerror=window.__xss=1>', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', ancho: 1, alto: 1 },
    { id: 'b', nombre: 'Rota', dataUrl: 'javascript:window.__xss=1', ancho: 1, alto: 1 }
  ])));
  await page.locator('#btn-mis-firmas').click();
  await expect(page.locator('#mis-firmas-vacio')).toBeVisible();
  await expect(page.locator('.mis-firmas-insertar')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('con localStorage bloqueado la app sigue funcionando y avisa de que no se guardó', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } });
  });
  await abrirDoc(page);
  await dibujarFirma(page, 'Juan');
  await expect(page.locator('#status')).toContainText('Firma insertada.');
  await expect(page.locator('#status')).toContainText('No se pudo guardar la firma');
  // La firma sí está en la página.
  await expect(page.locator('.image-box').first()).toBeVisible();
  await page.locator('#btn-mis-firmas').click();
  await expect(page.locator('#mis-firmas-bloqueado')).toBeVisible();
});

test('Mis firmas es un diálogo accesible: foco dentro, Escape cierra y devuelve el foco', async ({ page }) => {
  await abrirDoc(page);
  await dibujarFirma(page, 'Juan');
  const disparador = page.locator('#btn-mis-firmas');
  await disparador.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mis-firmas-panel')).toBeVisible();
  // Foco inicial dentro del diálogo y navegable con Tab.
  await expect(page.locator('#mis-firmas-panel button:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mis-firmas-panel')).toHaveCount(0);
  await expect(disparador).toBeFocused();
});

test('firma desde imagen: con la casilla se guarda reescalada a un PNG pequeño; sin ella no', async ({ page }) => {
  const FIRMA = path.resolve(AQUI, '../../fixtures/generados/firma-blanca.png');
  await abrirDoc(page);
  await page.locator('#btn-sign-upload').setInputFiles(FIRMA);
  await expect(page.locator('#status')).toHaveText('Firma insertada desde imagen (fondo quitado).');
  expect(await page.evaluate(() => window.localStorage.getItem('pdfeditor.firmas.v1'))).toBeNull();

  await page.locator('#sig-upload-guardar').check();
  await page.locator('#sig-upload-nombre').fill('Escaneada');
  await page.locator('#btn-sign-upload').setInputFiles(FIRMA);
  await expect(page.locator('#status')).toHaveText('Firma insertada desde imagen (fondo quitado).');
  const guardadas = await page.evaluate(() => JSON.parse(window.localStorage.getItem('pdfeditor.firmas.v1')!) as { nombre: string; ancho: number; dataUrl: string }[]);
  expect(guardadas).toHaveLength(1);
  expect(guardadas[0]!.nombre).toBe('Escaneada');
  expect(guardadas[0]!.ancho).toBeLessThanOrEqual(600);
  expect(guardadas[0]!.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
});
