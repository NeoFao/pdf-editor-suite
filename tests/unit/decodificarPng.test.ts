import { test, expect } from 'vitest';
import zlib from 'node:zlib';
import { decodificarPng, esPng, MAX_IMG_DIM } from '../../src/convert/imagenes/decodificarPng';

/** Construye un PNG RGBA mínimo (sin dependencias), igual técnica que `tests/fixtures/generar-fixtures.mjs`. */
let tablaCrc: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!tablaCrc) {
    tablaCrc = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = tablaCrc[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo: string, datos: Buffer): Buffer {
  const t = Buffer.from(tipo, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, datos])), 0);
  return Buffer.concat([len, t, datos, crc]);
}

function pngRgba(w: number, h: number, pintar: (x: number, y: number) => [number, number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4); raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pintar(x, y);
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function pngGris(w: number, h: number, valor: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8 bits, gris
  const raw = Buffer.alloc(h * (1 + w));
  for (let y = 0; y < h; y++) { const off = y * (1 + w); raw[off] = 0; for (let x = 0; x < w; x++) raw[off + 1 + x] = valor; }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('esPng reconoce la firma y la rechaza si falta', () => {
  expect(esPng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]))).toBe(true);
  expect(esPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false); // firma JPEG
});

test('decodifica un PNG RGBA sólido de 4x3 con el color y tamaño correctos', async () => {
  const png = pngRgba(4, 3, () => [200, 50, 10, 255]);
  const img = await decodificarPng(new Uint8Array(png));
  expect(img).not.toBeNull();
  expect(img!.width).toBe(4);
  expect(img!.height).toBe(3);
  expect(img!.rgba.length).toBe(4 * 3 * 4);
  expect(Array.from(img!.rgba.slice(0, 4))).toEqual([200, 50, 10, 255]);
  expect(Array.from(img!.rgba.slice(-4))).toEqual([200, 50, 10, 255]);
});

test('decodifica un PNG en escala de grises (color type 0) replicando el valor en R/G/B y alfa opaco', async () => {
  const png = pngGris(2, 2, 128);
  const img = await decodificarPng(new Uint8Array(png));
  expect(img).not.toBeNull();
  expect(Array.from(img!.rgba.slice(0, 4))).toEqual([128, 128, 128, 255]);
});

test('un degradado (varios colores por fila, ejercita los filtros Sub/Up/Paeth) se decodifica con los píxeles esperados', async () => {
  const png = pngRgba(5, 5, (x, y) => [x * 40, y * 40, 10, 255]);
  const img = await decodificarPng(new Uint8Array(png));
  expect(img).not.toBeNull();
  // Píxel (3,2): x*40=120, y*40=80.
  const idx = (2 * 5 + 3) * 4;
  expect(Array.from(img!.rgba.slice(idx, idx + 4))).toEqual([120, 80, 10, 255]);
});

test('rechaza algo que no es un PNG (devuelve null, no lanza)', async () => {
  expect(await decodificarPng(new Uint8Array([1, 2, 3, 4]))).toBeNull();
});

test('rechaza una imagen que supera MAX_IMG_DIM en cualquier dimensión (límite de seguridad)', async () => {
  // No hace falta generar los píxeles reales: basta con una cabecera IHDR
  // que declare un ancho fuera de rango — se rechaza ANTES de inflar nada.
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(MAX_IMG_DIM + 1, 0); ihdr.writeUInt32BE(10, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
  expect(await decodificarPng(new Uint8Array(png))).toBeNull();
});
