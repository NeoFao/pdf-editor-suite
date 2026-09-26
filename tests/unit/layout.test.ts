import { test, expect } from 'vitest';
import { visiblePageIndices } from '../../src/ui/layout';

const alturas = Array.from({ length: 20 }, () => 800);

test('solo-renderiza-paginas-visibles: pocas páginas aunque el doc sea grande', () => {
  const arriba = visiblePageIndices(alturas, 10, 0, 900);
  expect(arriba).toContain(0);
  expect(arriba.length).toBeLessThanOrEqual(4);
  const medio = visiblePageIndices(alturas, 10, 5000, 900);
  expect(medio.length).toBeLessThanOrEqual(4);
  // No incluye páginas lejanas al viewport
  expect(medio).not.toContain(0);
  expect(medio).not.toContain(19);
});

test('viewport fuera de todo devuelve []', () => {
  expect(visiblePageIndices(alturas, 10, 1_000_000, 900)).toEqual([]);
});
