import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { CharBox } from '../../src/engine/PdfEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-103 con el motor REAL: `word-parrafo-celda.docx` (ver `generar-fixtures.mjs`): una fila de 4 celdas de 115 pt (x = 72, 187,
 * 302, 417; relleno 5 pt => interior de 105 pt). A centrada, B derecha, C justificada con sangría derecha de 36 pt y D izquierda con
 * 12 pt antes, 6 después e interlineado 1,5. Las posiciones se leen de las CAJAS DE CARACTERES del PDF resultante (pt de página,
 * y hacia ARRIBA). Los textos son copia deliberada del generador (ese módulo ejecuta `main()` al importarlo).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const T = {
  centro: 'Centro', derecha: 'Derecha', despues: 'Despues',
  justif: 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce',
  espaciado: 'Espaciado uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce'
};
const COL_X = [72, 187, 302, 417]; // x del borde izquierdo de cada celda (pt)
const RELLENO = 5, INTERIOR = 105, TOL = 2; // relleno lateral, ancho interior (pt) y tolerancia por el "side bearing" del glifo

interface Linea { texto: string; izq: number; der: number; yCentro: number; yArriba: number }

/** Agrupa los caracteres visibles de una franja de x en líneas (de arriba abajo): borde izquierdo/derecho de tinta y altura. */
function lineasDe(chars: CharBox[], x0: number, x1: number): Linea[] {
  const vis = chars.filter((c) => c.ch.trim() !== '' && c.boxPt.wPt > 0 && c.boxPt.xPt >= x0 - 1 && c.boxPt.xPt < x1);
  const grupos: CharBox[][] = [];
  for (const c of vis) {
    const yc = c.boxPt.yPt + c.boxPt.hPt / 2;
    const g = grupos.find((gr) => Math.abs(gr[0]!.boxPt.yPt + gr[0]!.boxPt.hPt / 2 - yc) < 5);
    if (g) g.push(c); else grupos.push([c]);
  }
  return grupos.map((g) => {
    const ord = [...g].sort((a, b) => a.boxPt.xPt - b.boxPt.xPt);
    return {
      texto: ord.map((c) => c.ch).join(''), izq: ord[0]!.boxPt.xPt, der: Math.max(...ord.map((c) => c.boxPt.xPt + c.boxPt.wPt)),
      yCentro: ord[0]!.boxPt.yPt + ord[0]!.boxPt.hPt / 2, yArriba: Math.max(...ord.map((c) => c.boxPt.yPt + c.boxPt.hPt))
    };
  }).sort((a, b) => b.yCentro - a.yCentro);
}

test('word-parrafo-celda.docx (E-103): alineación, sangría derecha, espaciado e interlineado de cada párrafo de celda, en el PDF', async () => {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-parrafo-celda.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  expect(textosAdvertencias(advertencias)).toEqual([]);
  const doc = await engine.open(pdf);
  const chars = engine.getCharBoxes(doc, 0);
  const col = (k: number): Linea[] => lineasDe(chars, COL_X[k]!, COL_X[k]! + 115);
  const ancho = (s: string): number => engine.measureText('Helvetica', 10, s);
  const interiorIzq = (k: number): number => COL_X[k]! + RELLENO;
  const interiorDer = (k: number): number => interiorIzq(k) + INTERIOR;

  // A: una línea centrada en el ancho interior: x = interiorIzq + (interior - ancho) / 2.
  const [a] = col(0);
  expect(a!.texto).toBe(T.centro);
  expect(Math.abs(a!.izq - (interiorIzq(0) + (INTERIOR - ancho(T.centro)) / 2))).toBeLessThanOrEqual(TOL);
  // B: una línea a la derecha: x = interiorDer - ancho.
  const [b] = col(1);
  expect(b!.texto).toBe(T.derecha);
  expect(Math.abs(b!.izq - (interiorDer(1) - ancho(T.derecha)))).toBeLessThanOrEqual(TOL);
  expect(Math.abs(b!.der - interiorDer(1))).toBeLessThanOrEqual(TOL);

  // C: justificada con sangría derecha de 36 pt: cada línea salvo la última arranca en el interior izquierdo y acaba en interiorDer - 36.
  const c = col(2);
  expect(c.length).toBeGreaterThanOrEqual(3);
  expect(c.map((l) => l.texto).join('')).toBe(T.justif.replace(/ /g, ''));
  for (const l of c.slice(0, -1)) {
    expect(Math.abs(l.izq - interiorIzq(2)), l.texto).toBeLessThanOrEqual(TOL);
    expect(Math.abs(l.der - (interiorDer(2) - 36)), l.texto).toBeLessThanOrEqual(TOL);
  }
  // La última línea NO se estira: arranca a la izquierda y mide lo natural de su texto con espacios (que PDFium no extrae: se reconstruyen por la palabra).
  const ultimaC = c[c.length - 1]!;
  expect(Math.abs(ultimaC.izq - interiorIzq(2))).toBeLessThanOrEqual(TOL);
  const palabras = T.justif.split(' ');
  const ultimaPalabras = (() => { let resto = ultimaC.texto; const out: string[] = []; for (let i = palabras.length - 1; i >= 0 && resto.endsWith(palabras[i]!); i--) { out.unshift(palabras[i]!); resto = resto.slice(0, -palabras[i]!.length); } return out; })();
  expect(Math.abs(ultimaC.der - ultimaC.izq - ancho(ultimaPalabras.join(' ')))).toBeLessThanOrEqual(TOL);

  // D: a la izquierda, 12 antes, 6 después, interlineado 1,5 => 15 pt entre líneas.
  const d = col(3);
  expect(d.length).toBeGreaterThanOrEqual(2);
  for (const l of d) expect(Math.abs(l.izq - interiorIzq(3)), l.texto).toBeLessThanOrEqual(TOL);
  for (let i = 1; i < d.length; i++) expect(Math.abs(d[i - 1]!.yCentro - d[i]!.yCentro - 15)).toBeLessThanOrEqual(1);
  // Primera línea de D respecto a la de A: (relleno + antes 12 + alto de línea 15 × 0,72) - (relleno + 12 × 0,72) = 14,16 pt más abajo.
  expect(Math.abs((a!.yArriba - d[0]!.yArriba) - (12 + 15 * 0.72 - 12 * 0.72))).toBeLessThanOrEqual(1.5);

  // Altura de la fila (la manda D): 10 de relleno + 12 antes + n × 15 + 6 después. El párrafo de debajo queda a fila + 8 de hueco de tabla.
  const filaPt = 10 + 12 + d.length * 15 + 6;
  const alto = lineasDe(chars, 72, 72 + 115).find((l) => l.texto === T.despues)!;
  expect(alto).toBeDefined();
  // Línea base de A: techo de la fila - 5 - 12 × 0,72. Línea base de "Despues": fondo de la fila - 8 - 12 × 0,72. Diferencia = fila + 8 - 5.
  expect(Math.abs((a!.yArriba - alto.yArriba) - (filaPt + 8 - RELLENO))).toBeLessThanOrEqual(1.5);
  engine.close(doc);
});
