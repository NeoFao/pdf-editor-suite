import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

// El panel Comentarios, como el de Acrobat: un resaltado/subrayado/tachado muestra el TEXTO que cubre (extraído de la
// página con sus QuadPoints) y, debajo, su comentario (/Contents) si lo tiene; se comenta desde el panel.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(AQUI, '../../fixtures/generados');
const NATIVO = path.join(GEN, 'nativo.pdf');
const CROPBOX = path.join(GEN, 'cropbox-desplazado.pdf');

const L2 = 'La segunda linea sirve para probar la edicion in-place.';
const L3 = 'Tercera linea con numeros: 1234567890 y simbolos.';

async function abrir(page: Page, fichero = NATIVO): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** Arrastra con el ratón real del x relativo (0..1) de un run al de otro. */
async function arrastrar(page: Page, desde: { texto: string; fx: number }, hasta: { texto: string; fx: number }): Promise<void> {
  const a = (await page.locator('.run', { hasText: desde.texto }).first().boundingBox())!;
  const b = (await page.locator('.run', { hasText: hasta.texto }).first().boundingBox())!;
  await page.mouse.move(a.x + a.width * desde.fx, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * desde.fx + 12, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width * hasta.fx, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function resaltarDosLineas(page: Page): Promise<void> {
  await abrirPestana(page, 'comentar');
  await arrastrar(page, { texto: L2, fx: 0 }, { texto: L3, fx: 1 });
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');
  await page.locator('#tab-comments').click();
}

test('resaltar dos líneas: el panel muestra el texto exacto entre comillas, sin «(sin texto)» ni línea de comentario', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  const item = page.locator('.comentario-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.comentario-marcado')).toHaveText(`«${L2} ${L3}»`);
  await expect(item).not.toContainText('(sin texto)');
  await expect(item.locator('.comentario-texto')).toHaveCount(0);
  const aria = (await item.getAttribute('aria-label'))!;
  expect(aria).toContain('Resaltado');
  expect(aria).toContain('página 1');
  expect(aria).toContain(`«${L2} ${L3}»`);
  await expect(page.getByRole('button', { name: /Añadir comentario/ })).toBeVisible();
});

test('añadir un comentario multilínea: aparece, persiste al guardar y reabrir, y deshacer lo quita', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  await page.getByRole('button', { name: /Añadir comentario/ }).click();
  const dialogo = page.getByRole('dialog', { name: /nota/i });
  await dialogo.getByLabel('Texto de la nota').fill('Revisar esto\ncon el cliente');
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo).toHaveCount(0);

  const item = page.locator('.comentario-item');
  await expect(item.locator('.comentario-texto')).toHaveText('Revisar esto con el cliente'); // toHaveText normaliza blancos
  expect(await item.locator('.comentario-texto').evaluate((el) => (el as HTMLElement).innerText)).toBe('Revisar esto\ncon el cliente');
  await expect(item.locator('.comentario-marcado')).toHaveText(`«${L2} ${L3}»`);
  expect(await item.getAttribute('aria-label')).toContain('comentario: Revisar esto');
  await expect(page.getByRole('button', { name: /Editar comentario de la página 1/ })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'marcado-comentado.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const c = eng.getComments(doc, 0);
  expect(c).toHaveLength(1);
  expect(c[0]!.kind).toBe('highlight');
  expect(c[0]!.text).toBe('Revisar esto\ncon el cliente');
  eng.close(doc);

  await page.locator('#btn-undo').click();
  await expect(item.locator('.comentario-texto')).toHaveCount(0);
  await expect(item.locator('.comentario-marcado')).toHaveText(`«${L2} ${L3}»`);
  await expect(page.getByRole('button', { name: /Añadir comentario/ })).toBeVisible();
});

test('el filtro del panel encuentra el resaltado por su texto marcado', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  const filtro = page.getByLabel('Filtrar comentarios');
  await filtro.fill('numeros: 1234567890');
  await expect(page.locator('.comentario-item')).toHaveCount(1);
  await filtro.fill('texto que no existe');
  await expect(page.locator('.comentario-item')).toHaveCount(0);
  await filtro.fill('');
  await expect(page.locator('.comentario-item')).toHaveCount(1);
});

for (const pagina of [0, 1, 2]) {
  test(`cropbox-desplazado.pdf, página ${pagina + 1}: el marcado muestra su texto correcto (CropBox desplazada${pagina === 2 ? ' + /Rotate 90' : ''})`, async ({ page }) => {
    await abrir(page, CROPBOX);
    const w = page.locator('.page').nth(pagina);
    await w.scrollIntoViewIfNeeded();
    const etiqueta = `CROPBOX-${pagina + 1}-A`;
    await expect(w.locator('.run', { hasText: etiqueta })).toBeVisible();
    await page.waitForTimeout(300);
    await abrirPestana(page, 'comentar');
    await w.locator('.run', { hasText: etiqueta }).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' })); // entero a la vista, no bajo la barra
    await page.waitForTimeout(200);
    const a = (await w.locator('.run', { hasText: etiqueta }).boundingBox())!;
    // Se arrastra a lo largo del texto: con /Rotate 90 la línea queda vertical en pantalla.
    const vertical = a.height > a.width;
    const en = (t: number, dx = 0, dy = 0) => ({ x: vertical ? a.x + a.width / 2 + dx : a.x + t * a.width + dx, y: vertical ? a.y + t * a.height + dy : a.y + a.height / 2 + dy });
    const ini = en(0.01), mid = en(0.1, 3, 3), fin = en(0.99);
    await page.mouse.move(ini.x, ini.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 3 });
    await page.mouse.move(fin.x, fin.y, { steps: 8 });
    await page.mouse.up();
    await page.locator('#btn-highlight').click();
    await expect(page.locator('#status')).toHaveText('Resaltado.');
    await page.locator('#tab-comments').click();
    await expect(page.locator('.comentario-marcado')).toHaveText(`«${etiqueta}»`);
    await expect(page.locator('.comentario-item')).toContainText(`Página ${pagina + 1}`);
  });
}

