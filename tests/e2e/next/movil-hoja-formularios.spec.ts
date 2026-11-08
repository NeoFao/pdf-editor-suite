/**
 * E-134 · Fase 2 del sistema de diseño: hoja «Más» móvil, cajón lateral y campos de formulario sobre la página.
 *  - la hoja es un panel inferior de vidrio que entra y sale animado, se cierra con el asa, el velo y Escape, y
 *    todos sus controles son destinos táctiles de 44 px (375 × 812, con pantalla táctil);
 *  - el cajón lateral y la hoja superan el contraste AA (≥ 4,5) en claro y oscuro, abiertos;
 *  - los campos de formulario sobre la página miden y ocupan EXACTAMENTE la caja que les da el visor (±1 px, en
 *    móvil y en escritorio) y se leen sobre el papel blanco en los dos temas: texto oscuro, casilla clara.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const FORMULARIO = path.resolve(AQUI, '../../fixtures/generados/formulario.pdf');

async function abrir(page: Page, pdf: string): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#viewer canvas').first()).toBeVisible();
}

/** Contraste AA de todo texto visible de la carcasa (misma lógica que `sistema-diseno.spec.ts`). */
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
    for (const el of Array.from(document.querySelector('#app')!.querySelectorAll('*'))) {
      if (el.closest('#viewer, .sr-only, [aria-hidden="true"]')) continue;
      if (el.closest(':disabled, [aria-disabled="true"]')) continue;
      const conTexto = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (conTexto && visible(el)) {
        const fg = parse(getComputedStyle(el).color);
        const peor = Math.min(...fondos(el).map((b) => ratio(sobre(fg, b), b)));
        if (peor < 4.5) malos.push(`${el.tagName}#${el.id}.${(el as HTMLElement).className} «${el.textContent?.trim().slice(0, 30)}» ${peor.toFixed(2)}`);
      }
    }
    return malos;
  });
}

test.describe('hoja «Más» y cajón en móvil 375 × 812 táctil', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('la hoja es un panel inferior de vidrio con asa; cerrada no es visible ni tabulable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // medir en reposo, no a mitad de la animación
    await abrir(page, NATIVO);
    const cerrada = await page.evaluate(() => {
      const h = document.querySelector('#toolbar-more')!;
      const cs = getComputedStyle(h);
      return { visibilidad: cs.visibility, posicion: cs.position, y: h.getBoundingClientRect().top };
    });
    expect(cerrada.visibilidad).toBe('hidden');
    expect(cerrada.posicion).toBe('fixed');
    expect(cerrada.y).toBeGreaterThanOrEqual(812 - 1); // fuera de pantalla, por debajo

    await page.locator('#btn-more').tap();
    await expect(page.locator('#toolbar-more.open')).toBeVisible();
    await expect(page.locator('#btn-more')).toHaveAttribute('aria-expanded', 'true');
    const abierta = await page.evaluate(() => {
      const h = document.querySelector('#toolbar-more')!;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return {
        ancho: r.width, abajo: r.bottom, alto: r.height,
        vidrio: cs.backdropFilter !== 'none', radio: cs.borderTopLeftRadius,
        asa: document.querySelector('.hoja-asa') !== null,
        foco: document.activeElement?.className
      };
    });
    expect(abierta.ancho).toBe(375);
    expect(Math.abs(abierta.abajo - 812)).toBeLessThanOrEqual(1);
    expect(abierta.alto).toBeLessThanOrEqual(812 * 0.78 + 1);
    expect(abierta.vidrio).toBe(true);
    expect(parseFloat(abierta.radio)).toBeGreaterThanOrEqual(12);
    expect(abierta.foco).toBe('hoja-asa');
  });

  test('entra y sale con transición (y sin ella con reduced-motion)', async ({ page }) => {
    await abrir(page, NATIVO);
    const dur = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#toolbar-more')!).transitionDuration));
    expect(dur).toBeGreaterThanOrEqual(0.12);
    expect(dur).toBeLessThanOrEqual(0.2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducida = await page.evaluate(() => getComputedStyle(document.querySelector('#toolbar-more')!).transitionDuration);
    expect(reducida).toBe('0s');
  });

  test('se cierra con el asa, con el velo y con Escape, y devuelve el foco a «Más»', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page, NATIVO);
    const abrirHoja = async () => { await page.locator('#btn-more').tap(); await expect(page.locator('#toolbar-more.open')).toBeVisible(); };
    await abrirHoja();
    await page.locator('.hoja-asa').tap();
    await expect(page.locator('#toolbar-more.open')).toHaveCount(0);
    await expect(page.locator('#btn-more')).toBeFocused();

    await abrirHoja();
    await page.touchscreen.tap(187, 40); // velo (zona libre sobre la hoja, bajo la barra: la fila del buscador)
    await expect(page.locator('#toolbar-more.open')).toHaveCount(0);

    await abrirHoja();
    await page.keyboard.press('Escape');
    await expect(page.locator('#toolbar-more.open')).toHaveCount(0);
    await expect(page.locator('#btn-more')).toBeFocused();
  });

  test('todo control de la hoja es un destino táctil de al menos 44 × 44 px', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page, NATIVO);
    await page.locator('#btn-more').tap();
    await expect(page.locator('#toolbar-more.open')).toBeVisible();
    const pequenos = await page.evaluate(() => {
      const malos: string[] = [];
      const controles = Array.from(document.querySelectorAll<HTMLElement>('#toolbar-more button, #toolbar-more select, #toolbar-more input'));
      let n = 0;
      for (const e of controles) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'range')) continue;
        n++;
        if (r.width < 43.5 || r.height < 43.5) malos.push(`${e.id || e.className || e.tagName} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
      }
      return { malos, n };
    });
    expect(pequenos.n).toBeGreaterThan(30);
    expect(pequenos.malos).toEqual([]);
  });

  test('el cajón lateral es de vidrio, entra animado y sus pestañas miden 44 px', async ({ page }) => {
    await abrir(page, NATIVO);
    await page.locator('#btn-drawer').tap();
    await expect(page.locator('#sidebar.abierto')).toBeVisible();
    const m = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#sidebar')!);
      const tabs = Array.from(document.querySelectorAll<HTMLElement>('#sidebar .sidebar-tabs .tab')).map((t) => t.getBoundingClientRect().height);
      return { vidrio: s.backdropFilter !== 'none', dur: parseFloat(s.transitionDuration), tabs };
    });
    expect(m.vidrio).toBe(true);
    expect(m.dur).toBeGreaterThan(0);
    for (const h of m.tabs) expect(h).toBeGreaterThanOrEqual(43.5);
  });

  for (const esquema of ['light', 'dark'] as const) {
    test(`contraste AA (≥ 4,5) con la hoja y con el cajón abiertos, tema ${esquema === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: esquema, reducedMotion: 'reduce' });
      await abrir(page, NATIVO);
      await page.locator('#btn-more').tap();
      await expect(page.locator('#toolbar-more.open')).toBeVisible();
      expect(await auditarContraste(page), 'hoja «Más»').toEqual([]);
      await page.locator('#btn-more').tap();
      await page.locator('#btn-drawer').tap();
      await expect(page.locator('#sidebar.abierto')).toBeVisible();
      expect(await auditarContraste(page), 'cajón').toEqual([]);
    });
  }
});

