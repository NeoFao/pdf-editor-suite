import { test, expect } from 'vitest';
import zlib from 'node:zlib';
import { abrirZip, DocxError } from '../../src/convert/docx/zip';
import { construirZip, construirEOCDConTotal } from './helpers/zipBuilder';

test('lee una entrada guardada sin comprimir (stored)', async () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('<a>hola</a>'), metodo: 0 }]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres()).toEqual(['word/document.xml']);
  const datos = await archivo.leer('word/document.xml');
  expect(new TextDecoder().decode(datos!)).toBe('<a>hola</a>');
});

test('lee una entrada comprimida con deflate', async () => {
  const texto = 'Contenido de prueba '.repeat(50);
  const zip = construirZip([{ nombre: 'word/styles.xml', datos: new TextEncoder().encode(texto), metodo: 8 }]);
  const archivo = abrirZip(zip);
  const datos = await archivo.leer('word/styles.xml');
  expect(new TextDecoder().decode(datos!)).toBe(texto);
});

test('lee varias entradas mezclando stored y deflate', async () => {
  const zip = construirZip([
    { nombre: 'word/document.xml', datos: new TextEncoder().encode('AAA'), metodo: 0 },
    { nombre: 'word/numbering.xml', datos: new TextEncoder().encode('BBB'.repeat(30)), metodo: 8 },
    { nombre: '[Content_Types].xml', datos: new TextEncoder().encode('CCC'), metodo: 0 }
  ]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres().sort()).toEqual(['[Content_Types].xml', 'word/document.xml', 'word/numbering.xml'].sort());
  expect(new TextDecoder().decode((await archivo.leer('word/document.xml'))!)).toBe('AAA');
  expect(new TextDecoder().decode((await archivo.leer('word/numbering.xml'))!)).toBe('BBB'.repeat(30));
});

test('leer() devuelve null para una entrada inexistente', async () => {
  const zip = construirZip([{ nombre: 'a.txt', datos: new TextEncoder().encode('x') }]);
  const archivo = abrirZip(zip);
  expect(await archivo.leer('no-existe.txt')).toBeNull();
});

test('rutas con .. se ignoran (no rompen la lectura del resto del ZIP)', async () => {
  const zip = construirZip([
    { nombre: '../../etc/passwd', datos: new TextEncoder().encode('malicioso') },
    { nombre: 'word/document.xml', datos: new TextEncoder().encode('bien') }
  ]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres()).toEqual(['word/document.xml']);
  expect(await archivo.leer('../../etc/passwd')).toBeNull();
});

test('rutas absolutas se ignoran', async () => {
  const zip = construirZip([
    { nombre: '/etc/passwd', datos: new TextEncoder().encode('malicioso') },
    { nombre: 'C:/Windows/win.ini', datos: new TextEncoder().encode('malicioso') },
    { nombre: 'word/document.xml', datos: new TextEncoder().encode('bien') }
  ]);
  const archivo = abrirZip(zip);
  expect(archivo.nombres()).toEqual(['word/document.xml']);
});

test('un fichero que no es ZIP (sin EOCD) se rechaza con DocxError', () => {
  const basura = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(() => abrirZip(basura)).toThrow(DocxError);
});

test('demasiadas entradas en el directorio central se rechaza sin recorrerlo', () => {
  const eocdFalso = construirEOCDConTotal(10_001);
  expect(() => abrirZip(eocdFalso)).toThrow(DocxError);
  expect(() => abrirZip(eocdFalso)).toThrow(/demasiadas entradas/);
});

test('una entrada con ratio de compresión absurdo (zip bomb) se rechaza sin descomprimir', () => {
  // Tamaño declarado: 500 MB descomprimidos a partir de una entrada
  // comprimida de solo 2 KB -> ratio > 100:1. El payload real ni siquiera
  // hace falta que exista para que la detección dispare (se basa en los
  // tamaños DECLARADOS del directorio central).
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: new Uint8Array(2048),
    metodo: 0,
    descomprimidoBytesFalso: 500 * 1024 * 1024
  }]);
  expect(() => abrirZip(zip)).toThrow(DocxError);
});

test('una zip bomb REAL (deflate de muchos ceros) también se rechaza', () => {
  // Payload real: 5 MB de ceros comprimen a un puñado de bytes con deflate.
  const ceros = new Uint8Array(5 * 1024 * 1024);
  const comprimido = zlib.deflateRawSync(Buffer.from(ceros));
  expect(comprimido.length).toBeLessThan(ceros.length / 100);
  const zip = construirZip([{ nombre: 'word/document.xml', datos: ceros, metodo: 8 }]);
  expect(() => abrirZip(zip)).toThrow(DocxError);
});

test('una entrada más grande que el límite por entrada se rechaza', () => {
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: new Uint8Array(1024),
    // Comprimido "grande" para no disparar el ratio, solo el límite de tamaño.
    descomprimidoBytesFalso: 300 * 1024 * 1024
  }]);
  // Con datos.length=1024 comprimidos y 300MB declarados el ratio también
  // dispara; lo relevante es que en cualquier caso se rechaza.
  expect(() => abrirZip(zip)).toThrow(DocxError);
});

