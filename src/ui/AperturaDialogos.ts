import { mostrarModal } from './dialogo';
import { crearBoton, crearCabecera, crearCampo, crearCuerpo, crearPie } from './dlgPartes';
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
    dialog.classList.add('apertura-dialogo', 'dlg--peligro');
    const { cabecera } = crearCabecera('apertura-error-titulo', titulo);
    const p = document.createElement('p');
    p.className = 'dlg-texto';
    p.textContent = mensaje;
    const cerrar = crearBoton('primario', 'Cerrar');
    cerrar.addEventListener('click', () => dialog.close());
    dialog.append(cabecera, crearCuerpo(p), crearPie(cerrar));
    dialog.addEventListener('close', () => resolver());
    mostrarModal(dialog, { tituloId: 'apertura-error-titulo' });
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
    dialog.classList.add('apertura-dialogo');
    // El formulario envuelve cabecera, cuerpo y pie para que Intro envíe desde el campo; en CSS es `display: contents`.
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'dlg-form';
    form.addEventListener('submit', (e) => e.preventDefault());
    const { cabecera } = crearCabecera('apertura-contrasena-titulo', 'PDF protegido con contraseña');
    const desc = document.createElement('p');
    desc.className = 'dlg-texto';
    desc.textContent = `«${opciones.nombre}» está cifrado. Escribe la contraseña para abrirlo.`;
    const campo = document.createElement('input');
    campo.type = 'password';
    campo.id = 'apertura-contrasena-campo';
    campo.autocomplete = 'off';
    const campos = document.createElement('div');
    campos.className = 'campos';
    campos.appendChild(crearCampo('Contraseña', campo, 'apertura-contrasena-campo'));
    const cuerpo = crearCuerpo(desc, campos);
    if (opciones.incorrecta) {
      const aviso = document.createElement('p');
      aviso.className = 'dlg-aviso dlg-aviso--peligro';
      aviso.setAttribute('role', 'alert');
      aviso.textContent = `Contraseña incorrecta (intento ${opciones.incorrecta.intento} de ${opciones.incorrecta.maximo}).`;
      cuerpo.appendChild(aviso);
    }
    let resultado: string | null = null;
    const abrir = crearBoton('primario', 'Abrir');
    abrir.type = 'submit';
    form.addEventListener('submit', () => {
      resultado = campo.value;
      campo.value = '';
      dialog.close();
    });
    const cancelar = crearBoton('secundario', 'Cancelar');
    cancelar.addEventListener('click', () => { campo.value = ''; dialog.close(); });
    form.append(cabecera, cuerpo, crearPie(cancelar, abrir));
    dialog.appendChild(form);
    dialog.addEventListener('close', () => { campo.value = ''; resolver(resultado); });
    mostrarModal(dialog, { tituloId: 'apertura-contrasena-titulo' });
    campo.focus();
  });
}
