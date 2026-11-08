import { mostrarModal } from './dialogo';
import { crearBoton, crearCabecera, crearCuerpo, crearPie } from './dlgPartes';
import type { AlmacenFirmas, FirmaGuardada } from './firmasGuardadas';

export const AVISO_PRIVACIDAD = 'Tus firmas se guardan solo en este navegador. Cualquiera con acceso a este equipo y navegador podría usarlas.';

/**
 * Panel modal «Mis firmas»: miniaturas de las firmas guardadas (clic -> insertar),
 * borrar cada una (con confirmación) y «Borrar todas mis firmas». Sin innerHTML:
 * las miniaturas son `<img>` con `src` (el dataURL ya se validó como PNG al leerlo).
 */
export class MisFirmasPanel {
  static open(almacen: AlmacenFirmas, onInsertar: (f: FirmaGuardada) => void, onAviso: (m: string) => void): void {
    const panel = document.createElement('dialog');
    panel.id = 'mis-firmas-panel';
    panel.classList.add('firmas-dialogo');

    const { cabecera } = crearCabecera('mis-firmas-titulo', 'Mis firmas');

    const aviso = document.createElement('p');
    aviso.id = 'mis-firmas-privacidad'; aviso.textContent = AVISO_PRIVACIDAD;
    aviso.className = 'dlg-mensaje';

    const bloqueo = document.createElement('p');
    bloqueo.id = 'mis-firmas-bloqueado'; bloqueo.setAttribute('role', 'status');
    bloqueo.className = 'dlg-aviso dlg-aviso--aviso';
    bloqueo.textContent = 'Este navegador no permite guardar firmas (almacenamiento bloqueado). Puedes seguir firmando sin guardarlas.';
    bloqueo.hidden = true;

    const vacio = document.createElement('p');
    vacio.id = 'mis-firmas-vacio'; vacio.className = 'firmas-vacio';
    vacio.textContent = 'Aún no has guardado ninguna firma. Marca «Guardar esta firma para usarla después» al crear una.';

    const lista = document.createElement('ul');
    lista.id = 'mis-firmas-lista'; lista.className = 'firmas-lista'; lista.setAttribute('aria-label', 'Firmas guardadas');

    const btnTodas = crearBoton('peligro', 'Borrar todas mis firmas', 'mis-firmas-borrar-todas');
    btnTodas.classList.add('dlg-pie-izq');
    const btnCerrar = crearBoton('primario', 'Cerrar', 'mis-firmas-cerrar');
    btnCerrar.addEventListener('click', () => panel.close());

    const pintar = (): void => {
      lista.replaceChildren();
      const firmas = almacen.listar();
      bloqueo.hidden = almacen.disponible();
      vacio.hidden = firmas.length > 0;
      btnTodas.disabled = firmas.length === 0;
      for (const f of firmas) {
        const li = document.createElement('li');
        li.className = 'firma-item';
        const ins = document.createElement('button');
        ins.type = 'button';
        ins.className = 'mis-firmas-insertar firma-item-insertar';
        ins.setAttribute('aria-label', `Insertar firma «${f.nombre}»`);
        const img = document.createElement('img');
        img.src = f.dataUrl; img.alt = '';
        img.className = 'firma-miniatura';
        const nombre = document.createElement('span');
        nombre.textContent = f.nombre;
        ins.append(img, nombre);
        ins.addEventListener('click', () => { panel.close(); onInsertar(f); });
        const del = crearBoton('peligro', 'Borrar');
        del.classList.add('mis-firmas-borrar');
        del.setAttribute('aria-label', `Borrar firma «${f.nombre}»`);
        del.addEventListener('click', () => {
          if (!window.confirm(`¿Borrar la firma «${f.nombre}»?`)) return;
          if (!almacen.borrar(f.id)) onAviso('No se pudo borrar la firma (almacenamiento bloqueado).');
          pintar();
        });
        li.append(ins, del);
        lista.appendChild(li);
      }
    };
    btnTodas.addEventListener('click', () => {
      if (!window.confirm('¿Borrar todas tus firmas guardadas en este navegador?')) return;
      if (!almacen.borrarTodas()) onAviso('No se pudieron borrar las firmas (almacenamiento bloqueado).');
      pintar();
    });

    panel.append(cabecera, crearCuerpo(aviso, bloqueo, vacio, lista), crearPie(btnTodas, btnCerrar));
    pintar();
    mostrarModal(panel, { tituloId: 'mis-firmas-titulo' });
  }
}
