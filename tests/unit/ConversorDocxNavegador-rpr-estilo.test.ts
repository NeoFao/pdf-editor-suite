import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-104 con el motor REAL: `word-rpr-estilo.docx` (ver `generar-fixtures.mjs`). Tres textos en una tabla y los mismos tres en el
 * cuerpo (sufijo "C"): (1) estilo de párrafo "Negro" (negrita, 20 pt, basedOn "Base" 12 pt), (2) `rStyle` "Enfasis" (cursiva,
 * 16 pt), (3) estilo "Negro" con `w:b w:val="0"` directo (sin negrita, 20 pt). Se lee la fuente y el tamaño EFECTIVO (pt de
 * página) de cada objeto de texto del PDF.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const T = { negro: 'EstiloNegro', enfasis: 'RunEnfasis', toggle: 'Conmuta' };

test('word-rpr-estilo.docx (E-104): en celda y en cuerpo, el PDF usa la fuente y el tamaño que dicen los estilos', async () => {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-rpr-estilo.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  expect(textosAdvertencias(advertencias)).toEqual([]);
  const doc = await engine.open(pdf);
  const runs = engine.getPageText(doc, 0);
  const de = (texto: string) => {
    const r = runs.find((x) => x.text.replace(/\s/g, '') === texto);
    expect(r, `objeto de texto "${texto}"`).toBeDefined();
    return r!;
  };
  for (const sufijo of ['', 'C']) { // '' = dentro de la celda; 'C' = en el cuerpo
    const negro = de(T.negro + sufijo), enfasis = de(T.enfasis + sufijo), toggle = de(T.toggle + sufijo);
    expect(negro.fontName, `negro${sufijo}`).toMatch(/Bold/i);
    expect(negro.sizeEfectivoPt).toBeCloseTo(20, 1);
    expect(enfasis.fontName, `enfasis${sufijo}`).toMatch(/Oblique|Italic/i);
    expect(enfasis.sizeEfectivoPt).toBeCloseTo(16, 1);
    expect(toggle.fontName, `toggle${sufijo}`).not.toMatch(/Bold/i);
    expect(toggle.sizeEfectivoPt).toBeCloseTo(20, 1);
  }
  engine.close(doc);
});
