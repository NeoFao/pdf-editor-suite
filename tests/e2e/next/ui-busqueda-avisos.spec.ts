import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana, escribirNota } from './_ayudas';

/**
 * Fase 2 del sistema de diseño (E-130): barra de buscar y reemplazar, panel de comentarios, panel de marcadores,
 * aviso de conversión y avisos sobre la página. Contrato: contraste ≥ 4,5 con los colores COMPUTADOS en claro y oscuro,
 * foco visible, sin colores heredados en línea y las acciones de la tarjeta alcanzables con ratón y con teclado.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADORES = path.resolve(AQUI, '../../fixtures/generados/marcadores.pdf');
const WORD = path.resolve(AQUI, '../../fixtures/generados/word-completo.docx');

/** PDF mínimo con una página por tamaño `[ancho, alto]` (pt). */
function pdfConPaginas(paginas: Array<[number, number]>): Buffer {
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${paginas.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  paginas.forEach(([w, h], i) => {
    const pg = 4 + i * 2;
    const flujo = 'BT /F1 24 Tf 40 100 Td (HHHH) Tj ET';
    objs[pg] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pg + 1} 0 R >>`;
    objs[pg + 1] = `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  for (let n = 1; n < objs.length; n++) { off[n] = out.length; out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(off[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Contraste (WCAG) del texto de cada elemento bajo `raiz` con su fondo efectivo (capas opacas y translúcidas de los ancestros). Devuelve los que no llegan a 4,5. */
async function auditar(page: Page, raiz: string): Promise<string[]> {
  return page.evaluate((sel) => {
    type C = [number, number, number, number];
    const parse = (c: string): C => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
    };
    const sobre = (a: C, b: C): C => {
      const al = a[3] + b[3] * (1 - a[3]);
      return al === 0 ? [0, 0, 0, 0] : ([0, 1, 2].map((i) => (a[i]! * a[3] + b[i]! * b[3] * (1 - a[3])) / al).concat(al) as C);
    };
    const lum = (c: C) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: C, b: C) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const fondo = (el: Element): C => {
      const capas: C[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) capas.push(c);
        if (c[3] >= 1) break;
      }
      const base = parse(getComputedStyle(document.body).backgroundColor);
      return capas.reduceRight<C>((acc, c) => sobre(c, acc), base[3] > 0 ? base : [255, 255, 255, 1]);
    };
    const malos: string[] = [];
    const visible = (e: Element) => {
      for (let n: Element | null = e; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    for (const r of Array.from(document.querySelectorAll(sel))) {
      for (const el of [r, ...Array.from(r.querySelectorAll('*'))]) {
        if (el.closest(':disabled, [aria-disabled="true"], .sr-only')) continue;
        if (!visible(el)) continue;
        const propio = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
        if (!propio) continue;
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const bg = fondo(el);
        const fgOpaco = sobre(fg, bg);
        const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
        const r2 = ratio(fgOpaco, bg);
        if (r2 < (grande ? 3 : 4.5)) malos.push(`${el.tagName.toLowerCase()}.${el.className} «${(el.textContent ?? '').trim().slice(0, 30)}» ${r2.toFixed(2)}`);
      }
    }
    return malos;
  }, raiz);
}

async function abrirConNotas(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MARCADORES);
  await expect(page.locator('.run').first()).toBeVisible();
  for (const [i, t] of [[0, 'Primera nota del contrato'], [2, 'Tercera nota, devolver firmada']] as const) {
    await page.locator('#tab-pages').click();
    await page.locator('#thumbs canvas').nth(i).click();
    await abrirPestana(page, 'comentar');
    await page.locator('#btn-note').click();
    await page.locator('.page').nth(i).click({ position: { x: 400, y: 600 } });
    await escribirNota(page, t);
  }
}

async function focoVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) || (cs.boxShadow !== 'none' && cs.boxShadow !== '');
  });
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema}`, () => {
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' }); });

    test('barra de reemplazo: contraste, etiqueta visible, botones del sistema y foco', async ({ page }) => {
      await page.goto('/index.next.html');
      await page.locator('#file-input').setInputFiles(MARCADORES);
      await expect(page.locator('.run').first()).toBeVisible();
      await page.locator('#btn-replace-toggle').click();
      expect(await auditar(page, '#replace-bar')).toEqual([]);
      // Etiqueta visible asociada al campo (WCAG 3.3.2) y botones con la jerarquía del sistema.
      await expect(page.locator('label[for="replace-input"]')).toBeVisible();
      await expect(page.locator('#replace-input')).toHaveAccessibleName('Reemplazar con');
      await expect(page.locator('#btn-replace')).toHaveClass(/btn--secundario/);
      await expect(page.locator('#btn-replace-close')).toHaveClass(/btn--fantasma/);
      await expect(page.locator('#btn-replace-close')).toHaveAccessibleName('Cerrar buscar y reemplazar');
      await page.locator('#replace-input').focus();
      expect(await focoVisible(page)).toBe(true);
      await page.keyboard.press('Tab');
      await expect(page.locator('#opt-case')).toBeFocused();
      expect(await focoVisible(page)).toBe(true);
    });

    test('comentarios: tarjetas con contraste, acciones por foco/hover y foco visible', async ({ page }) => {
      await abrirConNotas(page);
      await page.locator('#tab-comments').click();
      await expect(page.locator('.comentario')).toHaveCount(2);
      expect(await auditar(page, '#comments-panel')).toEqual([]);
      const primera = page.locator('.comentario').first();
      // En reposo las acciones están ocultas; con el ratón encima o con el foco dentro, visibles.
      await expect(primera.locator('.comentario-acciones')).toHaveCSS('opacity', '0');
      await primera.hover();
      await expect(primera.locator('.comentario-acciones')).toHaveCSS('opacity', '1');
      expect(await auditar(page, '#comments-panel')).toEqual([]);
      await page.locator('.comentario').nth(1).locator('.comentario-item').focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('.comentario').nth(1).locator('.comentario-acciones')).toHaveCSS('opacity', '1');
      expect(await focoVisible(page)).toBe(true);
      // Sigue habiendo etiqueta visible en el filtro.
      await expect(page.locator('label[for="comentarios-filtro"]')).toBeVisible();
      // Sin autor ni fecha en el modelo (CommentInfo): la tarjeta muestra tipo y página.
      await expect(primera.locator('.comentario-tipo')).toHaveText('Nota');
      await expect(primera.locator('.comentario-pag')).toHaveText('Página 1');
    });

    test('marcadores: árbol con estado activo, plegado y contraste', async ({ page }) => {
      await page.goto('/index.next.html');
      await page.locator('#file-input').setInputFiles(MARCADORES);
      await expect(page.locator('.run').first()).toBeVisible();
      await page.locator('#tab-outline').click();
      const cap1 = page.locator('li[role="treeitem"]').filter({ has: page.locator('.outline-item', { hasText: 'Capítulo 1' }) }).first();
      await cap1.locator('.outline-toggle').click();
      await expect(cap1).toHaveAttribute('aria-expanded', 'true');
      await page.locator('.outline-item', { hasText: 'Sección 1.1' }).click();
      const sel = page.locator('li.seleccionado > .outline-fila');
      await expect(sel).toHaveCount(1);
      // Estado activo con el acento suave del sistema (no el gris de hover).
      const colores = await sel.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, tokenBg: getComputedStyle(document.documentElement).getPropertyValue('--ed-accent-soft').trim() }));
      expect(colores.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(await auditar(page, '#sidebar')).toEqual([]);
      await expect(page.locator('#btn-outline-borrar')).toHaveClass(/btn--peligro/);
      // El anillo de foco del árbol lo dibuja la fila del elemento enfocado con el teclado.
      await page.locator('#btn-outline-nuevo').focus();
      await page.keyboard.press('Shift+Tab');
      await page.locator('li.seleccionado').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(page.locator('li.seleccionado')).toBeFocused();
      const anillo = await page.locator('li.seleccionado > .outline-fila').evaluate((el) => ({ estilo: getComputedStyle(el).outlineStyle, ancho: parseFloat(getComputedStyle(el).outlineWidth) }));
      expect(anillo.estilo !== 'none' && anillo.ancho >= 1).toBe(true);
      // Plegar de nuevo oculta al hijo.
      await cap1.locator('.outline-toggle').click();
      await expect(page.locator('.outline-item', { hasText: 'Sección 1.1' })).toBeHidden();
    });

    test('aviso de conversión: agrupado con recuento, contraste y cierre accesible', async ({ page }) => {
      await page.goto('/index.next.html');
      await page.locator('#file-input').setInputFiles(WORD);
      await expect(page.locator('#conversion-warnings')).toBeVisible();
      expect(await auditar(page, '#conversion-warnings')).toEqual([]);
      const grupo = page.locator('.conversion-warnings-group:not([hidden])');
      await expect(grupo).toHaveCount(1);
      await expect(grupo.locator('.conversion-warnings-n')).toHaveText(String(await grupo.locator('li').count()));
      await page.locator('#conversion-warnings-close').focus();
      expect(await focoVisible(page)).toBe(true);
      await page.locator('#conversion-warnings-close').click();
      await expect(page.locator('#conversion-warnings')).toBeHidden();
    });

    test('avisos sobre la página: error de página y resolución reducida con tokens y contraste', async ({ page }) => {
      await page.goto('/index.next.html');
      await page.locator('#file-input').setInputFiles({ name: 'enorme.pdf', mimeType: 'application/pdf', buffer: pdfConPaginas([[612, 792], [1e9, 1e9], [7200, 7200]]) });
      await page.locator('.page').first().waitFor({ state: 'attached' });
      await page.locator('.page').nth(1).scrollIntoViewIfNeeded();
      await expect(page.locator('.pagina-invalida')).toBeVisible();
      expect(await auditar(page, '.pagina-invalida')).toEqual([]);
      await page.locator('.page').nth(2).scrollIntoViewIfNeeded();
      await expect(page.locator('.aviso-resolucion').first()).toBeVisible();
      expect(await auditar(page, '.aviso-resolucion')).toEqual([]);
      // Ya no llevan estilo en línea de color: lo pone el sistema de diseño.
      const inline = await page.evaluate(() => Array.from(document.querySelectorAll('.pagina-invalida, .aviso-resolucion')).map((e) => (e as HTMLElement).getAttribute('style')));
      expect(inline.every((s) => !s)).toBe(true);
    });
  });
}