/** Caja de cada campo frente a la que le dio el visor (en línea, px CSS de página): ±1 px. */
async function desviaciones(page: Page): Promise<{ n: number; malos: string[] }> {
  return page.evaluate(() => {
    const malos: string[] = [];
    const campos = Array.from(document.querySelectorAll<HTMLElement>('.form-layer .form-field'));
    for (const c of campos) {
      const capa = c.parentElement!.getBoundingClientRect();
      const r = c.getBoundingClientRect();
      const esperado = {
        left: parseFloat(c.style.left), top: parseFloat(c.style.top),
        width: parseFloat(c.style.width), height: parseFloat(c.style.height)
      };
      const real = { left: r.left - capa.left, top: r.top - capa.top, width: r.width, height: r.height };
      for (const k of ['left', 'top', 'width', 'height'] as const) {
        if (Math.abs(real[k] - esperado[k]) > 1) malos.push(`${c.dataset.fieldName} ${k}: ${real[k].toFixed(1)} ≠ ${esperado[k].toFixed(1)}`);
      }
    }
    return { n: campos.length, malos };
  });
}

test.describe('campos de formulario sobre la página', () => {
  test('móvil táctil: cada campo ocupa exactamente su caja (±1 px), también los combos y listas', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await abrir(page, FORMULARIO);
    await expect(page.locator('.form-layer .form-field').first()).toBeVisible();
    const r = await desviaciones(page);
    expect(r.n).toBeGreaterThanOrEqual(5);
    expect(r.malos).toEqual([]);
    await ctx.close();
  });

  test('escritorio: cada campo ocupa exactamente su caja (±1 px)', async ({ page }) => {
    await abrir(page, FORMULARIO);
    await expect(page.locator('.form-layer .form-field').first()).toBeVisible();
    const r = await desviaciones(page);
    expect(r.n).toBeGreaterThanOrEqual(5);
    expect(r.malos).toEqual([]);
  });

  for (const esquema of ['light', 'dark'] as const) {
    test(`se leen sobre el papel blanco, tema ${esquema === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: esquema, reducedMotion: 'reduce' });
      await abrir(page, FORMULARIO);
      await expect(page.locator('.form-layer .form-field').first()).toBeVisible();
      const m = await page.evaluate(() => {
        type RGB = [number, number, number];
        const parse = (c: string): RGB => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as RGB;
        const lum = (c: RGB): number => {
          const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const ratio = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const papel: RGB = [255, 255, 255];
        const salida: Record<string, number | string> = {};
        const texto = document.querySelector<HTMLInputElement>('.form-field[data-field-name="ciudad"]')!;
        const cs = getComputedStyle(texto);
        const fondo = parse(cs.backgroundColor);
        // El fondo del campo es casi opaco: se compone sobre el papel blanco.
        const alfa = parseFloat((cs.backgroundColor.match(/[\d.]+/g) ?? [])[3] ?? '1');
        const comp = fondo.map((v, i) => v * alfa + papel[i]! * (1 - alfa)) as RGB;
        salida.textoSobreCampo = ratio(parse(cs.color), comp);
        salida.bordeSobrePapel = ratio(parse(cs.borderTopColor), papel);
        salida.esquemaCasilla = getComputedStyle(document.querySelector('.form-field[type="checkbox"]')!).colorScheme;
        salida.esquemaCombo = getComputedStyle(document.querySelector('select.form-field')!).colorScheme;
        const foco = document.querySelector<HTMLElement>('.form-field[type="text"]')!;
        foco.focus();
        const fs = getComputedStyle(foco);
        salida.focoSombra = fs.boxShadow;
        salida.focoBorde = ratio(parse(fs.borderTopColor), papel);
        return salida;
      });
      expect(m.textoSobreCampo as number).toBeGreaterThanOrEqual(4.5);
      expect(m.bordeSobrePapel as number).toBeGreaterThanOrEqual(3);
      expect(m.esquemaCasilla).toBe('light');
      expect(m.esquemaCombo).toBe('light');
      expect(m.focoSombra).not.toBe('none');
      expect(m.focoBorde as number).toBeGreaterThanOrEqual(3);
    });
  }
});
