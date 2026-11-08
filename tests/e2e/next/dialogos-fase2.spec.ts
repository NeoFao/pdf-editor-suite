/**
 * E-130 fase 2 · Diálogos migrados al sistema de diseño: nota, firma, Mis firmas, enlace externo y apertura
 * (error y contraseña). En Chromium real y con estilos COMPUTADOS: contraste AA (≥ 4,5) de todo texto en claro y
 * oscuro, foco visible, anatomía .dlg-cabecera/.dlg-cuerpo/.dlg-pie con el primario el último, y sin estilos
 * inline de color. Con CAPTURA=antes|despues y CAPTURAS_DIR guarda las capturas (fuera de git).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';
import { pdfCifrado } from './_pdfsInvalidos';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const ENLACES = path.resolve(AQUI, '../../fixtures/generados/enlaces-externos.pdf');

async function abrir(page: Page, pdf = NATIVO): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function dibujar(page: Page): Promise<void> {
  const b = (await page.locator('#sig-canvas').boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 90);
  await page.mouse.down();
  await page.mouse.move(b.x + 140, b.y + 40, { steps: 8 });
  await page.mouse.move(b.x + 260, b.y + 100, { steps: 8 });
  await page.mouse.up();
}

interface Caso { nombre: string; id: string; abrir: (page: Page) => Promise<void>; pdf?: string }

const CASOS: Caso[] = [
  { nombre: 'nota', id: '#nota-dialogo', abrir: async (p) => { await p.keyboard.press('n'); await p.keyboard.press('Enter'); await p.getByLabel('Texto de la nota').fill('Revisar esta cifra con contabilidad antes del viernes.'); } },
  { nombre: 'firma', id: '#signature-pad', abrir: async (p) => { await abrirPestana(p, 'firmar'); await p.locator('#btn-sign').click(); await dibujar(p); } },
  { nombre: 'mis-firmas', id: '#mis-firmas-panel', abrir: async (p) => {
    await abrirPestana(p, 'firmar');
    await p.locator('#btn-sign').click(); await dibujar(p);
    await p.locator('#sig-guardar').check(); await p.locator('#sig-nombre').fill('Firma de Ana');
    await p.locator('#sig-confirm').click();
    await p.locator('#btn-mis-firmas').click();
  } },
  { nombre: 'enlace', id: '#external-link-dialog', pdf: ENLACES, abrir: async (p) => { await p.locator('.run', { hasText: 'Enlace HTTPS externo' }).click({ modifiers: ['Control'] }); } },
  { nombre: 'enlace-peligro', id: '#external-link-dialog', pdf: ENLACES, abrir: async (p) => { await p.locator('.run', { hasText: 'Enlace javascript peligroso' }).click({ modifiers: ['Control'] }); } },
  { nombre: 'apertura-error', id: '#apertura-error', abrir: async (p) => { await p.locator('#file-input').setInputFiles({ name: 'roto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('no soy un pdf') }); } },
  { nombre: 'apertura-contrasena', id: '#apertura-contrasena', abrir: async (p) => {
    await p.locator('#file-input').setInputFiles({ name: 'cifrado.pdf', mimeType: 'application/pdf', buffer: pdfCifrado() });
    await p.locator('#apertura-contrasena-campo').fill('mala');
    await p.locator('#apertura-contrasena').getByRole('button', { name: 'Abrir' }).click();
    await expect(p.locator('#apertura-contrasena [role="alert"]')).toBeVisible();
  } }
];

/** Contraste AA del texto visible del diálogo abierto (fondos translúcidos compuestos; el vidrio, en su peor caso). */
async function contrasteMalo(page: Page, id: string): Promise<string[]> {
  return page.evaluate((sel) => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
    };
    const sobre = (a: RGBA, b: RGBA): RGBA => {
      const al = a[3] + b[3] * (1 - a[3]); if (al === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (a[i]! * a[3] + b[i]! * b[3] * (1 - a[3])) / al).concat(al) as RGBA;
    };
    const lum = (c: RGBA) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const fondos = (el: Element): RGBA[] => {
      const capas: RGBA[] = []; let vidrio = false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') vidrio = true;
        const c = parse(cs.backgroundColor); if (c[3] > 0) capas.push(c); if (c[3] >= 1) break;
      }
      const comp = (base: RGBA) => capas.reduceRight<RGBA>((acc, c) => sobre(c, acc), base);
      const res = [comp([255, 255, 255, 1])];
      if (vidrio) res.push(comp([0, 0, 0, 1]), comp([255, 255, 255, 1]));
      return res;
    };
    const visible = (e: Element) => { const b = e.getBoundingClientRect(); if (!b.width || !b.height) return false; for (let n: Element | null = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return false; } return true; };
    const malos: string[] = [];
    for (const el of Array.from(document.querySelector(sel)!.querySelectorAll('*'))) {
      if (el.closest(':disabled, [aria-disabled="true"]')) continue;
      const conTexto = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (conTexto && visible(el)) {
        const fg = parse(getComputedStyle(el).color);
        const peor = Math.min(...fondos(el).map((b) => ratio(sobre(fg, b), b)));
        if (peor < 4.5) malos.push(`${el.tagName}#${el.id}.${(el as HTMLElement).className} «${el.textContent?.trim().slice(0, 30)}» ${peor.toFixed(2)}`);
      }
    }
    return malos;
  }, id);
}