// Quitar el comentario de un marcado (sin borrar el marcado) y abrir su diálogo con doble clic o con Enter.
async function comentar(page: Page, texto: string): Promise<void> {
  await page.getByRole('button', { name: /Añadir comentario/ }).click();
  const dialogo = page.getByRole('dialog', { name: /nota/i });
  await dialogo.getByLabel('Texto de la nota').fill(texto);
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo).toHaveCount(0);
}

test('quitar el comentario desde el panel: el marcado se queda, el comentario desaparece y deshacer lo devuelve', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  await comentar(page, 'Para quitar');
  const item = page.locator('.comentario-item');
  await expect(item.locator('.comentario-texto')).toHaveText('Para quitar');
  const quitar = page.getByRole('button', { name: /Quitar comentario del marcado de la página 1/ });
  await expect(quitar).toBeVisible();
  await quitar.click();
  await expect(page.locator('#status')).toHaveText('Comentario quitado.');
  await expect(item).toHaveCount(1); // el resaltado sigue ahí
  await expect(item.locator('.comentario-marcado')).toHaveText(`«${L2} ${L3}»`);
  await expect(item.locator('.comentario-texto')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Añadir comentario/ })).toBeVisible();
  await expect(quitar).toHaveCount(0);

  await page.locator('#btn-undo').click();
  await expect(item.locator('.comentario-texto')).toHaveText('Para quitar');
});

test('quitar el comentario desde el diálogo: «Quitar comentario» explícito; en blanco + Guardar solo cancela; al crear no hay botón', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  // Al CREAR no se ofrece quitar.
  await page.getByRole('button', { name: /Añadir comentario/ }).click();
  const dialogo = page.getByRole('dialog', { name: /nota/i });
  await expect(dialogo.getByRole('button', { name: 'Quitar comentario' })).toHaveCount(0);
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await comentar(page, 'Se irá');

  const item = page.locator('.comentario-item');
  await page.getByRole('button', { name: /Editar comentario de la página 1/ }).click();
  await dialogo.getByLabel('Texto de la nota').fill('');
  await dialogo.getByRole('button', { name: 'Guardar' }).click(); // en blanco = cancelar, no quita
  await expect(dialogo).toHaveCount(0);
  await expect(item.locator('.comentario-texto')).toHaveText('Se irá');

  await page.getByRole('button', { name: /Editar comentario de la página 1/ }).click();
  await dialogo.getByRole('button', { name: 'Quitar comentario' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(item).toHaveCount(1);
  await expect(item.locator('.comentario-texto')).toHaveCount(0);
  await page.locator('#btn-undo').click();
  await expect(item.locator('.comentario-texto')).toHaveText('Se irá');
});

test('doble clic sobre el resaltado en la página abre su diálogo de comentario (sin editar la línea) y guarda', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  const caja = (await page.locator('.run', { hasText: L2 }).first().boundingBox())!;
  await page.mouse.dblclick(caja.x + caja.width / 2, caja.y + caja.height / 2);
  const dialogo = page.getByRole('dialog', { name: /Añadir nota/ });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Texto de la nota').fill('Con doble clic');
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.locator('.run.editing')).toHaveCount(0);
  await expect(page.locator('.comentario-item .comentario-texto')).toHaveText('Con doble clic');

  // Con comentario, el mismo doble clic abre «Editar nota» con «Quitar comentario».
  await page.mouse.dblclick(caja.x + caja.width / 2, caja.y + caja.height / 2);
  const editar = page.getByRole('dialog', { name: /Editar nota/ });
  await expect(editar.getByLabel('Texto de la nota')).toHaveValue('Con doble clic');
  await expect(editar.getByRole('button', { name: 'Quitar comentario' })).toBeVisible();
});

test('con teclado: Alt+↓ selecciona el marcado y Enter abre su diálogo y guarda con Ctrl+Enter', async ({ page }) => {
  await abrir(page);
  await resaltarDosLineas(page);
  await page.locator('#viewer').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.run:focus')).toHaveCount(1);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('#status')).toContainText('Resaltado 1 de 1');
  await page.keyboard.press('Enter');
  const dialogo = page.getByRole('dialog', { name: /Añadir nota/ });
  await expect(dialogo).toBeVisible();
  await expect(page.locator('.run.editing')).toHaveCount(0);
  await dialogo.getByLabel('Texto de la nota').fill('Desde teclado');
  await page.keyboard.press('Control+Enter');
  await expect(dialogo).toHaveCount(0);
  await expect(page.locator('.comentario-item .comentario-texto')).toHaveText('Desde teclado');
});
