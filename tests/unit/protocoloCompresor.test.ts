import { test, expect, vi } from 'vitest';
import {
  crearAdaptadorEnWorker, crearEjecutor, EjecutorCerrado,
  type PeticionCompresor, type PuertoCompresor, type RespuestaCompresor
} from '../../src/image/protocoloCompresor';
import type { AdaptadorImagen } from '../../src/ui/adaptadorImagenNavegador';

/** Puerto falso: guarda lo enviado y deja al test responder (o fallar) cuando quiera. Sin Worker real. */
function puertoFalso() {
  const enviados: PeticionCompresor[] = [];
  let recibir!: (r: RespuestaCompresor) => void;
  let fallar!: (m: string) => void;
  let terminado = 0;
  const puerto: PuertoCompresor = {
    enviar: (m) => { enviados.push(m); },
    escuchar: (r, f) => { recibir = r; fallar = f; },
    terminar: () => { terminado++; }
  };
  return { puerto, enviados, responder: (r: RespuestaCompresor) => recibir(r), fallar: (m: string) => fallar(m), terminados: () => terminado };
}

function fallbackFalso(): AdaptadorImagen & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    async reescalar(_r, _w, _h, tw, th) { llamadas.push('reescalar'); return { rgba: new Uint8ClampedArray(tw * th * 4), width: tw, height: th }; },
    async codificarJpeg() { llamadas.push('jpeg'); return new Uint8Array([9, 9, 9]); }
  };
}

const PIX = new Uint8ClampedArray(2 * 2 * 4).fill(7);

test('ejecutor: asigna ids distintos y empareja cada respuesta con su petición aunque lleguen en otro orden', async () => {
  const f = puertoFalso();
  const ej = crearEjecutor(f.puerto);
  const a = ej.ejecutar({ tipo: 'jpeg', rgba: new ArrayBuffer(16), width: 2, height: 2, calidad: 0.5 }, []);
  const b = ej.ejecutar({ tipo: 'jpeg', rgba: new ArrayBuffer(16), width: 2, height: 2, calidad: 0.5 }, []);
  expect(new Set(f.enviados.map((m) => m.id)).size).toBe(2);
  f.responder({ id: f.enviados[1]!.id, ok: true, tipo: 'jpeg', bytes: new Uint8Array([2]).buffer });
  f.responder({ id: f.enviados[0]!.id, ok: true, tipo: 'jpeg', bytes: new Uint8Array([1]).buffer });
  const ra = await a, rb = await b;
  expect(ra.ok && ra.tipo === 'jpeg' && new Uint8Array(ra.bytes)[0]).toBe(1);
  expect(rb.ok && rb.tipo === 'jpeg' && new Uint8Array(rb.bytes)[0]).toBe(2);
});

test('ejecutor: una respuesta con id desconocido se ignora y cerrar() rechaza lo pendiente con EjecutorCerrado', async () => {
  const f = puertoFalso();
  const ej = crearEjecutor(f.puerto);
  const p = ej.ejecutar({ tipo: 'jpeg', rgba: new ArrayBuffer(16), width: 2, height: 2, calidad: 0.5 }, []);
  f.responder({ id: 999, ok: true, tipo: 'jpeg', bytes: new ArrayBuffer(1) }); // no debe lanzar ni resolver nada
  ej.cerrar();
  await expect(p).rejects.toBeInstanceOf(EjecutorCerrado);
  expect(f.terminados()).toBe(1);
  await expect(ej.ejecutar({ tipo: 'jpeg', rgba: new ArrayBuffer(16), width: 2, height: 2, calidad: 0.5 }, [])).rejects.toBeInstanceOf(EjecutorCerrado);
});

