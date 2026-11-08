/**
 * E-130 · Sistema de diseño de la app nueva (src/ui/tema.css). Comprueba en Chromium real, con estilos
 * COMPUTADOS (no leyendo el CSS), lo que el rediseño promete y que un diff no demuestra:
 *  - la barra de estado habla de la pestaña que se ve (un aviso de Comentar no sobrevive en Organizar);
 *  - el diálogo de encabezado no tiene campos huérfanos: el foco inicial cae en el primer campo y todo
 *    campo visible tiene una etiqueta visible;
 *  - con `prefers-reduced-motion` ninguna transición dura nada (duración computada 0);
 *  - contraste AA (≥ 4,5:1) de todo texto de la carcasa y del diálogo, y de los placeholders, en claro
 *    y en oscuro, calculado con los colores computados y componiendo los fondos translúcidos (vidrio);
 *  - `forced-colors` sigue funcionando (bordes y foco con colores del sistema, capa de texto transparente);
 *  - el conmutador de tema fija y recuerda el tema.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function abrirDialogoEncabezado(page: Page): Promise<void> {
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-encabezado').click();
  await expect(page.locator('#encabezado-panel')).toBeVisible();
}

test('la barra de estado corresponde a la pestaña activa (un aviso de Comentar no sigue en Organizar)', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-underline').click(); // sin línea seleccionada: avisa
  await expect(page.locator('#status')).toHaveText(/subrayar/i);
  await abrirPestana(page, 'organizar');
  await expect(page.locator('#status')).not.toHaveText(/subrayar/i);
  await expect(page.locator('#status')).toHaveText('2 página(s)');
});

test('una herramienta activa mantiene su indicación al cambiar de pestaña', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-pen').click();
  await expect(page.locator('#status')).toHaveText(/Modo pluma/);
  await abrirPestana(page, 'organizar');
  await expect(page.locator('#status')).toHaveText(/Modo pluma/);
});

test('diálogo de encabezado: sin campo huérfano, el foco inicial es el primer campo con etiqueta visible', async ({ page }) => {
  await abrir(page);
  await abrirDialogoEncabezado(page);
  const r = await page.evaluate(() => {
    const d = document.querySelector<HTMLDialogElement>('#encabezado-panel')!;
    const visible = (e: Element): boolean => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const campos = Array.from(d.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')).filter(visible);
    const huerfanos = campos.filter((c) => !Array.from(c.labels ?? []).some((l) => visible(l) && (l.textContent ?? '').trim() !== '')).map((c) => c.id || c.outerHTML.slice(0, 60));
    const activo = document.activeElement as HTMLInputElement | null;
    return {
      huerfanos,
      activo: activo?.id ?? null,
      etiquetaActivo: activo && 'labels' in activo ? Array.from(activo.labels ?? []).map((l) => l.textContent?.trim()) : [],
      primerCampo: campos[0]?.id ?? null
    };
  });
  expect(r.huerfanos).toEqual([]);
  expect(r.activo).toBe(r.primerCampo);
  expect(r.activo).toBe('eh-arriba-izq');
  expect(r.etiquetaActivo).toEqual(['Izquierda']);
  // El nombre accesible completo contiene la etiqueta visible (WCAG 2.5.3).
  await expect(page.getByRole('textbox', { name: 'Arriba, izquierda' })).toBeFocused();
});

test('diálogo de encabezado: acciones al pie a la derecha, la primaria la última y destacada', async ({ page }) => {
  await abrir(page);
  await abrirDialogoEncabezado(page);
  const r = await page.evaluate(() => {
    const caja = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const d = caja('#encabezado-panel');
    const aplicar = caja('#eh-aplicar');
    const cancelar = caja('#eh-cancelar');
    const fondo = (s: string) => getComputedStyle(document.querySelector(s)!).backgroundColor;
    return { derecha: d.right - aplicar.right, ordenOk: cancelar.right <= aplicar.left, fondoAplicar: fondo('#eh-aplicar'), fondoCancelar: fondo('#eh-cancelar') };
  });
  expect(r.derecha).toBeLessThan(40);
  expect(r.ordenOk).toBe(true);
  expect(r.fondoAplicar).not.toBe(r.fondoCancelar);
});

test('con reducedMotion: reduce ninguna transición dura nada (duración computada 0)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await abrir(page);
  await abrirDialogoEncabezado(page);
  const conTransicion = await page.evaluate(() => {
    const malos: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        const dur = cs.transitionDuration.split(',').map((v) => parseFloat(v));
        const anim = cs.animationDuration.split(',').map((v) => parseFloat(v));
        if (dur.some((v) => v > 0) || anim.some((v) => v > 0)) malos.push(`${el.tagName}.${(el as HTMLElement).className}${pseudo ?? ''}: ${cs.transitionDuration}`);
      }
    }
    return malos;
  });
  expect(conTransicion).toEqual([]);
});

test('sin reducedMotion los controles sí se animan (la regla anterior no es un apagado total)', async ({ page }) => {
  await abrir(page);
  const dur = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#tab-editar')!).transitionDuration));
  expect(dur).toBeGreaterThanOrEqual(0.12);
  expect(dur).toBeLessThanOrEqual(0.2);
});

/**
 * Contraste de todo texto visible de la carcasa y del diálogo abierto (excepto el contenido del documento,
 * dentro de #viewer) y de los placeholders. El fondo efectivo se obtiene componiendo, de dentro afuera,
 * los fondos computados de los ancestros hasta uno opaco. Si el texto está sobre vidrio (un ancestro con
 * backdrop-filter), se toma además el peor caso del vidrio sobre negro puro y sobre blanco puro.
 */
