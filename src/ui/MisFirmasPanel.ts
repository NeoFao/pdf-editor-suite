import { mostrarModal } from './dialogo';
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
    Object.assign(panel.style, { padding: '16px', borderRadius: '8px', font: '14px sans-serif', maxWidth: '460px' });

    const titulo = document.createElement('h2');
    titulo.id = 'mis-firmas-titulo'; titulo.textContent = 'Mis firmas';
    Object.assign(titulo.style, { fontSize: '16px', margin: '0 0 8px' });

    const aviso = document.createElement('p');
    aviso.id = 'mis-firmas-privacidad'; aviso.textContent = AVISO_PRIVACIDAD;
    Object.assign(aviso.style, { margin: '0 0 8px', fontSize: '13px' });

    const bloqueo = document.createElement('p');
    bloqueo.id = 'mis-firmas-bloqueado'; bloqueo.setAttribute('role', 'status');
    bloqueo.textContent = 'Este navegador no permite guardar firmas (almacenamiento bloqueado). Puedes seguir firmando sin guardarlas.';
    bloqueo.hidden = true;

    const vacio = document.createElement('p');
    vacio.id = 'mis-firmas-vacio'; vacio.textContent = 'Aún no has guardado ninguna firma. Marca «Guardar esta firma para usarla después» al crear una.';

    const lista = document.createElement('ul');
    lista.id = 'mis-firmas-lista'; lista.setAttribute('aria-label', 'Firmas guardadas');
    Object.assign(lista.style, { listStyle: 'none', padding: '0', margin: '0 0 8px', display: 'grid', gap: '6px' });

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', gap: '8px', justifyContent: 'space-between', marginTop: '8px' });
    const btnTodas = document.createElement('button');
    btnTodas.id = 'mis-firmas-borrar-todas'; btnTodas.textContent = 'Borrar todas mis firmas';
    const btnCerrar = document.createElement('button');
    btnCerrar.id = 'mis-firmas-cerrar'; btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', () => panel.close());

    const pintar = (): void => {
      lista.replaceChildren();
      const firmas = almacen.listar();
      bloqueo.hidden = almacen.disponible();
      vacio.hidden = firmas.length > 0;
      btnTodas.disabled = firmas.length === 0;
      for (const f of firmas) {
        const li = document.createElement('li');
        Object.assign(li.style, { display: 'flex', gap: '6px', alignItems: 'center' });
        const ins = document.createElement('button');
        ins.className = 'mis-firmas-insertar';
        ins.setAttribute('aria-label', `Insertar firma «${f.nombre}»`);
        Object.assign(ins.style, { display: 'flex', gap: '8px', alignItems: 'center', flex: '1', textAlign: 'left' });
        const img = document.createElement('img');
        img.src = f.dataUrl; img.alt = '';
        Object.assign(img.style, { height: '40px', maxWidth: '160px', background: '#fff', border: '1px solid #cbd5e1' });
        const nombre = document.createElement('span');
        nombre.textContent = f.nombre;
        ins.append(img, nombre);
        ins.addEventListener('click', () => { panel.close(); onInsertar(f); });
        const del = document.createElement('button');
        del.className = 'mis-firmas-borrar';
        del.setAttribute('aria-label', `Borrar firma «${f.nombre}»`);
        del.textContent = 'Borrar';
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

    barra.append(btnTodas, btnCerrar);
    panel.append(titulo, aviso, bloqueo, vacio, lista, barra);
    pintar();
    mostrarModal(panel, { tituloId: 'mis-firmas-titulo' });
  }
}
