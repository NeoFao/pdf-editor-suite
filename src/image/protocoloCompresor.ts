/**
 * Protocolo de mensajes entre el hilo principal y el worker de compresión de imagen (T15, E-055)
 * y la lógica de ejecución/fallback — todo PURO (sin Worker, sin DOM): se prueba en Node inyectando
 * un "puerto" falso. El worker real vive en `src/ui/compresorWorker.ts`; el cableado al navegador, en
 * `src/ui/adaptadorImagenWorker.ts`.
 *
 * Unidades: todas las dimensiones son px de bitmap (no px CSS ni puntos PDF); `calidad` es 0-1.
 * El worker solo recibe píxeles RGBA y devuelve bytes: PDFium sigue en el hilo principal.
 */
import type { AdaptadorImagen } from '../ui/adaptadorImagenNavegador';

export type PeticionCompresor =
  | { id: number; tipo: 'reescalar'; rgba: ArrayBuffer; width: number; height: number; targetWidth: number; targetHeight: number }
  | { id: number; tipo: 'jpeg'; rgba: ArrayBuffer; width: number; height: number; calidad: number };

export type RespuestaCompresor =
  | { id: number; ok: true; tipo: 'reescalar'; rgba: ArrayBuffer; width: number; height: number }
  | { id: number; ok: true; tipo: 'jpeg'; bytes: ArrayBuffer }
  | { id: number; ok: false; error: string };

/** Petición sin id: el ejecutor lo asigna. */
export type PeticionSinId =
  | Omit<Extract<PeticionCompresor, { tipo: 'reescalar' }>, 'id'>
  | Omit<Extract<PeticionCompresor, { tipo: 'jpeg' }>, 'id'>;

/** Lo mínimo que se necesita de un Worker; el real y el falso de los tests lo cumplen. */
export interface PuertoCompresor {
  enviar(msg: PeticionCompresor, transfer: Transferable[]): void;
  /** Registra los receptores de respuesta y de fallo del puerto (error de carga/ejecución del worker). */
  escuchar(alRecibir: (r: RespuestaCompresor) => void, alFallar: (motivo: string) => void): void;
  terminar(): void;
}

/** Cierre deliberado (cancelar / fin de compresión): NO activa el fallback. */
export class EjecutorCerrado extends Error {
  constructor() { super('Worker de compresión cerrado'); this.name = 'EjecutorCerrado'; }
}

export interface Ejecutor {
  ejecutar(req: PeticionSinId, transfer: Transferable[]): Promise<RespuestaCompresor>;
  cerrar(): void;
}

/** Asigna ids, empareja respuestas, aplica un timeout por petición y rechaza todo lo pendiente al cerrar/fallar. */
export function crearEjecutor(puerto: PuertoCompresor, timeoutMs = 60_000): Ejecutor {
  let siguiente = 1;
  let cerrado = false;
  const pendientes = new Map<number, { ok: (r: RespuestaCompresor) => void; ko: (e: Error) => void; reloj: ReturnType<typeof setTimeout> }>();

  const rechazarTodo = (e: Error): void => {
    for (const p of pendientes.values()) { clearTimeout(p.reloj); p.ko(e); }
    pendientes.clear();
  };

  puerto.escuchar(
    (r) => {
      const p = pendientes.get(r.id);
      if (!p) return; // respuesta tardía de una petición ya descartada: se ignora
      pendientes.delete(r.id);
      clearTimeout(p.reloj);
      p.ok(r);
    },
    (motivo) => rechazarTodo(new Error(`Fallo del worker: ${motivo}`))
  );

  return {
    ejecutar(req, transfer) {
      if (cerrado) return Promise.reject(new EjecutorCerrado());
      const id = siguiente++;
      return new Promise<RespuestaCompresor>((ok, ko) => {
        const reloj = setTimeout(() => { pendientes.delete(id); ko(new Error(`Timeout de ${timeoutMs} ms esperando al worker`)); }, timeoutMs);
        pendientes.set(id, { ok, ko, reloj });
        try { puerto.enviar({ ...req, id } as PeticionCompresor, transfer); }
        catch (e) { pendientes.delete(id); clearTimeout(reloj); ko(e instanceof Error ? e : new Error(String(e))); }
      });
    },
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      puerto.terminar();
      rechazarTodo(new EjecutorCerrado());
    }
  };
}

