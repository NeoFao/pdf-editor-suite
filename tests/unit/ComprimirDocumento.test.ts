import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { ComprimirDocumentoCmd } from '../../src/commands/ComprimirDocumento';
import type { AdaptadorImagen } from '../../src/ui/adaptadorImagenNavegador';
import { JPEG_4X4_GRIS as JPEG_PEQUENO } from './_jpegsFijos';

// El JPEG "recodificado" son bytes fijos (./_jpegsFijos.ts): sin navegador en Vitest.

/** Reescala con vecino más cercano (determinista, sin canvas) y "codifica" siempre al mismo JPEG pequeño ya generado. */
function fakeAdaptador(jpegForzado?: Uint8Array): AdaptadorImagen {
  return {
    async reescalar(rgba, width, height, targetWidth, targetHeight) {
      const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const sx = Math.min(width - 1, Math.floor((x * width) / targetWidth));
          const sy = Math.min(height - 1, Math.floor((y * height) / targetHeight));
          const s = (sy * width + sx) * 4, d = (y * targetWidth + x) * 4;
          out[d] = rgba[s]!; out[d + 1] = rgba[s + 1]!; out[d + 2] = rgba[s + 2]!; out[d + 3] = rgba[s + 3]!;
        }
      }
      return { rgba: out, width: targetWidth, height: targetHeight };
    },
    async codificarJpeg() {
      return jpegForzado ?? JPEG_PEQUENO;
    }
  };
}

function imagenOpaca(w: number, h: number, gris: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = gris; rgba[i * 4 + 1] = gris; rgba[i * 4 + 2] = gris; rgba[i * 4 + 3] = 255; }
  return rgba;
}

/**
 * Ruido PSEUDOALEATORIO determinista (mulberry32 con semilla fija): a
 * diferencia de un color sólido o un degradado suave (ambos MUY
 * compresibles con Flate, el filtro que usa el motor al guardar), esto no
 * se comprime casi nada — necesario para que la comparación de tamaños
 * antes/después del test sea representativa de una foto o página
 * escaneada real, no un caso degenerado que ya pesa casi nada de por sí.
 */
function imagenRuidosa(w: number, h: number): Uint8Array {
  let seed = 0x2f6e2b1;
  const siguiente = (): number => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.floor(siguiente() * 256);
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function imagenConAlfaVariable(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 100; rgba[i * 4 + 1] = 100; rgba[i * 4 + 2] = 100;
    rgba[i * 4 + 3] = i % 2 === 0 ? 255 : 60; // alfa variable: mitad opaca, mitad semitransparente
  }
  return rgba;
}

test('ComprimirDocumentoCmd reescala y recodifica una imagen opaca que excede el dpi máximo, y se puede deshacer', async () => {
  const d = await PDFDocument.create();
  d.addPage([72, 72]); // 1x1 pulgada de página
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);

  // 300x300 px en una página de 1x1 in = 300 dpi.
  engine.insertImage(s.doc, 0, { rgba: imagenRuidosa(300, 300), imgWidth: 300, imgHeight: 300, xPt: 0, yPt: 0, wPt: 72, hPt: 72 });
  const antesBytesDoc = engine.save(s.doc).length;

  const cmd = new ComprimirDocumentoCmd({ calidad: 0.5, dpiMax: 150 }, fakeAdaptador());
  await bus.execute(cmd);

  expect(cmd.informe.imagenes).toBe(1);
  expect(cmd.informe.antesBytes).toBe(antesBytesDoc);
  expect(cmd.informe.despuesBytes).toBeLessThan(cmd.informe.antesBytes);

  const img = engine.listImageObjects(s.doc, 0)[0]!;
  const pix = engine.getImagePixels(s.doc, 0, img.objIndex)!;
  expect(pix.width).toBeLessThanOrEqual(150); // 300px a 150dpi máx en 1in → 150px

  await bus.undo();
  const imgTrasDeshacer = engine.getImagePixels(s.doc, 0, engine.listImageObjects(s.doc, 0)[0]!.objIndex)!;
  expect(imgTrasDeshacer.width).toBe(300);
});

test('ComprimirDocumentoCmd NO pasa a JPEG una imagen con transparencia real (SMask): solo la reescala como bitmap', async () => {
  const d = await PDFDocument.create();
  d.addPage([72, 72]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);

  engine.insertImage(s.doc, 0, { rgba: imagenConAlfaVariable(300, 300), imgWidth: 300, imgHeight: 300, xPt: 0, yPt: 0, wPt: 72, hPt: 72 });

  const cmd = new ComprimirDocumentoCmd({ calidad: 0.5, dpiMax: 150 }, fakeAdaptador());
  await bus.execute(cmd);

  const img = engine.listImageObjects(s.doc, 0)[0]!;
  const pix = engine.getImagePixels(s.doc, 0, img.objIndex)!;
  // Si se hubiera pasado a JPEG, el alfa se habría perdido (todo 255). Como
  // solo se reescaló como bitmap, sigue habiendo píxeles no totalmente opacos.
  const algunoNoOpaco = Array.from({ length: pix.width * pix.height }, (_, i) => pix.rgba[i * 4 + 3]!).some((a) => a < 255);
  expect(algunoNoOpaco).toBe(true);
});

test('ComprimirDocumentoCmd conserva la imagen original si el JPEG recodificado saldría más pesado', async () => {
  const d = await PDFDocument.create();
  d.addPage([144, 144]); // 2x2 pulgadas
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);

  // 100x100px en 2in = 50dpi: por debajo de dpiMax, no hace falta reescalar.
  engine.insertImage(s.doc, 0, { rgba: imagenOpaca(100, 100, 200), imgWidth: 100, imgHeight: 100, xPt: 0, yPt: 0, wPt: 144, hPt: 144 });
  const antes = engine.getImagePixels(s.doc, 0, engine.listImageObjects(s.doc, 0)[0]!.objIndex)!;

  // JPEG "recodificado" deliberadamente enorme (más pesado que el original).
  const jpegEnorme = new Uint8Array(10_000_000);
  const cmd = new ComprimirDocumentoCmd({ calidad: 0.5, dpiMax: 150 }, fakeAdaptador(jpegEnorme));
  await bus.execute(cmd);

  expect(cmd.informe.imagenes).toBe(0); // no se tocó: ni reescalado (no hacía falta) ni JPEG (salía más pesado)
  const despues = engine.getImagePixels(s.doc, 0, engine.listImageObjects(s.doc, 0)[0]!.objIndex)!;
  expect(despues.rgba).toEqual(antes.rgba);
});
