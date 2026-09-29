import { test, expect } from 'vitest';
import { visiblePageIndices, calcularEscalaAjusteAncho } from '../../src/ui/layout';

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

/**
 * Revisión de PR #63: "ajustar al ancho" dejaba la página unos px MÁS ANCHA
 * que el hueco disponible, abriendo una barra de scroll horizontal en el
 * visor. Causa raíz: `Math.round` a la centésima puede redondear la escala
 * HACIA ARRIBA. `disponiblePx=1242, widthPt=595.28` es un caso real (visto
 * en 1440×900 con `nativo.pdf`): `(1242/595.28)*100 = 208.617...`, cuya parte
 * decimal (.617) redondeaba a 209 en vez de 208 — `2.09 * 595.28 = 1244.13
 * > 1242`. Este test fallaba con la implementación anterior (`Math.round`)
 * y pasa con `Math.floor`.
 */
test('calcularEscalaAjusteAncho: nunca deja la página más ancha que el hueco disponible (redondeo que antes se pasaba de largo)', () => {
  const disponiblePx = 1242;
  const widthPt = 595.28;
  const escala = calcularEscalaAjusteAncho(disponiblePx, widthPt);
  expect(widthPt * escala).toBeLessThanOrEqual(disponiblePx);
  // La escala sigue siendo razonable (no se desploma a 0 ni al mínimo).
  expect(escala).toBeGreaterThan(2);
});

test('calcularEscalaAjusteAncho: nunca desborda para un barrido amplio de tamaños de visor y de página', () => {
  // El suelo de zoom (25 %, ver el siguiente test) puede por diseño dejar la
  // página más ancha que el hueco cuando ese hueco es MENOR que una cuarta
  // parte del ancho de página — un visor así de estrecho no ocurre en la
  // práctica (sidebar + padding ya consumen bastante más), así que el barrido
  // arranca en 300px, por encima de `0.25 * 1000.7` (el mayor `widthPt` del
  // barrido): en ese rango el suelo nunca entra en juego y la propiedad
  // "nunca desborda" tiene que cumplirse siempre.
  for (let disponiblePx = 300; disponiblePx <= 2000; disponiblePx += 7) {
    for (const widthPt of [419.53, 595.28, 612, 792, 1000.7]) {
      const escala = calcularEscalaAjusteAncho(disponiblePx, widthPt);
      expect(widthPt * escala).toBeLessThanOrEqual(disponiblePx + 1e-9);
    }
  }
});

test('calcularEscalaAjusteAncho: se acota a [0.25, 4] y no revienta con un hueco de 0 o negativo', () => {
  expect(calcularEscalaAjusteAncho(0, 595.28)).toBe(0.25);
  expect(calcularEscalaAjusteAncho(-10, 595.28)).toBe(0.25);
  expect(calcularEscalaAjusteAncho(100000, 100)).toBe(4);
});
