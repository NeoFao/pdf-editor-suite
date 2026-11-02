import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

// Ronda 3 de accesibilidad y móvil (QA transversal, E-127). Todo se comprueba en Chromium real
// (estilos calculados, foco, árbol de accesibilidad), no leyendo el diff (E-097: hubo falsos positivos).
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();
}

const dentroDeDialogo = (page: Page): Promise<boolean> => page.evaluate(() => !!document.activeElement?.closest('dialog'));

test('QA-04: el diálogo de firma es un dialog modal: foco dentro, Tab atrapado, Esc cierra y el foco vuelve al botón', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'firmar');
  const disparador = page.locator('#btn-sign');
  await disparador.focus();
  await page.keyboard.press('Enter');
  const dialogo = page.getByRole('dialog', { name: 'Dibuja tu firma' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toHaveAttribute('aria-modal', 'true');
  expect(await dentroDeDialogo(page)).toBe(true);
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    expect(await dentroDeDialogo(page)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialogo).toHaveCount(0);
  await expect(disparador).toBeFocused();
});

test('QA-04: el diálogo de firma sigue permitiendo insertar con el botón (sin regresión)', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'firmar');
  await page.locator('#btn-sign').click();
  const b = (await page.locator('#sig-canvas').boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.locator('#sig-confirm').click();
  await expect(page.locator('#status')).toHaveText('Firma insertada.');
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('QA-05: una línea editable enfocada con teclado muestra contorno visible (WCAG 2.4.7)', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run').first();
  await run.focus();
  await page.keyboard.press('ArrowDown'); // gesto de teclado: activa :focus-visible
  await page.keyboard.press('ArrowUp');
  await expect(run).toBeFocused();
  const estilo = await run.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { estilo: cs.outlineStyle, ancho: parseFloat(cs.outlineWidth), color: cs.outlineColor, fv: el.matches(':focus-visible') };
  });
  expect(estilo.fv).toBe(true);
  expect(estilo.estilo).not.toBe('none');
  expect(estilo.ancho).toBeGreaterThanOrEqual(2);
  expect(estilo.color).not.toBe('rgba(0, 0, 0, 0)');
});

test('MEDIO: tras confirmar una edición con Enter el foco vuelve a la línea (no a body)', async ({ page }) => {
  await abrir(page);
  const run = page.locator('.run').first();
  await run.click(); // edición empezada con ratón
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await page.keyboard.press('Enter');
  await expect(page.locator('.run.editing')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('run'))).toBe(true);
});

test('MEDIO: tras guardar una nota el foco no cae en body', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-note').click();
  await page.locator('.page').first().click({ position: { x: 400, y: 600 } });
  const d = page.getByRole('dialog', { name: /nota/i });
  await d.getByLabel('Texto de la nota').fill('hola');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(d).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('MEDIO: editar o borrar un comentario desde el panel no deja el foco en body', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-note').click();
  await page.locator('.page').first().click({ position: { x: 400, y: 600 } });
  const d = page.getByRole('dialog', { name: /nota/i });
  await d.getByLabel('Texto de la nota').fill('uno');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(d).toHaveCount(0);
  await page.locator('#tab-comments').click();
  await page.getByRole('button', { name: /Editar comentario de la página 1/ }).click();
  await d.getByLabel('Texto de la nota').fill('dos');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('.comentario-texto')).toHaveText('dos');
  await expect(page.getByRole('button', { name: /Editar comentario de la página 1/ })).toBeFocused();
  await page.getByRole('button', { name: /Borrar comentario de la página 1/ }).click();
  await expect(page.locator('li.comentario')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('MEDIO: con forced-colors la capa de texto no se pinta (solo foco y selección)', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await abrir(page);
  const run = page.locator('.run').first();
  const color = await run.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { c: cs.color, fc: cs.forcedColorAdjust };
  });
  // Texto invisible: transparente Y con forced-color-adjust:none (si no, Chromium lo repinta con CanvasText).
  expect(color.c).toBe('rgba(0, 0, 0, 0)');
  expect(color.fc).toBe('none');
  await run.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const foco = await run.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(foco).not.toBe('none');
});

test('MEDIO: las pestañas del panel lateral son tablist/tab/tabpanel con aria-selected y flechas', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#sidebar [role="tablist"]')).toHaveCount(1);
  await expect(page.locator('#sidebar [role="tab"]')).toHaveCount(3);
  for (const id of ['tab-pages', 'tab-outline', 'tab-comments']) {
    const t = page.locator(`#${id}`);
    await expect(t).toHaveAttribute('role', 'tab');
    const panel = await t.getAttribute('aria-controls');
    expect(panel).toBeTruthy();
    await expect(page.locator(`#${panel}`)).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator(`#${panel}`)).toHaveAttribute('aria-labelledby', id);
  }
  await expect(page.locator('#tab-pages')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#tab-pages').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-outline')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-outline')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-comments')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-pages')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#tab-comments')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#tab-pages')).toBeFocused();
  // Roving tabindex: solo la pestaña activa entra en el orden de Tab.
  await expect(page.locator('#tab-outline')).toHaveAttribute('tabindex', '-1');
});

test.describe('Barra superior a 375×812', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('todos los controles visibles de la barra caben en el ancho y miden ≥24 px (o están en un menú)', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const malos: string[] = [];
      let total = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.topbar button, .topbar input, .topbar select'))) {
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || (b.width === 0 && b.height === 0)) continue;
        if (el instanceof HTMLInputElement && el.type === 'file') continue;
        total++;
        const nombre = el.id || el.className || el.tagName;
        if (b.left < -0.5 || b.right > ancho + 0.5) malos.push(`${nombre} fuera: ${Math.round(b.left)}..${Math.round(b.right)}`);
        if (b.width < 24 || b.height < 24) malos.push(`${nombre} pequeño: ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      // Ningún control visible pisa a otro (una caja de búsqueda desbordando sobre «Reemplazar…» pasó inadvertida).
      const cajas = Array.from(document.querySelectorAll<HTMLElement>('.topbar button, .topbar .search-box'))
        .filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
        .map((el) => ({ el, n: el.id || el.className, b: el.getBoundingClientRect() }));
      for (let i = 0; i < cajas.length; i++) {
        for (let j = i + 1; j < cajas.length; j++) {
          if (cajas[i]!.el.contains(cajas[j]!.el) || cajas[j]!.el.contains(cajas[i]!.el)) continue;
          const a = cajas[i]!.b; const c = cajas[j]!.b;
          if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) malos.push(`${cajas[i]!.n} solapa ${cajas[j]!.n}`);
        }
      }
      return { malos, total, scrollX: document.documentElement.scrollWidth > ancho };
    });
    expect(r.total).toBeGreaterThan(5);
    expect(r.malos).toEqual([]);
    expect(r.scrollX).toBe(false);
  });
});