for (const esquema of ['light', 'dark'] as const) {
  for (const caso of CASOS) {
    test(`${caso.nombre}: contraste AA, anatomía y foco visible, tema ${esquema === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: esquema, reducedMotion: 'reduce' });
      await abrir(page, caso.pdf);
      await caso.abrir(page);
      const dlg = page.locator(caso.id);
      await expect(dlg).toBeVisible();
      await expect(dlg).toHaveClass(/dlg/);
      if (process.env.CAPTURA && process.env.CAPTURAS_DIR) {
        await page.screenshot({ path: path.join(process.env.CAPTURAS_DIR, `fase2-dialogos-${process.env.CAPTURA}-${caso.nombre}-${esquema === 'light' ? 'light' : 'dark'}.png`), animations: 'disabled' });
        return;
      }
      expect(await contrasteMalo(page, caso.id)).toEqual([]);

      // Anatomía: cabecera con título, cuerpo y pie; el primario (si lo hay) es el último botón del pie.
      await expect(dlg.locator('.dlg-cabecera .dlg-titulo')).toHaveCount(1);
      await expect(dlg.locator('.dlg-cuerpo')).toHaveCount(1);
      await expect(dlg.locator('.dlg-pie')).toHaveCount(1);
      const pie = await dlg.locator('.dlg-pie button').evaluateAll((bs) => bs.map((b) => b.className));
      const primarios = pie.filter((c) => c.includes('btn--primario'));
      expect(primarios.length).toBeLessThanOrEqual(1);
      if (primarios.length === 1) expect(pie[pie.length - 1]).toContain('btn--primario');

      // Sin colores en línea (todo sale de los tokens).
      const inline = await dlg.evaluate((d) => Array.from(d.querySelectorAll<HTMLElement>('[style]')).filter((e) => /color|background|border/i.test(e.getAttribute('style') ?? '')).map((e) => e.id || e.tagName));
      expect(inline).toEqual([]);

      // Foco visible: Tab hasta un control y su contorno computado es el anillo (≥ 2 px).
      await page.keyboard.press('Tab');
      const foco = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { dentro: !!a.closest('dialog'), ancho: parseFloat(cs.outlineWidth), estilo: cs.outlineStyle, sombra: cs.boxShadow }; });
      expect(foco.dentro).toBe(true);
      expect((foco.estilo !== 'none' && foco.ancho >= 2) || foco.sombra !== 'none').toBe(true);
    });
  }
}

test('E-132: el campo de contraseña tiene el aspecto de campo del sistema, igual que uno de texto', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await abrir(page);
  await page.locator('#file-input').setInputFiles({ name: 'cifrado.pdf', mimeType: 'application/pdf', buffer: pdfCifrado() });
  const campo = page.locator('#apertura-contrasena-campo');
  await expect(campo).toBeVisible();
  const estilo = (l: typeof campo) => l.evaluate((e) => { const cs = getComputedStyle(e); return [cs.borderRadius, cs.borderTopStyle, cs.backgroundColor, cs.minHeight]; });
  const delCampo = await estilo(campo);
  // Referencia: un campo de texto del mismo diálogo del sistema.
  const ref = await campo.evaluate((e) => { const t = document.createElement('input'); t.type = 'text'; e.closest('dialog')!.appendChild(t); const cs = getComputedStyle(t); const r = [cs.borderRadius, cs.borderTopStyle, cs.backgroundColor, cs.minHeight]; t.remove(); return r; });
  expect(delCampo).toEqual(ref);
  expect(delCampo[0]).not.toBe('0px');
});

test('Esc cierra el diálogo de nota', async ({ page }) => {
  await abrir(page);
  await page.keyboard.press('n'); await page.keyboard.press('Enter');
  await expect(page.locator('#nota-dialogo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#nota-dialogo')).toHaveCount(0);
});

test('firma: Deshacer quita el último trazo y Limpiar los borra todos', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'firmar');
  await page.locator('#btn-sign').click();
  const hayTinta = () => page.locator('#sig-canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
  await expect(page.locator('#sig-undo')).toBeDisabled();
  await dibujar(page);
  await expect(page.locator('#sig-undo')).toBeEnabled();
  expect(await hayTinta()).toBe(true);
  await page.locator('#sig-undo').click();
  expect(await hayTinta()).toBe(false);
  await dibujar(page); await dibujar(page);
  await page.locator('#sig-clear').click();
  expect(await hayTinta()).toBe(false);
});
