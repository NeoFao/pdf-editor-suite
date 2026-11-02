import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';
import type { CharBox } from '../../src/engine/PdfEngine';
import { caretsDeRango, moverFoco, rangoDeCarets, type ContextoTexto } from '../../src/texto/seleccionMultipagina';
import { SeleccionTexto } from '../../src/ui/SeleccionTexto';

// E-115: Mayús+flecha cruza páginas. Tres páginas de 300x200 pt, tres líneas por página, caracteres de 10x12 pt.
const caja = (ch: string, x: number, y: number): CharBox => ({ ch, boxPt: { xPt: x, yPt: y, wPt: 10, hPt: 12 } });
const sinCaja = (ch: string): CharBox => ({ ch, boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } });
const LINEAS = [['Alfa uno', 'Alfa dos', 'Alfa tres'], ['Beta uno', 'Beta dos', 'Beta tres'], ['Gamma uno', 'Gamma dos', 'Gamma tres']];

/** Caracteres de una página: líneas de arriba abajo (y baja), separadas por \r\n sin caja como PDFium. */
function pagina(lineas: string[]): CharBox[] {
  const out: CharBox[] = [];
  lineas.forEach((t, k) => {
    if (k > 0) out.push(sinCaja('\r'), sinCaja('\n'));
    [...t].forEach((ch, i) => out.push(caja(ch, 30 + i * 10, 150 - k * 40)));
  });
  return out;
}
const PAGINAS = LINEAS.map(pagina);
const geo = PageGeometry.desdeTamanoVisual(300, 200, 1, 0);
const ctx: ContextoTexto = { numPaginas: 3, chars: (p) => PAGINAS[p]!, geo: () => geo };
const texto = (cs: CharBox[]): string => cs.map((c) => c.ch).join('');
const N1 = PAGINAS[0]!.length;

test('moverFoco carácter: al agotar la página salta al primer carácter de la siguiente y al revés', () => {
  expect(moverFoco(ctx, { pagina: 0, caret: N1 }, 'caracter', 1)).toEqual({ pagina: 1, caret: 1 });
  expect(moverFoco(ctx, { pagina: 1, caret: 0 }, 'caracter', -1)).toEqual({ pagina: 0, caret: N1 - 1 });
  expect(moverFoco(ctx, { pagina: 0, caret: 3 }, 'caracter', 1)).toEqual({ pagina: 0, caret: 4 }); // dentro de la página, igual que antes
});

test('moverFoco carácter: sin página contigua no se mueve; las páginas sin caracteres con caja se saltan', () => {
  expect(moverFoco(ctx, { pagina: 2, caret: PAGINAS[2]!.length }, 'caracter', 1)).toEqual({ pagina: 2, caret: PAGINAS[2]!.length });
  expect(moverFoco(ctx, { pagina: 0, caret: 0 }, 'caracter', -1)).toEqual({ pagina: 0, caret: 0 });
  const conVacia: ContextoTexto = { ...ctx, chars: (p) => (p === 1 ? [] : PAGINAS[p]!) };
  expect(moverFoco(conVacia, { pagina: 0, caret: N1 }, 'caracter', 1)).toEqual({ pagina: 2, caret: 1 });
});

test('moverFoco línea: desde la última línea cruza a la primera de la contigua conservando la x, y al revés', () => {
  const ult = PAGINAS[0]!.length - 'Alfa tres'.length; // caret ante la "A" de la última línea
  const abajo = moverFoco(ctx, { pagina: 0, caret: ult + 3 }, 'linea', 1); // columna del 4.º carácter
  expect(abajo.pagina).toBe(1);
  expect(texto(PAGINAS[1]!.slice(abajo.caret, abajo.caret + 4))).toBe('a un'); // 4.º carácter de "Beta uno" (índice 3)
  expect(abajo.caret).toBe(3);
  const arriba = moverFoco(ctx, { pagina: 1, caret: 5 }, 'linea', -1); // línea 1 de p2 → última línea de p1, mismo x
  expect(arriba.pagina).toBe(0);
  expect(arriba.caret).toBe(ult + 5);
  // Dentro de la página sigue siendo una línea normal.
  expect(moverFoco(ctx, { pagina: 0, caret: 3 }, 'linea', 1).pagina).toBe(0);
});