test('una entrada cifrada (flag bit 0) se rechaza con mensaje claro', () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('x'), flag: 0x1 }]);
  expect(() => abrirZip(zip)).toThrow(/cifrad/);
});

test('una entrada repartida en otro disco (multidisco) se rechaza', () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('x'), discoInicio: 1 }]);
  expect(() => abrirZip(zip)).toThrow(/disco/);
});

test('un método de compresión distinto de stored/deflate se rechaza', () => {
  const zip = construirZip([{ nombre: 'word/document.xml', datos: new TextEncoder().encode('x'), metodo: 0 }]);
  // Parchea el método a un valor no soportado (12 = bzip2) en ambas cabeceras.
  const view = new DataView(zip.buffer);
  view.setUint16(8, 12, true); // cabecera local, offset del método
  // La cabecera central empieza después de local(30)+nombre('word/document.xml'.length)+datos('x'.length).
  const offsetCentral = 30 + 'word/document.xml'.length + 1;
  view.setUint16(offsetCentral + 10, 12, true);
  expect(() => abrirZip(zip)).toThrow(/método de compresión/);
});

// ---------------------------------------------------------------------------
// E-042: los tamaños DECLARADOS de un ZIP son datos del atacante. El defecto
// original (ver docs/ERRORES-CONOCIDOS.md) descomprimía la entrada ENTERA con
// `new Response(flujo).arrayBuffer()` y solo DESPUÉS comparaba el tamaño
// resultante con lo declarado — una entrada cuya cabecera mintiera con un
// tamaño descomprimido PEQUEÑO, pero cuyo deflate real produjera algo enorme,
// pasaba el filtro de ratio (que también se basa en el tamaño declarado) y
// agotaba la memoria de la pestaña DURANTE la descompresión, antes de que la
// comparación posterior pudiera rechazarla.
// ---------------------------------------------------------------------------

test('E-042: una entrada con el tamaño descomprimido declarado PEQUEÑO pero un deflate real enorme se rechaza SIN leerlo entero', async () => {
  // 8 MB de ceros comprimen a un puñado de KB; la cabecera miente con un
  // tamaño descomprimido "inocente" (1024 B) que además hace que el RATIO
  // declarado (1024 / unos pocos KB comprimidos) NO dispare la defensa de
  // zip bomb por ratio — el único momento en que se puede detectar el
  // engaño es AL LEER, no al declarar.
  const ceros = new Uint8Array(8 * 1024 * 1024);
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: ceros,
    metodo: 8,
    descomprimidoBytesFalso: 1024
  }]);
  const archivo = abrirZip(zip);

  // Espía: envuelve el DecompressionStream global para contar cuántos bytes
  // salieron REALMENTE del descompresor, sin depender de cronometrar nada
  // (AGENTS.md/E-040: nada de medir tiempo en un test unitario) — es un
  // contador estructural de bytes entregados por el propio stream.
  let bytesVistos = 0;
  const DecompressionStreamReal = globalThis.DecompressionStream;
  class DecompressionStreamEspia {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
    constructor(formato: string) {
      const real = new DecompressionStreamReal(formato as CompressionFormat);
      this.writable = real.writable;
      const contador = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { bytesVistos += chunk.byteLength; controller.enqueue(chunk); }
      });
      this.readable = real.readable.pipeThrough(contador);
    }
  }
  // @ts-expect-error -- sustitución deliberada del global solo para este test.
  globalThis.DecompressionStream = DecompressionStreamEspia;
  try {
    await expect(archivo.leer('word/document.xml')).rejects.toThrow(DocxError);
  } finally {
    globalThis.DecompressionStream = DecompressionStreamReal;
  }

  // La lectura tuvo que detenerse muy poco después de superar lo declarado
  // (1024 B) — nunca cerca de los 8 MB reales que produciría el deflate
  // completo. Margen holgado (un par de trozos del descompresor nativo).
  expect(bytesVistos).toBeLessThan(1024 + 256 * 1024);
});

test('E-042: el CRC-32 declarado que no coincide con el contenido real se rechaza', async () => {
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: new TextEncoder().encode('contenido original'),
    metodo: 0,
    crcFalso: 0xdeadbeef
  }]);
  const archivo = abrirZip(zip);
  await expect(archivo.leer('word/document.xml')).rejects.toThrow(DocxError);
  await expect(archivo.leer('word/document.xml')).rejects.toThrow(/CRC|corrupt/i);
});

test('E-042: una entrada "stored" cuyo tamaño descomprimido declarado no coincide con el comprimido se rechaza sin excepción de rango', () => {
  const zip = construirZip([{
    nombre: 'word/document.xml',
    datos: new TextEncoder().encode('doce caracteres'), // 16 bytes reales
    metodo: 0,
    descomprimidoBytesFalso: 999_999_999 // mentira: "stored" implica comprimido === descomprimido
  }]);
  // No debe lanzar un RangeError/TypeError crudo de JS: abrirZip() en sí
  // rechaza esta entrada al recorrer el directorio central, sin tocar los
  // datos ni el buffer subyacente.
  expect(() => abrirZip(zip)).toThrow(DocxError);
  expect(() => abrirZip(zip)).not.toThrow(RangeError);
});
