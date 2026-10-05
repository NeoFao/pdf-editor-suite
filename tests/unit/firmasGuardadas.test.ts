import { test, expect } from 'vitest';
import { AlmacenFirmas, CLAVE_FIRMAS, MAX_FIRMAS } from '../../src/ui/firmasGuardadas';

/** Storage falso en memoria (la interfaz mínima que usa el almacén). */
function falso(opciones: { lanzaAlEscribir?: boolean; lanzaAlLeer?: boolean } = {}): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => { if (opciones.lanzaAlLeer) throw new Error('bloqueado'); return m.get(k) ?? null; },
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { if (opciones.lanzaAlEscribir) throw new DOMException('cuota', 'QuotaExceededError'); m.set(k, v); }
  } as Storage;
}
/** Un almacén con su propio Storage (una sola instancia por almacén). */
function nuevo(o: Parameters<typeof falso>[0] = {}): AlmacenFirmas { const s = falso(o); return new AlmacenFirmas(() => s); }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('guardar y listar devuelve la firma con su nombre', () => {
  const a = nuevo();
  expect(a.guardar('Juan', PNG, 400, 150)).toEqual({ ok: true });
  const l = a.listar();
  expect(l).toHaveLength(1);
  expect(l[0]!.nombre).toBe('Juan');
  expect(l[0]!.dataUrl).toBe(PNG);
});

test('el nombre vacío recibe uno por defecto y se recorta a 40 caracteres', () => {
  const a = nuevo();
  a.guardar('   ', PNG, 1, 1);
  a.guardar('x'.repeat(100), PNG, 1, 1);
  const l = a.listar();
  expect(l[0]!.nombre).toBe('Firma 1');
  expect(l[1]!.nombre).toHaveLength(40);
});

test('el límite es de 5 firmas y la sexta se rechaza sin tocar las demás', () => {
  const a = nuevo();
  for (let i = 0; i < MAX_FIRMAS; i++) expect(a.guardar(`f${i}`, PNG, 1, 1).ok).toBe(true);
  expect(a.guardar('extra', PNG, 1, 1)).toEqual({ ok: false, motivo: 'limite' });
  expect(a.listar()).toHaveLength(5);
});

test('borrar quita solo esa firma y borrarTodas vacía el almacén', () => {
  const s = falso();
  const a = new AlmacenFirmas(() => s);
  a.guardar('a', PNG, 1, 1); a.guardar('b', PNG, 1, 1);
  const [primera] = a.listar();
  expect(a.borrar(primera!.id)).toBe(true);
  expect(a.listar().map((f) => f.nombre)).toEqual(['b']);
  expect(a.borrarTodas()).toBe(true);
  expect(a.listar()).toEqual([]);
  expect(s.getItem(CLAVE_FIRMAS)).toBeNull();
});

test('un JSON corrupto se ignora sin lanzar', () => {
  const s = falso();
  s.setItem(CLAVE_FIRMAS, '{no es json');
  expect(new AlmacenFirmas(() => s).listar()).toEqual([]);
  s.setItem(CLAVE_FIRMAS, '{"a":1}');
  expect(new AlmacenFirmas(() => s).listar()).toEqual([]);
});

test('las entradas inválidas o con dataUrl que no es PNG se descartan, las válidas se conservan', () => {
  const s = falso();
  const buena = { id: 'ok', nombre: 'Buena', dataUrl: PNG, ancho: 10, alto: 5 };
  s.setItem(CLAVE_FIRMAS, JSON.stringify([
    buena,
    { id: 'x1', nombre: 'Svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', ancho: 1, alto: 1 },
    { id: 'x2', nombre: 'Js', dataUrl: 'javascript:alert(1)', ancho: 1, alto: 1 },
    { id: 'x3', nombre: 'Html', dataUrl: 'data:image/png;base64,"><script>', ancho: 1, alto: 1 },
    { id: 'x4', nombre: 5, dataUrl: PNG, ancho: 1, alto: 1 },
    null, 'texto'
  ]));
  expect(new AlmacenFirmas(() => s).listar()).toEqual([buena]);
});

test('guardar rechaza un dataUrl que no es PNG', () => {
  const a = nuevo();
  expect(a.guardar('x', 'data:image/jpeg;base64,AAAA', 1, 1)).toEqual({ ok: false, motivo: 'invalida' });
  expect(a.listar()).toEqual([]);
});

test('setItem que lanza (cuota llena) da error controlado y no rompe', () => {
  const a = nuevo({ lanzaAlEscribir: true });
  expect(a.guardar('x', PNG, 1, 1)).toEqual({ ok: false, motivo: 'almacenamiento' });
  expect(a.listar()).toEqual([]);
});

test('almacenamiento inaccesible (getter lanza o lectura lanza): sin firmas, no disponible, sin lanzar', () => {
  const a = new AlmacenFirmas(() => { throw new DOMException('bloqueado', 'SecurityError'); });
  expect(a.disponible()).toBe(false);
  expect(a.listar()).toEqual([]);
  expect(a.guardar('x', PNG, 1, 1)).toEqual({ ok: false, motivo: 'almacenamiento' });
  expect(a.borrar('x')).toBe(false);
  expect(a.borrarTodas()).toBe(false);
  const b = nuevo({ lanzaAlLeer: true });
  expect(b.listar()).toEqual([]);
});
