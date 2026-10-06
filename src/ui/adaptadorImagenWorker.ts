/**
 * Cableado al navegador del adaptador de compresión en Worker (T15, E-055): crea el Worker módulo
 * empaquetado por Vite y cae al camino del hilo principal (`adaptadorImagenNavegador`, el de T9) si el
 * navegador no tiene Worker u OffscreenCanvas o si el worker falla. La lógica está en
 * `src/image/protocoloCompresor.ts` (pura, con tests unitarios).
 */
import { crearAdaptadorEnWorker, type AdaptadorEnWorker, type PuertoCompresor } from '../image/protocoloCompresor';
import { adaptadorImagenNavegador } from './adaptadorImagenNavegador';
import { contarCompresion } from '../diagnostico';

function crearPuertoWorker(): PuertoCompresor | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  const w = new Worker(new URL('./compresorWorker.ts', import.meta.url), { type: 'module' });
  return {
    enviar: (msg, transfer) => w.postMessage(msg, transfer),
    escuchar: (alRecibir, alFallar) => {
      w.onmessage = (e) => alRecibir(e.data);
      w.onerror = (e) => alFallar(e.message || 'error de carga o ejecución');
      w.onmessageerror = () => alFallar('mensaje no deserializable');
    },
    terminar: () => w.terminate()
  };
}

/** Un adaptador por compresión: el comando lo cierra al terminar (§2.6) y `signal` lo cierra al cancelar. */
export function crearAdaptadorImagenWorker(signal?: AbortSignal): AdaptadorEnWorker {
  return crearAdaptadorEnWorker({
    crearPuerto: crearPuertoWorker,
    fallback: adaptadorImagenNavegador,
    signal,
    avisar: (m) => { if (import.meta.env.DEV) console.warn(m); },
    alResolver: contarCompresion
  });
}