test('rangoDeCarets: el borde entre páginas es una sola posición; ancla y foco iguales = vacío', () => {
  expect(rangoDeCarets(ctx, { pagina: 0, caret: N1 }, { pagina: 1, caret: 0 })).toBeNull();
  const r = rangoDeCarets(ctx, { pagina: 0, caret: N1 - 3 }, { pagina: 1, caret: 2 })!;
  expect(r).toEqual({ paginaAncla: 0, ancla: N1 - 3, paginaFoco: 1, foco: 1, inversa: false });
  // Hacia atrás: el foco queda antes que el ancla.
  expect(rangoDeCarets(ctx, { pagina: 1, caret: 2 }, { pagina: 0, caret: N1 - 3 })).toEqual({ paginaAncla: 1, ancla: 1, paginaFoco: 0, foco: N1 - 3, inversa: true });
  // Ancla en el final de p1: pasa a ser el principio de p2.
  expect(rangoDeCarets(ctx, { pagina: 0, caret: N1 }, { pagina: 1, caret: 3 })).toEqual({ paginaAncla: 1, ancla: 0, paginaFoco: 1, foco: 2, inversa: false });
});

test('caretsDeRango: carácter inclusivo → caret, también entre páginas', () => {
  expect(caretsDeRango({ paginaAncla: 0, ancla: 4, paginaFoco: 1, foco: 2 })).toEqual({ ancla: { pagina: 0, caret: 4 }, foco: { pagina: 1, caret: 3 } });
  expect(caretsDeRango({ paginaAncla: 1, ancla: 2, paginaFoco: 0, foco: 4 })).toEqual({ ancla: { pagina: 1, caret: 3 }, foco: { pagina: 0, caret: 4 } });
});

// ---- La clase real, sin DOM (los wrappers no existen: no se pinta nada, solo el modelo) -------------------------
function seleccion(): SeleccionTexto {
  return new SeleccionTexto({
    wrapper: () => undefined,
    geom: () => geo,
    pagina: () => ({ sizePt: { widthPt: 300, heightPt: 200 }, rotation: 0, origenPt: { xPt: 0, yPt: 0 } }),
    chars: (i) => PAGINAS[i]!,
    numPaginas: () => 3,
    scroller: () => ({}) as HTMLElement,
    activa: () => true,
    alEmpezar: () => undefined
  });
}
/** Caja de la última línea de p1 ("Alfa tres"). */
const CAJA_ULT = { xPt: 30, yPt: 70, wPt: 90, hPt: 12 };

test('SeleccionTexto.extender: Mayús+→ desde la última línea cruza a p2 y copia "Alfa tres\\nBet"', () => {
  const s = seleccion();
  for (let i = 0; i < 12; i++) expect(s.extender(0, CAJA_ULT, 'caracter', 1)).toBe(true);
  expect(s.texto()).toBe('Alfa tres\nBet');
  expect(s.paginaFoco).toBe(1);
});

test('SeleccionTexto.extender: Mayús+↓ desde la última línea de p1 llega a la primera línea de p2 con la misma x', () => {
  const s = seleccion();
  for (let i = 0; i < 3; i++) s.extender(0, CAJA_ULT, 'caracter', 1); // "Alf": el foco queda en la columna 3
  s.extender(0, CAJA_ULT, 'linea', 1);
  expect(s.paginaFoco).toBe(1);
  expect(s.texto()).toBe('Alfa tres\nBet'); // columna 3 de "Beta uno"
});

test('SeleccionTexto.extender: sobre una selección de ratón de p1 a p2, el ancla se conserva y el foco avanza', () => {
  const s = seleccion();
  // Selección "de ratón" (modelo interno): desde la 3.ª letra de p1 hasta la 2.ª de p2.
  (s as unknown as { sel: unknown }).sel = { paginaAncla: 0, ancla: 2, paginaFoco: 1, foco: 1 };
  const antes = s.texto();
  expect(antes.startsWith('fa uno')).toBe(true);
  s.extender(0, CAJA_ULT, 'caracter', 1);
  expect(s.texto()).toBe(antes + 't');
  s.extender(0, CAJA_ULT, 'caracter', 1);
  expect(s.texto()).toBe(antes + 'ta');
  expect(s.texto().startsWith('fa uno')).toBe(true); // el ancla no se movió
  s.extender(0, CAJA_ULT, 'caracter', -1);
  s.extender(0, CAJA_ULT, 'caracter', -1);
  expect(s.texto()).toBe(antes);
});

test('SeleccionTexto.extender: Mayús+← cruza hacia atrás de p2 a p1 (foco antes que el ancla)', () => {
  const s = seleccion();
  const cajaP2 = { xPt: 30, yPt: 150, wPt: 80, hPt: 12 }; // "Beta uno"
  for (let i = 0; i < 8; i++) s.extender(1, cajaP2, 'caracter', -1);
  expect(s.texto()).toBe('Beta uno');
  s.extender(1, cajaP2, 'caracter', -1);
  expect(s.paginaFoco).toBe(0);
  expect(s.texto()).toBe('s\nBeta uno');
});
