import { validarUrlEnlace } from '../engine/validarUrlEnlace';
import { mostrarModal } from './dialogo';

/**
 * Enlaces EXTERNOS (`/URI`) del PDF (E-116). Un PDF es entrada no confiable (AGENTS.md §2.2, §5): abrir un enlace saca al
 * usuario del editor, así que, como el aviso de seguridad de Acrobat, se le enseña la URL y decide. Solo se abren los esquemas
 * que acepta `validarUrlEnlace` (http, https, mailto); el resto está bloqueado y nunca ofrece "Abrir".
 *
 * Una sola URL: la cadena del PDF se analiza UNA vez con `new URL` y ese objeto sirve para validar, para mostrar y para abrir
 * (`href` normalizado, nunca la cadena original), de modo que lo que el usuario ve es lo que se abre. Se muestra el `hostname`
 * aparte y destacado (en punycode si es IDN, tal como lo da `URL`), los caracteres bidi y de control se escapan y avisan, y
 * una URL con usuario o contraseña (`user@evil.com`) no se abre. Sin datos del documento hacia fuera: solo `window.open`.
 */

export type AccionEnlace = 'abrir' | 'confirmar' | 'bloqueado';
export type MotivoBloqueo = 'esquema' | 'credenciales';
export interface DecisionEnlace {
  accion: AccionEnlace;
  /** Por qué está bloqueado (solo con `accion: 'bloqueado'`). */
  motivo?: MotivoBloqueo;
  /** `href` normalizado: lo que se muestra y lo que se abre. En un enlace bloqueado, la cadena original (solo para mostrar). */
  url: string;
  /** `url` listo para mostrar: bidi y control escapados como `\uXXXX`. */
  mostrado: string;
  /** Host (punycode si es IDN) o, en `mailto:`, el dominio de la dirección. Vacío si no hay. */
  dominio: string;
  /** La cadena original contenía caracteres bidi o de control. */
  conCaracteresOcultos: boolean;
}

/** Dominios para los que el usuario marcó "No volver a preguntar" EN ESTA SESIÓN. En memoria: sin `localStorage`. */
const dominiosOmitidos = new Set<string>();

// C0, DEL, C1 y los marcadores/aislantes bidireccionales (U+200E-200F, U+202A-202E, U+2066-2069).
const PELIGROSOS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
const PELIGROSOS_G = new RegExp(PELIGROSOS.source, 'g');

/** Sustituye cada carácter bidi o de control por su escape visible `\uXXXX`. */
export function escaparPeligrosos(s: string): string {
  return s.replace(PELIGROSOS_G, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

function dominioDeUrl(u: URL): string {
  if (u.protocol === 'mailto:') {
    let direccion = u.pathname;
    try { direccion = decodeURIComponent(direccion); } catch { /* se queda la ruta sin decodificar */ }
    direccion = direccion.split(',')[0] ?? '';
    const arroba = direccion.lastIndexOf('@');
    return arroba >= 0 ? direccion.slice(arroba + 1).trim().toLowerCase() : '';
  }
  return u.hostname.toLowerCase();
}

/** Host de una URL http(s) (punycode si es IDN), o dominio de la dirección en `mailto:`. Vacío si no hay (o la URL no es válida). */
export function dominioDe(uri: string): string {
  try { return dominioDeUrl(new URL(uri)); } catch { return ''; }
}

/** Qué hacer con un enlace externo: `bloqueado` (esquema no permitido o credenciales), `abrir` (dominio omitido) o `confirmar`. */
export function decidirEnlaceExterno(uri: string, omitidos: ReadonlySet<string> = dominiosOmitidos): DecisionEnlace {
  const conCaracteresOcultos = PELIGROSOS.test(uri);
  const bloqueado = (motivo: MotivoBloqueo): DecisionEnlace => ({ accion: 'bloqueado', motivo, url: uri, mostrado: escaparPeligrosos(uri), dominio: '', conCaracteresOcultos });
  if (validarUrlEnlace(uri) === null) return bloqueado('esquema');
  const parsed = new URL(uri); // ya validada arriba
  if (parsed.username !== '' || parsed.password !== '') return bloqueado('credenciales');
  const url = parsed.href;
  const dominio = dominioDeUrl(parsed);
  // Sin dominio no hay a qué atar el "no volver a preguntar"; con caracteres ocultos se pregunta siempre.
  const omitir = dominio !== '' && !conCaracteresOcultos && omitidos.has(dominio);
  return { accion: omitir ? 'abrir' : 'confirmar', url, mostrado: escaparPeligrosos(url), dominio, conCaracteresOcultos };
}

/** Texto de `aria-label`/`title` de la caja de un enlace externo. */
export function etiquetaEnlaceExterno(uri: string): string {
  const d = decidirEnlaceExterno(uri);
  return d.accion === 'bloqueado' ? 'Enlace bloqueado por seguridad' : `Ctrl+clic para abrir ${d.dominio || d.mostrado}`;
}

function abrirEnPestanaNueva(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Sigue un enlace externo: según la decisión lo abre directo, pregunta o avisa de que está bloqueado.
 * Todo se muestra con `textContent` (nunca HTML); lo que se abre es `d.url`, la misma URL normalizada que se ve.
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
  aviso.textContent = d.motivo === 'credenciales'
    ? 'URL sospechosa: lleva usuario o contraseña antes del dominio, un truco habitual para disfrazar la dirección real. No se abre.'
    : d.motivo === 'esquema'
      ? 'Este enlace usa un tipo de dirección que no se abre por seguridad.'
      : 'Abre solo enlaces en los que confíes. Se abrirá en una pestaña nueva.';

  const elementos: HTMLElement[] = [titulo, aviso];

  if (d.dominio !== '') {
    const host = document.createElement('div');
    host.id = 'external-link-host';
    host.style.cssText = 'font-size:18px;font-weight:bold;margin:4px 0;word-break:break-all;';
    host.textContent = d.dominio;
    elementos.push(host);
  }

  const url = document.createElement('code');
  url.id = 'external-link-url';
  url.style.cssText = 'display:block;word-break:break-all;white-space:pre-wrap;padding:8px;background:#f3f4f6;border-radius:4px;color:#111;';
  url.textContent = d.mostrado;
  elementos.push(url);

  if (d.conCaracteresOcultos) {
    const oculto = document.createElement('p');
    oculto.id = 'external-link-hidden-warning';
    oculto.style.cssText = 'margin:8px 0 0;color:#b91c1c;font-size:13px;';
    oculto.textContent = 'Atención: la dirección contiene caracteres ocultos o de control (se muestran escapados). Puede estar disfrazada.';
    elementos.push(oculto);
  }

  const barra = document.createElement('div');
  Object.assign(barra.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px', alignItems: 'center' });

  let recordar: HTMLInputElement | null = null;
  if (d.accion === 'confirmar' && d.dominio !== '' && !d.conCaracteresOcultos) {
    const etiqueta = document.createElement('label');
    etiqueta.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:10px;font-size:13px;';
    recordar = document.createElement('input');
    recordar.type = 'checkbox';
    recordar.id = 'external-link-remember';
    etiqueta.append(recordar, document.createTextNode(`No volver a preguntar para ${d.dominio}`));
    elementos.push(etiqueta);
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

  dialog.append(...elementos, barra);
  mostrarModal(dialog, { tituloId: 'external-link-title' });
  // Foco en "Cancelar": Intro/Espacio por inercia no abre un enlace sin querer.
  btnCancelar.focus();
}
