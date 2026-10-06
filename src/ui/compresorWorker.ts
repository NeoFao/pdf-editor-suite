/**
 * Worker de compresión de imagen (T15, E-055). Empaquetado por Vite como módulo y servido desde el
 * mismo origen (CSP: worker-src 'self' blob:, script-src 'self' — no hace falta tocarla).
 * Recibe píxeles RGBA (transferidos), reescala o codifica JPEG con `OffscreenCanvas` y devuelve el
 * resultado transferido. PDFium NO está aquí: sigue en el hilo principal.
 * Protocolo y tipos: `src/image/protocoloCompresor.ts`. Unidades: px de bitmap.
 */
import type { PeticionCompresor, RespuestaCompresor } from '../image/protocoloCompresor';

interface ContextoWorker {
  onmessage: ((e: MessageEvent<PeticionCompresor>) => void) | null;
  postMessage(msg: RespuestaCompresor, transfer: Transferable[]): void;
}
const ctx = self as unknown as ContextoWorker;

function lienzoCon(rgba: ArrayBuffer, width: number, height: number): OffscreenCanvas {
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return c;
}

async function procesar(req: PeticionCompresor): Promise<RespuestaCompresor> {
  if (req.tipo === 'reescalar') {
    const dst = new OffscreenCanvas(req.targetWidth, req.targetHeight);
    const dctx = dst.getContext('2d')!;
    dctx.drawImage(lienzoCon(req.rgba, req.width, req.height), 0, 0, req.targetWidth, req.targetHeight);
    const { data } = dctx.getImageData(0, 0, req.targetWidth, req.targetHeight);
    return { id: req.id, ok: true, tipo: 'reescalar', rgba: data.buffer as ArrayBuffer, width: req.targetWidth, height: req.targetHeight };
  }
  const blob = await lienzoCon(req.rgba, req.width, req.height).convertToBlob({ type: 'image/jpeg', quality: req.calidad });
  return { id: req.id, ok: true, tipo: 'jpeg', bytes: await blob.arrayBuffer() };
}

ctx.onmessage = (e) => {
  const req = e.data;
  procesar(req).then(
    (r) => ctx.postMessage(r, r.ok ? [r.tipo === 'jpeg' ? r.bytes : r.rgba] : []),
    (err: unknown) => ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, [])
  );
};
