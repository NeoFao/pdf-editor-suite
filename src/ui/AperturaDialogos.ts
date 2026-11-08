import { mostrarModal } from './dialogo';
import { PdfError } from '../engine/errores';

/**
 * Diálogos de la apertura de documentos (E-125). Todo el contenido se construye con `textContent` (§2.2);
 * la contraseña vive solo en el valor del `<input>` y en la variable que devuelve la promesa: no se registra,
 * no se guarda y quien la recibe la descarta tras abrir.
 */

export const MAX_INTENTOS_CONTRASENA = 3;

/** Texto claro para el usuario según el código de error tipado del motor. */
export function mensajeDeError(err: unknown): string {
  if (err instanceof PdfError) {
    switch (err.codigo) {
      case 'FORMAT':
      case 'FILE':
        return 'El archivo no es un PDF válido o está dañado.';
      case 'PASSWORD':
        return 'Este PDF está protegido con contraseña y no se pudo abrir con la indicada.';
      case 'SECURITY':
        return 'Este PDF está protegido con un cifrado que no se admite.';
      case 'PAGE':
        return 'El PDF está dañado: no se pudieron cargar sus páginas.';
      default:
        return 'No se pudo abrir el PDF.';
    }
  }
  return 'No se pudo abrir el archivo.';
}

/** Aviso modal con un único botón «Cerrar». Resuelve al cerrarse. */
export function mostrarErrorApertura(titulo: string, mensaje: string): Promise<void> {
  return new Promise<void>((resolver) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'apertura-error';
    Object.assign(dialog.style, { width: 'min(28rem, 92vw)', boxSizing: 'border-box' });
    const h = document.createElement('h2');
    h.id = 'apertura-error-titulo';
    h.textContent = titulo;
    Object.assign(h.style, { fontSize: '1.1rem', margin: '0 0 8px' });
    const p = document.createElement('p');
    p.textContent = mensaje;
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.textContent = 'Cerrar';
    cerrar.addEventListener('click', () => dialog.close());
    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', justifyContent: 'flex-end', marginTop: '10px' });
    barra.appendChild(cerrar);
    dialog.append(h, p, barra);
    dialog.addEventListener('close', () => resolver());
    mostrarModal(dialog, { tituloId: h.id });
    cerrar.focus();
  });
}

/**
 * Pide la contraseña de un PDF cifrado. Resuelve con el texto escrito, o `null` si se cancela (botón o Escape).
 * `incorrecta` muestra el aviso «Contraseña incorrecta» (con el número de intento) dentro del propio diálogo.
 */
export function pedirContrasena(opciones: { nombre: string; incorrecta?: { intento: number; maximo: number } }): Promise<string | null> {
  return new Promise<string | null>((resolver) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'apertura-contrasena';
    Object.assign(dialog.style, { width: 'min(28rem, 92vw)', boxSizing: 'border-box' });
    const form = document.createElement('form');
    form.method = 'dialog';
    form.addEventListener('submit', (e) => e.preventDefault());
    const h = document.createElement('h2');
    h.id = 'apertura-contrasena-titulo';
    h.textContent = 'PDF protegido con contraseña';
    Object.assign(h.style, { fontSize: '1.1rem', margin: '0 0 8px' });
    const desc = document.createElement('p');
    desc.textContent = `«${opciones.nombre}» está cifrado. Escribe la contraseña para abrirlo.`;
    const etiqueta = document.createElement('label');
    etiqueta.textContent = 'Contraseña';
    etiqueta.htmlFor = 'apertura-contrasena-campo';
    Object.assign(etiqueta.style, { display: 'block', marginBottom: '4px' });
    const campo = document.createElement('input');
    campo.type = 'password';
    campo.id = 'apertura-contrasena-campo';
    campo.autocomplete = 'off';
    Object.assign(campo.style, { width: '100%', boxSizing: 'border-box' });
    form.append(h, desc, etiqueta, campo);
    if (opciones.incorrecta) {
      const aviso = document.createElement('p');
      aviso.setAttribute('role', 'alert');
      aviso.textContent = `Contraseña incorrecta (intento ${opciones.incorrecta.intento} de ${opciones.incorrecta.maximo}).`;
      Object.assign(aviso.style, { color: 'var(--ed-danger)', margin: '8px 0 0' });
      form.appendChild(aviso);
    }
    let resultado: string | null = null;
    const abrir = document.createElement('button');
    abrir.type = 'submit';
    abrir.textContent = 'Abrir';
    form.addEventListener('submit', () => {
      resultado = campo.value;
      campo.value = '';
      dialog.close();
    });
    const cancelar = document.createElement('button');
    cancelar.type = 'button';
    cancelar.textContent = 'Cancelar';
    cancelar.addEventListener('click', () => { campo.value = ''; dialog.close(); });
    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' });
    barra.append(cancelar, abrir);
    form.appendChild(barra);
    dialog.appendChild(form);
    dialog.addEventListener('close', () => { campo.value = ''; resolver(resultado); });
    mostrarModal(dialog, { tituloId: h.id });
    campo.focus();
  });
}
