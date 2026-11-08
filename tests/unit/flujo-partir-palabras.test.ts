import { test, expect } from 'vitest';
import { partirPalabrasLargas, wrapAtoms, type Atom, type Medir } from '../../src/convert/flujo/layout';

/** E-124: una palabra más ancha que la línea se parte por caracteres (como `overflow-wrap: break-word`). Medida falsa: 1 pt por carácter. */
const medir: Medir = (_f, _s, t) => Array.from(t).length;
const atomo = (text: string, extra: Partial<Atom> = {}): Atom => ({ text, font: 'Helvetica', sizePt: 10, color: [0, 0, 0], ...extra });

test('una palabra que cabe no se toca (misma referencia)', () => {
  const a = atomo('hola');
  expect(partirPalabrasLargas([a], 10, medir)[0]).toBe(a);
});

test('una palabra más ancha que la línea se parte en trozos que caben y conservan todos los caracteres', () => {
  const trozos = partirPalabrasLargas([atomo('x'.repeat(25))], 10, medir);
  expect(trozos.map((t) => t.text)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  expect(trozos.every((t) => medir('', 0, t.text) <= 10)).toBe(true);
});

test('los trozos siguientes van pegados (sin espacio) y no repiten marcas; propiedades como url se conservan', () => {
  const [a, b] = partirPalabrasLargas([atomo('abcdefghij', { url: 'https://e.org', marcas: ['m'] })], 5, medir);
  expect(a).toMatchObject({ text: 'abcde', url: 'https://e.org', marcas: ['m'] });
  expect(b).toMatchObject({ text: 'fghij', url: 'https://e.org', pegado: true });
  expect(b!.marcas).toBeUndefined();
});

test('las tabulaciones (texto vacío) y los emoji (par sustituto) no se rompen', () => {
  const tab = atomo('', { tab: {} });
  expect(partirPalabrasLargas([tab], 5, medir)[0]).toBe(tab);
  const r = partirPalabrasLargas([atomo('😀'.repeat(8))], 3, medir);
  expect(r.map((t) => t.text).join('')).toBe('😀'.repeat(8));
  expect(r.every((t) => !/[\ud800-\udbff]$/.test(t.text) && !/^[\udc00-\udfff]/.test(t.text))).toBe(true);
});

test('con wrapAtoms ninguna línea supera el ancho aunque la palabra sea larga', () => {
  const atoms = partirPalabrasLargas([atomo('corto'), atomo('y'.repeat(33)), atomo('fin')], 10, medir);
  const lineas = wrapAtoms(atoms, 10, medir);
  for (const l of lineas) {
    const ancho = l.reduce((s, a, i) => s + medir('', 0, a.text) + (i > 0 && !a.pegado ? 1 : 0), 0);
    expect(ancho).toBeLessThanOrEqual(10);
  }
  expect(lineas.flat().map((a) => a.text).join('').replace(/ /g, '')).toBe('corto' + 'y'.repeat(33) + 'fin');
});

test('una palabra gigante se parte con pocas mediciones (no cuadrático)', () => {
  let llamadas = 0;
  const m: Medir = (_f, _s, t) => { llamadas++; return t.length; };
  const trozos = partirPalabrasLargas([atomo('z'.repeat(20000))], 100, m);
  expect(trozos).toHaveLength(200);
  expect(llamadas).toBeLessThan(200 * 40);
});