test('ejecutor: un error del puerto rechaza lo pendiente, y el timeout también', async () => {
  vi.useFakeTimers();
  try {
    const f = puertoFalso();
    const ej = crearEjecutor(f.puerto, 1000);
    const p1 = ej.ejecutar({ tipo: 'jpeg', rgba: new ArrayBuffer(16), width: 2, height: 2, calidad: 0.5 }, []);
    f.fallar('boom');
    await expect(p1).rejects.toThrow('boom');
    const p2 = ej.ejecutar({ tipo: 'jpeg', rgba: new ArrayBuffer(16), width: 2, height: 2, calidad: 0.5 }, []);
    const assertion = expect(p2).rejects.toThrow(/Timeout/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  } finally { vi.useRealTimers(); }
});

test('adaptador: usa el worker y copia los píxeles (los del llamador quedan intactos y no se detachan)', async () => {
  const f = puertoFalso();
  const fb = fallbackFalso();
  const alResolver = vi.fn();
  const ad = crearAdaptadorEnWorker({ crearPuerto: () => f.puerto, fallback: fb, alResolver });
  const p = ad.codificarJpeg(PIX, 2, 2, 0.6);
  await Promise.resolve();
  const req = f.enviados[0]!;
  expect(req.tipo).toBe('jpeg');
  expect(req.rgba).not.toBe(PIX.buffer);
  expect(PIX.buffer.byteLength).toBe(16);
  f.responder({ id: req.id, ok: true, tipo: 'jpeg', bytes: new Uint8Array([1, 2, 3]).buffer });
  expect([...(await p)]).toEqual([1, 2, 3]);
  expect(fb.llamadas).toEqual([]);
  expect(alResolver).toHaveBeenCalledWith('worker');
});

test('adaptador: reescalar devuelve los píxeles del worker y rechaza una respuesta de tamaño incoherente (cae al fallback)', async () => {
  const f = puertoFalso();
  const fb = fallbackFalso();
  const avisar = vi.fn();
  const ad = crearAdaptadorEnWorker({ crearPuerto: () => f.puerto, fallback: fb, avisar });
  const ok = ad.reescalar(PIX, 2, 2, 1, 1);
  await Promise.resolve();
  f.responder({ id: f.enviados[0]!.id, ok: true, tipo: 'reescalar', rgba: new Uint8Array(4).buffer, width: 1, height: 1 });
  expect((await ok).width).toBe(1);
  const mal = ad.reescalar(PIX, 2, 2, 1, 1);
  await Promise.resolve();
  f.responder({ id: f.enviados[1]!.id, ok: true, tipo: 'reescalar', rgba: new Uint8Array(3).buffer, width: 1, height: 1 });
  expect((await mal).width).toBe(1);
  expect(fb.llamadas).toEqual(['reescalar']);
  expect(avisar).toHaveBeenCalledTimes(1);
});

test('fallback: sin soporte (crearPuerto devuelve null) todo va al hilo principal, con un solo aviso', async () => {
  const fb = fallbackFalso();
  const avisar = vi.fn();
  const alResolver = vi.fn();
  const ad = crearAdaptadorEnWorker({ crearPuerto: () => null, fallback: fb, avisar, alResolver });
  expect([...(await ad.codificarJpeg(PIX, 2, 2, 0.6))]).toEqual([9, 9, 9]);
  await ad.reescalar(PIX, 2, 2, 1, 1);
  expect(fb.llamadas).toEqual(['jpeg', 'reescalar']);
  expect(avisar).toHaveBeenCalledTimes(1);
  expect(alResolver).toHaveBeenCalledWith('hilo-principal');
});

test('fallback: si crearPuerto lanza, o el worker responde error, o falla, se cae al hilo principal sin lanzar', async () => {
  const fb1 = fallbackFalso();
  const a1 = crearAdaptadorEnWorker({ crearPuerto: () => { throw new Error('CSP'); }, fallback: fb1 });
  await a1.codificarJpeg(PIX, 2, 2, 0.6);
  expect(fb1.llamadas).toEqual(['jpeg']);

  const f = puertoFalso();
  const fb2 = fallbackFalso();
  const a2 = crearAdaptadorEnWorker({ crearPuerto: () => f.puerto, fallback: fb2 });
  const p = a2.codificarJpeg(PIX, 2, 2, 0.6);
  await Promise.resolve();
  f.responder({ id: f.enviados[0]!.id, ok: false, error: 'sin memoria' });
  expect([...(await p)]).toEqual([9, 9, 9]);
  expect(f.terminados()).toBe(1); // el worker degradado se cierra
  await a2.codificarJpeg(PIX, 2, 2, 0.6); // ya degradado: ni lo intenta
  expect(f.enviados.length).toBe(1);
  expect(fb2.llamadas).toEqual(['jpeg', 'jpeg']);
});

test('cancelación: al abortar se cierra el worker y lo pendiente se rechaza SIN caer al fallback', async () => {
  const f = puertoFalso();
  const fb = fallbackFalso();
  const ctl = new AbortController();
  const ad = crearAdaptadorEnWorker({ crearPuerto: () => f.puerto, fallback: fb, signal: ctl.signal });
  const p = ad.codificarJpeg(PIX, 2, 2, 0.6);
  await Promise.resolve();
  ctl.abort();
  await expect(p).rejects.toBeInstanceOf(EjecutorCerrado);
  expect(f.terminados()).toBe(1);
  expect(fb.llamadas).toEqual([]);
  // una respuesta tardía del worker ya cerrado se ignora
  f.responder({ id: f.enviados[0]!.id, ok: true, tipo: 'jpeg', bytes: new ArrayBuffer(1) });
});

test('cerrar() libera el worker y una petición posterior crea uno nuevo (redo del comando)', async () => {
  const f = puertoFalso();
  const crear = vi.fn(() => f.puerto);
  const ad = crearAdaptadorEnWorker({ crearPuerto: crear, fallback: fallbackFalso() });
  const p = ad.codificarJpeg(PIX, 2, 2, 0.6);
  await Promise.resolve();
  f.responder({ id: f.enviados[0]!.id, ok: true, tipo: 'jpeg', bytes: new ArrayBuffer(1) });
  await p;
  ad.cerrar();
  expect(f.terminados()).toBe(1);
  void ad.codificarJpeg(PIX, 2, 2, 0.6);
  expect(crear).toHaveBeenCalledTimes(2);
});
