import { validarUrlEnlace } from '../engine/validarUrlEnlace';
import { mostrarModal } from './dialogo';

/**
 * Enlaces EXTERNOS (`/URI`) del PDF (E-116). Un PDF es entrada no confiable (AGENTS.md §2.2, §5): abrir un enlace saca al
 * usuario del editor, así que, como el aviso de seguridad de Acrobat, se le enseña la URL COMPLETA (como texto, nunca HTML)
 * y decide. Solo se abren los esquemas que acepta `validarUrlEnlace` (http, https, mailto); el resto está bloqueado y nunca
 * ofrece "Abrir". Sin datos del documento hacia fuera: no se hace ninguna petición desde aquí, solo `window.open` con noopener.
 */

export type AccionEnlace = 'abrir' | 'confirmar' | 'bloqueado';
export interface DecisionEnlace { accion: AccionEnlace; url: string; dominio: string }

/** Dominios para los que el usuario marcó "No volver a preguntar" EN ESTA SESIÓN. En memoria: sin `localStorage`. */
const dominiosOmitidos = new Set<string>();

/** Host de una URL http(s), o dominio de la dirección en `mailto:`. Cadena vacía si no hay (o la URL no es válida). */
export function dominioDe(uri: string): string {
  let u: URL;
  try { u = new URL(uri); } catch { return ''; }
  if (u.protocol === 'mailto:') {
    const direccion = decodeURIComponent(u.pathname).split(',')[0] ?? '';
    const arroba = direccion.lastIndexOf('@');
    return arroba >= 0 ? direccion.slice(arroba + 1).trim().toLowerCase() : '';
  }
  return u.hostname.toLowerCase();
}

/** Qué hacer con un enlace externo: `bloqueado` (esquema no permitido), `abrir` (dominio omitido en la sesión) o `confirmar`. */
export function decidirEnlaceExterno(uri: string, omitidos: ReadonlySet<string> = dominiosOmitidos): DecisionEnlace {
  const url = validarUrlEnlace(uri);
  if (url === null) return { accion: 'bloqueado', url: uri, dominio: '' };
  const dominio = dominioDe(url);
  // Sin dominio no hay a qué atar el "no volver a preguntar": se pregunta siempre.
  return { accion: dominio !== '' && omitidos.has(dominio) ? 'abrir' : 'confirmar', url, dominio };
}

/** Texto de `aria-label`/`title` de la caja de un enlace externo. */
export function etiquetaEnlaceExterno(uri: string): string {
  const d = decidirEnlaceExterno(uri);
  return d.accion === 'bloqueado' ? 'Enlace bloqueado por seguridad' : `Ctrl+clic para abrir ${d.dominio || d.url}`;
}

function abrirEnPestanaNueva(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Sigue un enlace externo: según la decisión lo abre directo, pregunta o avisa de que está bloqueado.
 * La URL se muestra con `textContent` (nunca HTML).
 */
export function seguirEnlaceExterno(uri: string): void {
  const d = decidirEnlaceExterno(uri);
  if (d.accion === 'abrir') { abrirEnPestanaNueva(d.url); return; }

  const dialog = document.createElement('dialog');
  dialog.id = 'external-link-dialog';
  Object.assign(dialog.style, { padding: '16px', borderRadius: '8px', border: '1px solid #ccc', maxWidth: '520px', width: '90vw' });

  const titulo = document.createElement('div');
  titulo.id = 'external-link-title';
  titulo.tabIndex = -1;
  titulo.style.cssText = 'font-weight:bold;margin-bottom:8px;';
  titulo.textContent = d.accion === 'bloqueado' ? 'Enlace bloqueado' : 'Este documento quiere abrir un enlace externo';

  const aviso = document.createElement('p');
  aviso.style.margin = '0 0 8px';
  aviso.textContent = d.accion === 'bloqueado'
    ? 'Este enlace usa un tipo de dirección que no se abre por seguridad.'
    : 'Abre solo enlaces en los que confíes. Se abrirá en una pestaña nueva.';

  const url = document.createElement('code');
  url.id = 'external-link-url';
  url.style.cssText = 'display:block;word-break:break-all;white-space:pre-wrap;padding:8px;background:#f3f4f6;border-radius:4px;color:#111;';
  url.textContent = uri;

  const barra = document.createElement('div');
  Object.assign(barra.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px', alignItems: 'center' });

  const dialogoElementos: HTMLElement[] = [titulo, aviso, url];
  let recordar: HTMLInputElement | null = null;
  if (d.accion === 'confirmar' && d.dominio !== '') {
    const etiqueta = document.createElement('label');
    etiqueta.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:10px;font-size:13px;';
    recordar = document.createElement('input');
    recordar.type = 'checkbox';
    recordar.id = 'external-link-remember';
    etiqueta.append(recordar, document.createTextNode(`No volver a preguntar para ${d.dominio}`));
    dialogoElementos.push(etiqueta);
  }

  const btnCancelar = document.createElement('button');
  btnCancelar.type = 'button';
  btnCancelar.id = 'btn-external-link-cancel';
  btnCancelar.textContent = d.accion === 'bloqueado' ? 'Cerrar' : 'Cancelar';
  btnCancelar.addEventListener('click', () => dialog.close());
  barra.appendChild(btnCancelar);

  if (d.accion === 'confirmar') {
    const btnAbrir = document.createElement('button');
    btnAbrir.type = 'button';
    btnAbrir.id = 'btn-external-link-open';
    btnAbrir.textContent = 'Abrir';
    btnAbrir.addEventListener('click', () => {
      if (recordar?.checked && d.dominio !== '') dominiosOmitidos.add(d.dominio);
      dialog.close();
      abrirEnPestanaNueva(d.url);
    });
    barra.appendChild(btnAbrir);
  }

  dialog.append(...dialogoElementos, barra);
  mostrarModal(dialog, { tituloId: 'external-link-title' });
  // Foco en "Cancelar": Intro/Espacio por inercia no abre un enlace sin querer.
  btnCancelar.focus();
}
