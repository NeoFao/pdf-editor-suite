/**
 * Almacén de firmas guardadas (T10). Una firma es un dato SENSIBLE: vive solo en el
 * `localStorage` de este navegador (nada sale del equipo, AGENTS.md §5) y solo se guarda
 * si el usuario lo pide con la casilla. Todo acceso al almacenamiento va en try/catch
 * (modo privado, cuota llena, almacenamiento bloqueado): si falla, la app sigue sin guardar.
 * Lo leído se valida; una entrada corrupta o con un dataURL que no sea PNG se ignora y
 * nunca se interpreta como HTML (las miniaturas se pintan con `img.src`).
 */
export const CLAVE_FIRMAS = 'pdfeditor.firmas.v1';
export const MAX_FIRMAS = 5;
/** Ancho máximo (px de imagen) al que se reescala una firma antes de guardarla. */
export const ANCHO_MAX_GUARDADO = 600;
const MAX_NOMBRE = 40;
/** Tope de longitud del dataURL (caracteres): un PNG de firma de 600 px pesa mucho menos. */
const MAX_DATAURL = 600_000;
const RE_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export interface FirmaGuardada {
  id: string;
  nombre: string;
  /** `data:image/png;base64,…` validado. */
  dataUrl: string;
  /** Tamaño de la imagen en px de imagen. */
  ancho: number;
  alto: number;
}

export type ResultadoGuardar = { ok: true } | { ok: false; motivo: 'limite' | 'invalida' | 'almacenamiento' };

export function esDataUrlPng(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_DATAURL && RE_PNG.test(v);
}

function validar(v: unknown): FirmaGuardada | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || typeof o.nombre !== 'string') return null;
  if (!esDataUrlPng(o.dataUrl)) return null;
  if (typeof o.ancho !== 'number' || typeof o.alto !== 'number' || !(o.ancho > 0) || !(o.alto > 0)) return null;
  return { id: o.id, nombre: o.nombre.slice(0, MAX_NOMBRE), dataUrl: o.dataUrl, ancho: o.ancho, alto: o.alto };
}

export class AlmacenFirmas {
  /** `obtener` devuelve el Storage; puede lanzar (acceso bloqueado). */
  constructor(private readonly obtener: () => Storage | null = () => window.localStorage) {}

  private storage(): Storage | null {
    try { return this.obtener(); } catch { return null; }
  }

  /** ¿Se puede leer? (sin efectos permanentes) */
  disponible(): boolean {
    const s = this.storage();
    if (!s) return false;
    try { s.getItem(CLAVE_FIRMAS); return true; } catch { return false; }
  }

  listar(): FirmaGuardada[] {
    const s = this.storage();
    if (!s) return [];
    try {
      const crudo = s.getItem(CLAVE_FIRMAS);
      if (!crudo) return [];
      const datos: unknown = JSON.parse(crudo);
      if (!Array.isArray(datos)) return [];
      const vistas = new Set<string>();
      const salida: FirmaGuardada[] = [];
      for (const d of datos) {
        const f = validar(d);
        if (f && !vistas.has(f.id)) { vistas.add(f.id); salida.push(f); }
      }
      return salida.slice(0, MAX_FIRMAS);
    } catch { return []; }
  }

  guardar(nombre: string, dataUrl: string, ancho: number, alto: number): ResultadoGuardar {
    if (!esDataUrlPng(dataUrl) || !(ancho > 0) || !(alto > 0)) return { ok: false, motivo: 'invalida' };
    const s = this.storage();
    if (!s) return { ok: false, motivo: 'almacenamiento' };
    const actuales = this.listar();
    if (actuales.length >= MAX_FIRMAS) return { ok: false, motivo: 'limite' };
    const limpio = nombre.trim().slice(0, MAX_NOMBRE) || `Firma ${actuales.length + 1}`;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      s.setItem(CLAVE_FIRMAS, JSON.stringify([...actuales, { id, nombre: limpio, dataUrl, ancho, alto }]));
      return { ok: true };
    } catch { return { ok: false, motivo: 'almacenamiento' }; }
  }

  borrar(id: string): boolean {
    const s = this.storage();
    if (!s) return false;
    try {
      s.setItem(CLAVE_FIRMAS, JSON.stringify(this.listar().filter((f) => f.id !== id)));
      return true;
    } catch { return false; }
  }

  borrarTodas(): boolean {
    const s = this.storage();
    if (!s) return false;
    try { s.removeItem(CLAVE_FIRMAS); return true; } catch { return false; }
  }
}

/** Texto de aviso para un fallo al guardar (lo muestra la barra de estado). */
export function mensajeFalloGuardar(motivo: 'limite' | 'invalida' | 'almacenamiento'): string {
  if (motivo === 'limite') return `Ya tienes ${MAX_FIRMAS} firmas guardadas: borra alguna en «Mis firmas» para guardar otra.`;
  if (motivo === 'invalida') return 'No se pudo guardar la firma (imagen no válida).';
  return 'No se pudo guardar la firma en este navegador (almacenamiento bloqueado o lleno).';
}
