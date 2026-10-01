import { test, expect } from 'vitest';
import { buscarEnRuns, aplicarReemplazos } from '../../src/texto/buscarReemplazar';

const O = { mayusculas: false, palabraCompleta: false };
const runs = (...t: string[]) => t.map((text, i) => ({ runId: i, text }));

test('encuentra todas las coincidencias dentro de un run, con sus desplazamientos', () => {
  const r = buscarEnRuns(runs('casa y casa'), 'casa', O);
  expect(r.dentro).toEqual([{ runId: 0, inicio: 0, fin: 4 }, { runId: 0, inicio: 7, fin: 11 }]);
  expect(r.cruzan).toBe(0);
});

test('por defecto no distingue mayúsculas; con la opción, sí', () => {
  expect(buscarEnRuns(runs('Casa CASA casa'), 'casa', O).dentro).toHaveLength(3);
  expect(buscarEnRuns(runs('Casa CASA casa'), 'casa', { ...O, mayusculas: true }).dentro).toHaveLength(1);
});

test('palabra completa: no casa dentro de otra palabra, sí con signos de puntuación alrededor', () => {
  const r = buscarEnRuns(runs('casa casado (casa), casas_ ñcasa'), 'casa', { ...O, palabraCompleta: true });
  expect(r.dentro.map((c) => c.inicio)).toEqual([0, 13]);
});

test('palabra completa respeta letras acentuadas y dígitos', () => {
  const r = buscarEnRuns(runs('año años 1a a1 a'), 'a', { ...O, palabraCompleta: true });
  expect(r.dentro.map((c) => c.inicio)).toEqual([15]);
});

test('las coincidencias no se solapan: "aa" en "aaaa" son 2', () => {
  expect(buscarEnRuns(runs('aaaa'), 'aa', O).dentro).toHaveLength(2);
});

test('los caracteres especiales de regex se tratan como texto literal', () => {
  expect(buscarEnRuns(runs('a.b a*b axb'), 'a.b', O).dentro).toHaveLength(1);
  expect(buscarEnRuns(runs('1+1=2 (x)'), '(x)', O).dentro).toHaveLength(1);
});

test('una consulta vacía no encuentra nada', () => {
  expect(buscarEnRuns(runs('abc'), '', O)).toEqual({ dentro: [], cruzan: 0 });
});

test('una coincidencia que cruza dos runs se cuenta aparte y no entra en "dentro"', () => {
  const r = buscarEnRuns(runs('el documento termina aquí', 'La segunda línea'), 'aquí La', O);
  expect(r.dentro).toEqual([]);
  expect(r.cruzan).toBe(1);
});

test('cruce sin espacio (palabra partida entre dos runs) también se cuenta', () => {
  const r = buscarEnRuns(runs('inter', 'nacional'), 'internacional', O);
  expect(r.cruzan).toBe(1);
  expect(r.dentro).toEqual([]);
});

test('mezcla: las de dentro se devuelven y las que cruzan se cuentan', () => {
  const r = buscarEnRuns(runs('uno dos', 'dos tres'), 'dos', O);
  expect(r.dentro).toHaveLength(2);
  const c = buscarEnRuns(runs('uno dos', 'dos tres'), 'dos dos', O);
  expect(c.dentro).toEqual([]);
  expect(c.cruzan).toBe(1);
});

test('aplicarReemplazos sustituye de derecha a izquierda y el reemplazo es literal ($& no se interpreta)', () => {
  const t = 'casa y casa';
  const m = buscarEnRuns(runs(t), 'casa', O).dentro;
  expect(aplicarReemplazos(t, m, 'piso')).toBe('piso y piso');
  expect(aplicarReemplazos(t, m, '$&$1')).toBe('$&$1 y $&$1');
  expect(aplicarReemplazos(t, m, '')).toBe(' y ');
});
