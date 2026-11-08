/**
 * Auditoría de contraste AA compartida por los specs de la fase 2 (copia de la de `sistema-diseno.spec.ts`
 * para no tocar ese fichero en paralelo con otras migraciones). Ver el comentario de allí.
 */
import type { Page } from '@playwright/test';

export async function auditarContraste(page: Page): Promise<string[]> {
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
