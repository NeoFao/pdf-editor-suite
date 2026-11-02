import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { agruparAdvertencias } from '../../src/convert/advertencia';

/**
 * E-111 con el motor REAL: `word-campos.docx` (ver `generar-fixtures.mjs`, `DOCX_CAMPOS`). Página 1: un TOC de 3 entradas con los números
 * guardados 7, 8 y 9 (a propósito) cuyos títulos caen en las páginas 1, 2 y 3; un REF, un DATE y un campo desconocido sin resultado.
 * Los valores son copia deliberada del generador (ese módulo ejecuta `main()` al importarlo).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TITULOS = ['Introduccion', 'Desarrollo', 'Conclusiones'];

async function convertir() {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-campos.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  const doc = await engine.open(pdf);
  return { engine, doc, advertencias };
}

test('word-campos.docx: el TOC muestra los números de NUESTRA paginación con puntos de relleno, y sus enlaces van a la página correcta', async () => {
  const { engine, doc } = await convertir();
  expect(engine.pageCount(doc)).toBe(3);
  const p0 = engine.getPageText(doc, 0);
  const base = (r: { matriz: number[] }) => r.matriz[5]!;
  const juntos = p0.map((r) => r.textoReal).join('\n');
  expect(juntos).not.toMatch(/[789]\s*$/m); // la caché (7, 8, 9) no se dibuja

  TITULOS.forEach((titulo, i) => {
    const t = p0.find((r) => r.textoReal.includes(titulo) && !r.textoReal.includes('Capitulo'))!;
    expect(t, titulo).toBeDefined();
    const fila = p0.filter((r) => Math.abs(base(r) - base(t)) < 1);
    const texto = fila.sort((a, b) => a.boxPt.xPt - b.boxPt.xPt).map((r) => r.textoReal).join('');
    expect(texto).toMatch(new RegExp(`^${titulo}\.{5,}${i + 1}$`)); // título, puntos de relleno, y el número de NUESTRA página
  });

  const destinos = engine.getLinks(doc, 0).map((l) => l.destino);
  expect(destinos.every((d) => d.tipo === 'pagina')).toBe(true);
  expect([...new Set(destinos.map((d) => (d.tipo === 'pagina' ? d.pageIndex : -1)))].sort()).toEqual([0, 1, 2]);
  engine.close(doc);
});

test('word-campos.docx: REF dibuja su texto guardado, DATE su caché, y el campo desconocido sin resultado no dibuja su código', async () => {
  const { engine, doc, advertencias } = await convertir();
  const juntos = engine.getPageText(doc, 0).map((r) => r.textoReal).join('\n');
  expect(juntos).toContain('Texto referenciado');
  expect(juntos).toContain('01/02/2020');
  expect(juntos).not.toMatch(/ZZCODIGO|FOOBAR|PAGEREF|TOC|\h/);

  const { omitidas, aproximadas } = agruparAdvertencias(advertencias);
  expect(aproximadas.map((a) => a.mensaje)).toHaveLength(1);
  expect(aproximadas[0]!.mensaje).toMatch(/campo.*fecha/i); // DATE: Word lo recalcularía
  expect(omitidas.map((a) => a.mensaje)).toHaveLength(1);
  expect(omitidas[0]!.mensaje).toMatch(/campo sin resultado/i); // el desconocido sin caché
  engine.close(doc);
});
