# Protección de rama

Las reglas de `AGENTS.md` solo son obligatorias si GitHub las hace obligatorias.
Sin esta configuración, cualquier asistente puede abrir un PR con el CI en rojo
y mergearlo igualmente.

## Configurar `main` (una vez)

Settings → Branches → Add branch protection rule, para `main`:

- [x] **Require a pull request before merging**
  - [x] Require approvals: **1**
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Check obligatorio: **`CI completo`**
    (job `ci-ok`, que agrega los cinco del workflow; añadir un job nuevo no
    obliga a volver a tocar esta pantalla)
- [x] **Require conversation resolution before merging**
- [x] **Do not allow bypassing the above settings** ← imprescindible.
      Sin esto, un administrador —o un agente que actúe con sus credenciales—
      puede saltárselo todo.
- [ ] Allow force pushes — **desactivado**
- [ ] Allow deletions — **desactivado**

Con la CLI:

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  --input .github/branch-protection.json
```

## Hooks locales

Los hooks son la primera línea, no la última: dan el aviso en segundos en vez de
esperar al PR. Se instalan solos con `npm install`; si no:

```bash
npm run hooks:install
```

| Hook | Qué bloquea |
|---|---|
| `pre-commit` | commits en `main`, espejos de IA desincronizados, reglas deterministas, tests de las reglas |
| `commit-msg` | asuntos que no siguen conventional commits |
| `pre-push` | push a `main`, reglas deterministas |

Se pueden omitir con `PDFEDITOR_SKIP_HOOKS=1`, **y no sirve de nada**: CI vuelve
a ejecutar exactamente lo mismo y es bloqueante. El escape existe para casos
puntuales (un `git commit --amend` de un mensaje), no para esquivar el sistema.

## Qué NO se toca sin acuerdo del equipo

- Convertir un check obligatorio en opcional.
- Activar «Allow bypassing».
- Bajar el número de aprobaciones a 0.
- Desactivar o comentar un job del workflow.
- Añadir entradas a `scripts/guards/deuda-tecnica.json`.

Un asistente de IA que proponga cualquiera de estas cosas para «desbloquear» un
PR está fallando la tarea, no resolviéndola.
