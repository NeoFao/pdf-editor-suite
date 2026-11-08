import { validarUrlEnlace } from '../engine/validarUrlEnlace';
import { mostrarModal } from './dialogo';
import { crearBoton, crearCabecera, crearCuerpo, crearPie } from './dlgPartes';

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
export type MotivoBloqueo = 'esquema' | 'credenciales' | 'direccion';
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

/** Resultado de analizar un `mailto:`: todo se lee de la forma DECODIFICADA, que es la que se muestra. */
interface AnalisisMailto {
  /** `href` decodificado (direcciones, `?cc=`, `?bcc=`, `?body=`...): se muestra entero, nunca se oculta nada. */
  decodificado: string;
  /** Dominios de TODAS las direcciones del destinatario, en punycode si son IDN, sin repetir. */
  dominios: string[];
  /** Todas las direcciones tienen un dominio que es un hostname válido y sin caracteres peligrosos tras decodificar. */
  valido: boolean;
  /** Hay más de una dirección o parámetros (`?cc=`...): nunca se omite la pregunta. */
  complejo: boolean;
}

function analizarMailto(u: URL): AnalisisMailto {
  let decodificado = u.href, ruta = u.pathname, decodificable = true;
  try { decodificado = decodeURIComponent(u.href); ruta = decodeURIComponent(u.pathname); } catch { decodificable = false; }
  const direcciones = ruta.split(',').map((d) => d.trim()).filter((d) => d !== '');
  const dominios: string[] = [];
  let valido = decodificable && direcciones.length > 0;
  for (const d of direcciones) {
    const arroba = d.lastIndexOf('@');
    const crudo = arroba >= 0 ? d.slice(arroba + 1) : '';
    let host = '';
    // Un hostname no lleva espacios, separadores de URL ni caracteres bidi/control: si los trae, el dominio no es válido.
    if (crudo !== '' && !PELIGROSOS.test(crudo) && !/[\s/?#@:\\%]/.test(crudo)) {
      try { host = new URL(`http://${crudo}`).hostname; } catch { host = ''; }
    }
    if (host === '' || PELIGROSOS.test(host)) { valido = false; continue; }
    if (!dominios.includes(host)) dominios.push(host);
  }
  return { decodificado, dominios, valido, complejo: direcciones.length > 1 || u.search !== '' };
}

function dominioDeUrl(u: URL): string {
  return u.protocol === 'mailto:' ? analizarMailto(u).dominios.join(', ') : u.hostname.toLowerCase();
}

/** Host de una URL http(s) (punycode si es IDN), o dominio de la dirección en `mailto:`. Vacío si no hay (o la URL no es válida). */
export function dominioDe(uri: string): string {
  try { return dominioDeUrl(new URL(uri)); } catch { return ''; }
}

/** Qué hacer con un enlace externo: `bloqueado` (esquema no permitido o credenciales), `abrir` (dominio omitido) o `confirmar`. */
export function decidirEnlaceExterno(uri: string, omitidos: ReadonlySet<string> = dominiosOmitidos): DecisionEnlace {
  let conCaracteresOcultos = PELIGROSOS.test(uri);
  const bloqueado = (motivo: MotivoBloqueo, mostrado = uri): DecisionEnlace => ({ accion: 'bloqueado', motivo, url: uri, mostrado: escaparPeligrosos(mostrado), dominio: '', conCaracteresOcultos });
  if (validarUrlEnlace(uri) === null) return bloqueado('esquema');
  const parsed = new URL(uri); // ya validada arriba
  if (parsed.username !== '' || parsed.password !== '') return bloqueado('credenciales');
  const url = parsed.href;
  let mostrado = url;
  let omitible = true;
  if (parsed.protocol === 'mailto:') {
    // Se muestra la forma decodificada (la que lee el usuario) y los peligrosos se buscan en ella: `%E2%80%AE` no pasa inadvertido.
    const m = analizarMailto(parsed);
    mostrado = m.decodificado;
    conCaracteresOcultos = conCaracteresOcultos || PELIGROSOS.test(m.decodificado);
    if (!m.valido) return bloqueado('direccion', m.decodificado);
    omitible = !m.complejo;
  }
  const dominio = escaparPeligrosos(dominioDeUrl(parsed));
  // Sin dominio no hay a qué atar el "no volver a preguntar"; con caracteres ocultos o un mailto complejo se pregunta siempre.
  const omitir = dominio !== '' && omitible && !conCaracteresOcultos && omitidos.has(dominio);
  return { accion: omitir ? 'abrir' : 'confirmar', url, mostrado: escaparPeligrosos(mostrado), dominio, conCaracteresOcultos };
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
  dialog.classList.add('enlace-dialogo');
  if (d.accion === 'bloqueado') dialog.classList.add('dlg--peligro');

  const { cabecera, titulo } = crearCabecera('external-link-title', d.accion === 'bloqueado' ? 'Enlace bloqueado' : 'Este documento quiere abrir un enlace externo');
  titulo.tabIndex = -1;

  const aviso = document.createElement('p');
  aviso.className = 'dlg-texto';
  aviso.textContent = d.motivo === 'credenciales'
    ? 'URL sospechosa: lleva usuario o contraseña antes del dominio, un truco habitual para disfrazar la dirección real. No se abre.'
    : d.motivo === 'direccion'
      ? 'Dirección de correo sospechosa: su dominio no es válido o contiene caracteres ocultos o de control. No se abre.'
      : d.motivo === 'esquema'
      ? 'Este enlace usa un tipo de dirección que no se abre por seguridad.'
      : 'Abre solo enlaces en los que confíes. Se abrirá en una pestaña nueva.';

  const elementos: HTMLElement[] = [aviso];

  if (d.dominio !== '') {
    const host = document.createElement('div');
    host.id = 'external-link-host';
    host.className = 'enlace-host';
    host.textContent = d.dominio;
    elementos.push(host);
  }

  const url = document.createElement('code');
  url.id = 'external-link-url';
  url.className = 'codigo enlace-url';
  url.textContent = d.mostrado;
  elementos.push(url);

  if (d.conCaracteresOcultos) {
    const oculto = document.createElement('p');
    oculto.id = 'external-link-hidden-warning';
    oculto.className = 'dlg-aviso dlg-aviso--peligro';
    oculto.setAttribute('role', 'alert');
    oculto.textContent = 'Atención: la dirección contiene caracteres ocultos o de control (se muestran escapados). Puede estar disfrazada.';
    elementos.push(oculto);
  }

  let recordar: HTMLInputElement | null = null;
  if (d.accion === 'confirmar' && d.dominio !== '' && !d.conCaracteresOcultos) {
    const etiqueta = document.createElement('label');
    etiqueta.className = 'casilla';
    recordar = document.createElement('input');
    recordar.type = 'checkbox';
    recordar.id = 'external-link-remember';
    etiqueta.append(recordar, document.createTextNode(`No volver a preguntar para ${d.dominio}`));
    elementos.push(etiqueta);
  }

  const btnCancelar = crearBoton(d.accion === 'bloqueado' ? 'primario' : 'secundario', d.accion === 'bloqueado' ? 'Cerrar' : 'Cancelar', 'btn-external-link-cancel');
  btnCancelar.addEventListener('click', () => dialog.close());
  const pie = crearPie(btnCancelar);

  if (d.accion === 'confirmar') {
    const btnAbrir = crearBoton('primario', 'Abrir', 'btn-external-link-open');
    btnAbrir.addEventListener('click', () => {
      if (recordar?.checked && d.dominio !== '') dominiosOmitidos.add(d.dominio);
      dialog.close();
      abrirEnPestanaNueva(d.url);
    });
    pie.appendChild(btnAbrir);
  }

  dialog.append(cabecera, crearCuerpo(...elementos), pie);
  mostrarModal(dialog, { tituloId: 'external-link-title' });
  // Foco en "Cancelar": Intro/Espacio por inercia no abre un enlace sin querer.
  btnCancelar.focus();
}
