import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E-116: enlaces EXTERNOS (/URI) del PDF. Como los internos (E-106), un clic normal edita el texto y Ctrl+clic (o Intro con el
 * foco) sigue el enlace, pero antes pasa por un diálogo de seguridad con la URL completa. Fixture `enlaces-externos.pdf`:
 * líneas "Enlace HTTPS externo", "Enlace de correo", "Enlace javascript peligroso" (URI javascript:), "Enlace Launch de programa"
 * y "Texto sin enlace". Ninguna prueba sale a internet: toda petición de red a *.test se intercepta.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/enlaces-externos.pdf');
const URL_HTTPS = 'https://ejemplo.test/ruta/larga?a=1&b=dos#frag';

async function abrir(page: Page) {
  // Espía window.open (síncrono en el manejador del clic) para afirmar la AUSENCIA de apertura sin esperas fijas.
  await page.addInitScript(() => {
    const w = window as unknown as { __aperturas: string[] };
    w.__aperturas = [];
    const original = window.open.bind(window);
    window.open = (...a: Parameters<typeof window.open>) => { w.__aperturas.push(String(a[0])); return original(...a); };
  });
  // Nada sale a internet: lo que se abra (la pestaña nueva incluida) recibe una página vacía.
  await page.context().route(/\.test\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>interceptada</title>' }));
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
}
const aperturas = (page: Page) => page.evaluate(() => (window as unknown as { __aperturas: string[] }).__aperturas);
const linea = (page: Page, texto: string) => page.locator('.run', { hasText: texto });

test('E-116: un clic normal sobre el enlace https EDITA la línea y no abre nada ni muestra diálogo', async ({ page, context }) => {
  await abrir(page);
  const paginas: string[] = [];
  context.on('page', (p) => paginas.push(p.url()));
  await linea(page, 'Enlace HTTPS externo').click();
  await expect(page.locator('.run.editing')).toHaveCount(1);
  await expect(page.locator('#external-link-dialog')).toHaveCount(0);
  expect(await aperturas(page)).toEqual([]); // window.open se llama de forma síncrona en el clic: sin espera fija
  expect(paginas).toEqual([]);
});

test('E-116: Ctrl+clic en el https muestra la URL EXACTA; Cancelar no abre ninguna página', async ({ page, context }) => {
  await abrir(page);
  const paginas: string[] = [];
  context.on('page', (p) => paginas.push(p.url()));
  await linea(page, 'Enlace HTTPS externo').click({ modifiers: ['Control'] });
  const dialogo = page.locator('#external-link-dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.locator('#external-link-url')).toHaveText(URL_HTTPS);
  await expect(page.locator('.run.editing')).toHaveCount(0);
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialogo).toHaveCount(0);
  expect(await aperturas(page)).toEqual([]); // window.open se llama de forma síncrona en el clic: sin espera fija
  expect(paginas).toEqual([]);
});

test('E-116: Abrir lleva a una pestaña nueva con esa URL, sin opener (noopener)', async ({ page, context }) => {
  await abrir(page);
  const nueva = context.waitForEvent('page');
  await linea(page, 'Enlace HTTPS externo').click({ modifiers: ['Control'] });
  await page.locator('#external-link-dialog').getByRole('button', { name: 'Abrir' }).click();
  const p = await nueva;
  await p.waitForLoadState('domcontentloaded');
  expect(p.url()).toBe(URL_HTTPS);
  expect(await p.evaluate(() => window.opener)).toBeNull();
});

test('E-116: "No volver a preguntar para este dominio" omite el diálogo en la siguiente apertura de la sesión', async ({ page, context }) => {
  await abrir(page);
  await linea(page, 'Enlace HTTPS externo').click({ modifiers: ['Control'] });
  const dialogo = page.locator('#external-link-dialog');
  await dialogo.getByLabel('No volver a preguntar para ejemplo.test').check();
  const primera = context.waitForEvent('page');
  await dialogo.getByRole('button', { name: 'Abrir' }).click();
  await primera;
  const segunda = context.waitForEvent('page');
  await linea(page, 'Enlace HTTPS externo').click({ modifiers: ['Control'] });
  await segunda;
  await expect(page.locator('#external-link-dialog')).toHaveCount(0);
  // Solo en memoria: ni localStorage ni sessionStorage guardan nada.
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('ejemplo.test');
});

test('E-116: el mailto pide confirmación con su dirección completa', async ({ page }) => {
  await abrir(page);
  await linea(page, 'Enlace de correo').click({ modifiers: ['Control'] });
  await expect(page.locator('#external-link-url')).toHaveText('mailto:ana@correo.test');
  await expect(page.locator('#external-link-dialog').getByRole('button', { name: 'Abrir' })).toBeVisible();
});

test('E-116: javascript: nunca ofrece "Abrir": solo avisa y no abre nada', async ({ page, context }) => {
  await abrir(page);
  const paginas: string[] = [];
  context.on('page', (p) => paginas.push(p.url()));
  await linea(page, 'Enlace javascript peligroso').click({ modifiers: ['Control'] });
  const dialogo = page.locator('#external-link-dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.locator('#external-link-url')).toHaveText('javascript:alert(1)');
  await expect(dialogo.getByRole('button', { name: 'Abrir' })).toHaveCount(0);
  await expect(dialogo.getByRole('button', { name: 'Cerrar' })).toBeVisible();
  await dialogo.getByRole('button', { name: 'Cerrar' }).click();
  expect(await aperturas(page)).toEqual([]); // window.open se llama de forma síncrona en el clic: sin espera fija
  expect(paginas).toEqual([]);
});

test('E-116: un enlace /Launch no se ejecuta ni muestra diálogo con Ctrl+clic', async ({ page, context }) => {
  await abrir(page);
  const paginas: string[] = [];
  context.on('page', (p) => paginas.push(p.url()));
  await linea(page, 'Enlace Launch de programa').click({ modifiers: ['Control'] });
  expect(await aperturas(page)).toEqual([]);
  await expect(page.locator('#external-link-dialog')).toHaveCount(0);
  expect(paginas).toEqual([]);
});

test('E-116: Intro con el foco en la caja abre el diálogo, y la caja dice "Ctrl+clic para abrir <dominio>"', async ({ page }) => {
  await abrir(page);
  const enlace = page.getByRole('link', { name: 'Ctrl+clic para abrir ejemplo.test' });
  await expect(enlace).toHaveCount(1);
  await expect(enlace).toHaveAttribute('title', 'Ctrl+clic para abrir ejemplo.test');
  await enlace.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#external-link-url')).toHaveText(URL_HTTPS);
});

