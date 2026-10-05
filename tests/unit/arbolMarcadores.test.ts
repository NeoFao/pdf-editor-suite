import { test, expect } from 'vitest';
import type { OutlineItem } from '../../src/engine/PdfEngine';
import { OUTLINE_MAX_DEPTH } from '../../src/engine/cotasOutline';
import { borrar, cambiarDestino, desangrar, insertarHermano, insertarHijo, mover, renombrar, sangrar } from '../../src/outline/arbol';

const n = (title: string, children: OutlineItem[] = [], pageIndex: number | null = 0): OutlineItem => ({ title, pageIndex, children });
const titulos = (items: OutlineItem[]): unknown => items.map((i) => (i.children.length ? [i.title, titulos(i.children)] : i.title));

const base = (): OutlineItem[] => [n('A', [n('A1'), n('A2')]), n('B'), n('C')];

test('insertarHermano coloca el nuevo a continuación; sin selección, al final de la raíz', () => {
  const r = insertarHermano(base(), [0], n('X'))!;
  expect(titulos(r.items)).toEqual([['A', ['A1', 'A2']], 'X', 'B', 'C']);
  expect(r.ruta).toEqual([1]);
  const r2 = insertarHermano(base(), [0, 0], n('X'))!;
  expect(titulos(r2.items)).toEqual([['A', ['A1', 'X', 'A2']], 'B', 'C']);
  expect(r2.ruta).toEqual([0, 1]);
  expect(titulos(insertarHermano(base(), null, n('X'))!.items)).toEqual([['A', ['A1', 'A2']], 'B', 'C', 'X']);
});

test('insertarHijo añade como último hijo', () => {
  const r = insertarHijo(base(), [1], n('B1'))!;
  expect(titulos(r.items)).toEqual([['A', ['A1', 'A2']], ['B', ['B1']], 'C']);
  expect(r.ruta).toEqual([1, 0]);
});

test('las operaciones no mutan la entrada', () => {
  const b = base();
  const copia = JSON.stringify(b);
  borrar(b, [0]); renombrar(b, [1], 'z'); mover(b, [1], -1); sangrar(b, [1]); desangrar(b, [0, 1]); cambiarDestino(b, [1], 5);
  expect(JSON.stringify(b)).toBe(copia);
});

test('borrar elimina el nodo con sus hijos', () => {
  expect(titulos(borrar(base(), [0])!)).toEqual(['B', 'C']);
  expect(titulos(borrar(base(), [0, 1])!)).toEqual([['A', ['A1']], 'B', 'C']);
  expect(borrar(base(), [9])).toBeNull();
});

test('renombrar y cambiarDestino', () => {
  expect(renombrar(base(), [0, 1], 'ñ 😀')![0]!.children[1]!.title).toBe('ñ 😀');
  expect(cambiarDestino(base(), [1], 7)![1]!.pageIndex).toBe(7);
});

test('mover arriba/abajo intercambia con el hermano y respeta los extremos', () => {
  const r = mover(base(), [1], -1)!;
  expect(titulos(r.items)).toEqual(['B', ['A', ['A1', 'A2']], 'C']);
  expect(r.ruta).toEqual([0]);
  expect(mover(base(), [0], -1)).toBeNull();
  expect(mover(base(), [2], 1)).toBeNull();
  expect(titulos(mover(base(), [0, 0], 1)!.items)).toEqual([['A', ['A2', 'A1']], 'B', 'C']);
});

test('sangrar: último hijo del hermano anterior; imposible sin hermano anterior', () => {
  const r = sangrar(base(), [1])!;
  expect(titulos(r.items)).toEqual([['A', ['A1', 'A2', 'B']], 'C']);
  expect(r.ruta).toEqual([0, 2]);
  expect(sangrar(base(), [0])).toBeNull();
});

test('desangrar: sube un nivel tras su padre y adopta a los hermanos posteriores (preorden intacto)', () => {
  const r = desangrar(base(), [0, 0])!;
  expect(titulos(r.items)).toEqual(['A', ['A1', ['A2']], 'B', 'C']);
  expect(r.ruta).toEqual([1]);
  expect(desangrar(base(), [1])).toBeNull();
});

test('sangrar respeta OUTLINE_MAX_DEPTH (E-031)', () => {
  let cadena: OutlineItem = n('hoja');
  for (let i = 0; i < OUTLINE_MAX_DEPTH; i++) cadena = n(`n${i}`, [cadena]);
  // cadena ocupa profundidades 0..OUTLINE_MAX_DEPTH; un hermano posterior no puede sangrarse bajo ella con su subárbol hondo.
  const arbol = [n('antes'), cadena];
  expect(sangrar(arbol, [1])).toBeNull();
  expect(sangrar([n('a'), n('b')], [1])).not.toBeNull();
});

test('clonar conserva la acción URI y renombrar no la toca; cambiarDestino la sustituye por la página', () => {
  const arbol: OutlineItem[] = [{ title: 'Web', pageIndex: null, children: [], accion: { tipo: 'uri', uri: 'https://a.es' } }];
  expect(renombrar(arbol, [0], 'X')![0]!.accion).toEqual({ tipo: 'uri', uri: 'https://a.es' });
  const r = cambiarDestino(arbol, [0], 2)![0]!;
  expect(r.pageIndex).toBe(2);
  expect(r.accion).toBeUndefined();
});