export interface OpcionesAdaptadorWorker {
  /** Crea el puerto (Worker real); `null` si el entorno no puede (sin Worker/OffscreenCanvas). Puede lanzar. */
  crearPuerto: () => PuertoCompresor | null;
  /** Camino del hilo principal (el de T9), al que se cae si el worker no está o falla. */
  fallback: AdaptadorImagen;
  /** Al abortarse, se cierra el worker y lo pendiente se rechaza SIN caer al fallback. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Aviso de desarrollo cuando se degrada al hilo principal (nunca un fallo visible para el usuario). */
  avisar?: (mensaje: string) => void;
  /** Para diagnóstico/tests: por qué camino se resolvió cada operación. */
  alResolver?: (camino: 'worker' | 'hilo-principal') => void;
}

export type AdaptadorEnWorker = AdaptadorImagen & { cerrar(): void };

function copiar(rgba: Uint8ClampedArray): ArrayBuffer {
  const out = new ArrayBuffer(rgba.byteLength);
  new Uint8ClampedArray(out).set(rgba);
  return out;
}

/**
 * Adaptador que manda reescalado y codificación JPEG al worker. Copia los píxeles antes de transferirlos
 * (los necesita intactos el fallback y, tras `reescalar`, el comando) — una copia de memoria es barata
 * frente a decodificar/codificar. El worker se crea en la primera petición y se vuelve a crear tras `cerrar()`.
 */
export function crearAdaptadorEnWorker(o: OpcionesAdaptadorWorker): AdaptadorEnWorker {
  let ejecutor: Ejecutor | null = null;
  let degradado = false;

  const cerrar = (): void => { ejecutor?.cerrar(); ejecutor = null; };
  o.signal?.addEventListener('abort', cerrar, { once: true });

  const degradar = (motivo: string): void => {
    degradado = true;
    cerrar();
    o.avisar?.(`Compresión en el hilo principal (sin worker): ${motivo}`);
  };

  async function intentar<T>(enWorker: (e: Ejecutor) => Promise<T>, enFallback: () => Promise<T>): Promise<T> {
    if (!degradado && !ejecutor) {
      try {
        const puerto = o.crearPuerto();
        if (puerto) ejecutor = crearEjecutor(puerto, o.timeoutMs);
        else degradar('el navegador no ofrece Worker/OffscreenCanvas');
      } catch (e) { degradar(e instanceof Error ? e.message : String(e)); }
    }
    if (!degradado && ejecutor) {
      try {
        const r = await enWorker(ejecutor);
        o.alResolver?.('worker');
        return r;
      } catch (e) {
        // Cancelación o cierre deliberado: se propaga, no se "rescata" en el hilo principal.
        if (o.signal?.aborted || e instanceof EjecutorCerrado) throw e;
        degradar(e instanceof Error ? e.message : String(e));
      }
    }
    const r = await enFallback();
    o.alResolver?.('hilo-principal');
    return r;
  }

  return {
    cerrar,
    reescalar(rgba, width, height, targetWidth, targetHeight) {
      return intentar(
        async (e) => {
          const copia = copiar(rgba);
          const r = await e.ejecutar({ tipo: 'reescalar', rgba: copia, width, height, targetWidth, targetHeight }, [copia]);
          if (!r.ok || r.tipo !== 'reescalar') throw new Error(r.ok ? 'respuesta inesperada' : r.error);
          if (r.rgba.byteLength !== r.width * r.height * 4) throw new Error('respuesta de reescalado con tamaño incoherente');
          return { rgba: new Uint8ClampedArray(r.rgba), width: r.width, height: r.height };
        },
        () => o.fallback.reescalar(rgba, width, height, targetWidth, targetHeight)
      );
    },
    codificarJpeg(rgba, width, height, calidad) {
      return intentar(
        async (e) => {
          const copia = copiar(rgba);
          const r = await e.ejecutar({ tipo: 'jpeg', rgba: copia, width, height, calidad }, [copia]);
          if (!r.ok || r.tipo !== 'jpeg') throw new Error(r.ok ? 'respuesta inesperada' : r.error);
          return new Uint8Array(r.bytes);
        },
        () => o.fallback.codificarJpeg(rgba, width, height, calidad)
      );
    }
  };
}