async function auditarContraste(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
    };
    const sobre = (a: RGBA, b: RGBA): RGBA => {
      const al = a[3] + b[3] * (1 - a[3]);
      if (al === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (a[i]! * a[3] + b[i]! * b[3] * (1 - a[3])) / al).concat(al) as RGBA;
    };
    const lum = (c: RGBA): number => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    /** Fondos efectivos posibles (1, o 2 si hay vidrio: peor caso sobre negro y blanco). */
    const fondos = (el: Element): RGBA[] => {
      const capas: RGBA[] = [];
      let vidrio = false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') vidrio = true;
        const c = parse(cs.backgroundColor);
        if (c[3] > 0) capas.push(c);
        if (c[3] >= 1) break;
      }
      const componer = (base: RGBA) => capas.reduceRight<RGBA>((acc, c) => sobre(c, acc), base);
      const raiz = parse(getComputedStyle(document.body).backgroundColor);
      const res = [componer(raiz[3] > 0 ? raiz : [255, 255, 255, 1])];
      if (vidrio) res.push(componer([0, 0, 0, 1]), componer([255, 255, 255, 1]));
      return res;
    };
    const visible = (e: Element): boolean => {
      const b = e.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      for (let n: Element | null = e; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
      }
      return true;
    };
    const malos: string[] = [];
    const raices = [document.querySelector('#app')!, ...Array.from(document.querySelectorAll('dialog[open]'))];
    for (const raiz of raices) {
      for (const el of Array.from(raiz.querySelectorAll('*'))) {
        if (el.closest('#viewer, .sr-only, [aria-hidden="true"]')) continue;
        if (el.closest(':disabled, [aria-disabled="true"]')) continue; // WCAG 1.4.3 exime a los controles inactivos
        const conTexto = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
        if (conTexto && visible(el)) {
          const fg = parse(getComputedStyle(el).color);
          const peor = Math.min(...fondos(el).map((b) => ratio(sobre(fg, b), b)));
          if (peor < 4.5) malos.push(`${el.tagName}#${el.id}.${(el as HTMLElement).className} «${el.textContent?.trim().slice(0, 30)}» ${peor.toFixed(2)}`);
        }
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder && !el.value && visible(el)) {
          const fg = parse(getComputedStyle(el, '::placeholder').color);
          const peor = Math.min(...fondos(el).map((b) => ratio(sobre(fg, b), b)));
          if (peor < 4.5) malos.push(`placeholder #${el.id} «${el.placeholder}» ${peor.toFixed(2)}`);
        }
      }
    }
    return malos;
  });
}

for (const esquema of ['light', 'dark'] as const) {
  test(`contraste AA (≥ 4,5) en carcasa y diálogo, tema ${esquema === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: esquema, reducedMotion: 'reduce' });
    await abrir(page);
    for (const p of ['editar', 'comentar', 'organizar', 'firmar', 'convertir'] as const) {
      await abrirPestana(page, p);
      expect(await auditarContraste(page), `pestaña ${p}`).toEqual([]);
    }
    await abrirDialogoEncabezado(page);
    expect(await auditarContraste(page), 'diálogo, pestaña Encabezado y pie').toEqual([]);
    await page.locator('#eh-tab-marca').click();
    expect(await auditarContraste(page), 'diálogo, pestaña Marca de agua').toEqual([]);
  });
}

test('forced-colors: el diálogo, los botones y el foco siguen visibles con colores del sistema', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await abrir(page);
  // La capa de texto sigue transparente sobre el PDF (E-127).
  expect(await page.locator('.run').first().evaluate((el) => getComputedStyle(el).color)).toBe('rgba(0, 0, 0, 0)');
  await abrirDialogoEncabezado(page);
  const r = await page.evaluate(() => {
    const d = getComputedStyle(document.querySelector('#encabezado-panel')!);
    const ap = getComputedStyle(document.querySelector('#eh-aplicar')!);
    const ca = getComputedStyle(document.querySelector('#eh-cancelar')!);
    return { borde: d.borderTopStyle, ancho: parseFloat(d.borderTopWidth), vidrio: d.backdropFilter, fondoAplicar: ap.backgroundColor, bordeCancelar: ca.borderTopStyle };
  });
  expect(r.borde).toBe('solid');
  expect(r.ancho).toBeGreaterThanOrEqual(1);
  expect(r.vidrio).toBe('none');
  expect(r.fondoAplicar).not.toBe('rgba(0, 0, 0, 0)');
  expect(r.bordeCancelar).toBe('solid');
  // Foco por teclado visible dentro del diálogo.
  await page.keyboard.press('Tab');
  const foco = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return { estilo: cs.outlineStyle, ancho: parseFloat(cs.outlineWidth), sombra: cs.boxShadow }; });
  expect(foco.estilo !== 'none' && foco.ancho >= 1).toBe(true);
});

test('el conmutador de tema fija el tema contrario al del sistema y lo recuerda al recargar', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/index.next.html');
  const fondo = () => page.evaluate(() => getComputedStyle(document.querySelector('.topbar')!).backgroundColor);
  const claro = await fondo();
  await expect(page.locator('#btn-tema')).toHaveAccessibleName('Cambiar a tema oscuro');
  await page.locator('#btn-tema').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#btn-tema')).toHaveAccessibleName('Cambiar a tema claro');
  const oscuro = await fondo();
  expect(oscuro).not.toBe(claro);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await fondo()).toBe(oscuro);
});
