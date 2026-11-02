import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASURA, VACIO, truncado, pdfCifrado, pdfArbolCiclico, CLAVE_PRUEBA } from './_pdfsInvalidos';

/**
 * E-125: abrir un archivo inválido con un documento ya abierto dejaba la app inutilizable
 * (se cerraba el documento viejo ANTES de validar el nuevo) y, sin documento previo, la
 * excepción quedaba sin capturar con «Cargando…» para siempre. Ahora la apertura es una
 * transacción: el documento anterior solo se cierra cuando el nuevo se abrió bien.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

function adjunto(name: string, buffer: Buffer) {
  return { name, mimeType: 'application/pdf', buffer };
}

async function abrirValido(page: Page, ruta = FUENTES): Promise<void> {
  await page.locator('#file-input').setInputFiles(ruta);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function editarLinea(page: Page, texto: string): Promise<void> {
  await page.locator('.run', { hasText: 'ORIGINAL-TIMES' }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(texto);
  await page.keyboard.press('Enter');
  await expect(page.locator('.run', { hasText: texto })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); }); // confirmación de descarte (E-074)
  await page.goto('/index.next.html');
});

for (const [nombre, datos] of [['basura', BASURA], ['0 bytes', VACIO], ['truncado', truncado(fs.readFileSync(FUENTES))]] as const) {
  test(`${nombre} con un documento abierto y cambios: error claro, el documento sigue editable y guardable`, async ({ page }) => {
    await abrirValido(page);
    await editarLinea(page, 'CAMBIO SEGURO');

    await page.locator('#file-input').setInputFiles(adjunto('roto.pdf', datos));
    const aviso = page.getByRole('dialog');
    await expect(aviso).toContainText('no es un PDF válido o está dañado');
    await expect(page.locator('#status')).not.toHaveText('Cargando…');
    await expect(page.locator('#status')).toContainText('no es un PDF válido');
    await aviso.getByRole('button', { name: 'Cerrar' }).click();
    await expect(aviso).toHaveCount(0);

    // El documento anterior sigue intacto, con su estado sin guardar.
    await expect(page.locator('.run', { hasText: 'CAMBIO SEGURO' })).toBeVisible();
    await expect(page.locator('.doc-name')).toContainText('•');
    // …y sigue editable…
    await page.locator('.run', { hasText: 'CAMBIO SEGURO' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('CAMBIO SEGURO DOS');
    await page.keyboard.press('Enter');
    await expect(page.locator('.run', { hasText: 'CAMBIO SEGURO DOS' })).toBeVisible();
    // …y guardar funciona y conserva el cambio.
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
    const guardado = await descarga.path();
    await page.locator('#file-input').setInputFiles(guardado);
    await expect(page.locator('.run', { hasText: 'CAMBIO SEGURO DOS' })).toBeVisible();
  });

  test(`${nombre} sin documento previo: error visible y la app sigue usable`, async ({ page }) => {
    await page.locator('#file-input').setInputFiles(adjunto('roto.pdf', datos));
    await expect(page.getByRole('dialog')).toContainText('no es un PDF válido o está dañado');
    await expect(page.locator('#status')).not.toHaveText('Cargando…');
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
    await abrirValido(page); // tras un fallo, abrir un PDF válido funciona
  });
}

test('tras un fallo, abrir un PDF válido distinto funciona', async ({ page }) => {
  await abrirValido(page);
  await page.locator('#file-input').setInputFiles(adjunto('roto.pdf', BASURA));
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await abrirValido(page, NATIVO);
  await expect(page.locator('#status')).not.toHaveText('Cargando…');
});

test('árbol de páginas cíclico: termina en error, no en «Cargando…»', async ({ page }) => {
  await abrirValido(page);
  await page.locator('#file-input').setInputFiles(adjunto('ciclo.pdf', pdfArbolCiclico()));
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#status')).not.toHaveText('Cargando…');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.locator('.run').first()).toBeVisible(); // el documento anterior sigue ahí
});

test('PDF cifrado: pide contraseña, la mala avisa, la buena abre', async ({ page }) => {
  await abrirValido(page);
  await page.locator('#file-input').setInputFiles(adjunto('cifrado.pdf', pdfCifrado()));
  const dlg = page.getByRole('dialog');
  const campo = dlg.locator('input[type="password"]');
  await expect(campo).toBeVisible();
  await campo.fill('mala');
  await dlg.getByRole('button', { name: 'Abrir' }).click();
  await expect(dlg.getByRole('alert')).toContainText('incorrecta');
  // El documento anterior sigue siendo el visible mientras tanto.
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toBeVisible();
  await campo.fill(CLAVE_PRUEBA);
  await dlg.getByRole('button', { name: 'Abrir' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.run', { hasText: 'Hola cifrado' })).toBeVisible();
  await expect(page.locator('#status')).not.toHaveText('Cargando…');
});

test('PDF cifrado: tres contraseñas malas terminan en error y conservan el documento anterior', async ({ page }) => {
  await abrirValido(page);
  await page.locator('#file-input').setInputFiles(adjunto('cifrado.pdf', pdfCifrado()));
  const dlg = page.getByRole('dialog');
  for (let i = 0; i < 3; i++) {
    await dlg.locator('input[type="password"]').fill('mala' + i);
    await dlg.getByRole('button', { name: 'Abrir' }).click();
    if (i < 2) await expect(dlg.getByRole('alert')).toContainText('incorrecta');
  }
  await expect(page.getByRole('dialog')).toContainText('protegido');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toBeVisible();
  await expect(page.locator('#status')).not.toHaveText('Cargando…');
});

test('PDF cifrado: cancelar el diálogo deja el documento anterior intacto', async ({ page }) => {
  await abrirValido(page);
  await page.locator('#file-input').setInputFiles(adjunto('cifrado.pdf', pdfCifrado()));
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toBeVisible();
  await expect(page.locator('#status')).not.toHaveText('Cargando…');
});
