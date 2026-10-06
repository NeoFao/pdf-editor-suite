import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/**
 * Panel «Más» (`#toolbar-more`) en móvil (E-069). Las cinco barras contextuales
 * se agrupan por pestaña, con encabezado por grupo, controles táctiles, sin
 * solapes y con scroll vertical propio. Todo medido en px CSS de viewport
 * (getBoundingClientRect), con una fuente ancha forzada (lección de E-051).
 */
test.use({ viewport: { width: 390, height: 844 } });

const GRUPOS = ['editar', 'comentar', 'organizar', 'firmar', 'convertir'];

test.describe('Panel «Más» en móvil', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.next.html');
    await page.addStyleTag({ content: '#app, #app * { font-family: "DejaVu Sans", Verdana, "Arial Black", sans-serif !important; letter-spacing: 0.04em !important; }' });
    await page.locator('#file-input').setInputFiles(NATIVO);
    await expect(page.locator('.run').first()).toBeVisible();
    await page.locator('#btn-more').click();
    await expect(page.locator('#toolbar-more.open')).toBeVisible();
  });

  test('cada pestaña es un grupo con su encabezado, apilados en orden', async ({ page }) => {
    const titulos = await page.locator('#toolbar-more.open .context-bar > .context-titulo').allTextContents();
    expect(titulos.map((t) => t.trim())).toEqual(['Editar', 'Comentar', 'Organizar', 'Rellenar y firmar', 'Convertir']);
    for (const g of GRUPOS) {
      await expect(page.locator(`#panel-${g} > .context-titulo`)).toBeVisible();
    }
  });

  test('ningún control se solapa con otro ni desborda su etiqueta; los táctiles miden >= 40 px', async ({ page }) => {
    const datos = await page.evaluate(() => {
      const panel = document.querySelector('#toolbar-more')!;
      const visibles = Array.from(panel.querySelectorAll<HTMLElement>('button, input, select, label'))
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        })
        // Un <label> que envuelve un control es contenedor: se mide el control y la etiqueta suelta.
        .filter((e) => !(e.tagName === 'LABEL' && e.querySelector('input, select, button')));
      const cajas = visibles.map((e) => {
        const r = e.getBoundingClientRect();
        return {
          id: e.id || e.className || e.tagName,
          tag: e.tagName,
          tipo: (e as HTMLInputElement).type ?? '',
          swatch: e.classList.contains('swatch'),
          x: r.x, y: r.y, w: r.width, h: r.height,
          desborda: e.scrollWidth > e.clientWidth + 1
        };
      });
      return cajas;
    });
    expect(datos.length).toBeGreaterThan(30);
    for (let i = 0; i < datos.length; i++) {
      const a = datos[i]!;
      expect(a.desborda, `${a.id} desborda su etiqueta`).toBe(false);
      if (!a.swatch && a.tipo !== 'checkbox' && a.tipo !== 'range') {
        expect(a.h, `${a.id} alto`).toBeGreaterThanOrEqual(39.5);
      }
      for (let j = i + 1; j < datos.length; j++) {
        const b = datos[j]!;
        const ancho = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const alto = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ancho > 1 && alto > 1, `${a.id} solapa con ${b.id}`).toBe(false);
      }
    }
  });

  test('sin scroll horizontal de la página ni del panel; el panel tiene scroll vertical propio', async ({ page }) => {
    const m = await page.evaluate(() => {
      const p = document.querySelector('#toolbar-more')!;
      return {
        paginaH: document.documentElement.scrollWidth > window.innerWidth + 1,
        panelH: p.scrollWidth > p.clientWidth + 1,
        vertical: p.scrollHeight > p.clientHeight,
        overflowY: getComputedStyle(p).overflowY,
        bajoPantalla: p.getBoundingClientRect().bottom <= window.innerHeight + 1
      };
    });
    expect(m.paginaH).toBe(false);
    expect(m.panelH).toBe(false);
    expect(m.vertical).toBe(true);
    expect(['auto', 'scroll']).toContain(m.overflowY);
    expect(m.bajoPantalla).toBe(true);
  });

  test('todos los controles son alcanzables con scroll del panel y «Comprimir» abre su diálogo', async ({ page }) => {
    const ids = await page.locator('#toolbar-more button[id]').evaluateAll(
      (els) => els.filter((e) => e.getBoundingClientRect().width > 0 && !e.classList.contains('swatch')).map((e) => e.id)
    );
    expect(ids).toContain('btn-compress');
    for (const id of ids) {
      await page.locator('#' + id).scrollIntoViewIfNeeded();
      const dentro = await page.evaluate((i) => {
        const r = document.getElementById(i)!.getBoundingClientRect();
        const p = document.querySelector('#toolbar-more')!.getBoundingClientRect();
        return r.top >= p.top - 1 && r.bottom <= p.bottom + 1 && r.left >= p.left - 1 && r.right <= p.right + 1;
      }, id);
      expect(dentro, `${id} queda dentro del panel tras el scroll`).toBe(true);
    }
    await page.locator('#btn-compress').scrollIntoViewIfNeeded();
    await page.locator('#btn-compress').click();
    await expect(page.locator('#compress-panel')).toBeVisible();
  });
});
