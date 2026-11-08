import './ui/tema.css';
import './ui/estilos.css';
import './ui/dialogos.css';
import { aplicarTemaGuardado } from './ui/tema';
import { App } from './ui/App';
import { activarDiagnosticoSiCorresponde } from './diagnostico';

// Contadores de diagnóstico (E-043, docs/ERRORES-CONOCIDOS.md): apagados por
// defecto, solo se activan con `?diagnostico=1` en la URL — ver src/diagnostico.ts.
activarDiagnosticoSiCorresponde();
// E-130: el tema elegido a mano se aplica antes de construir la app (sin destello del otro tema).
aplicarTemaGuardado();

const el = document.getElementById('app');
if (el) new App(el);
