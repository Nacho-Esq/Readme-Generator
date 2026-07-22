import { beforeEach, describe, expect, it } from 'vitest';
import { initTemplateSpec } from '../template/templateSpec';
import { buildPlanFromJudge } from './updatePlanner';
import { JudgeChange } from '../azure/azureResponsesClient';

// Plantilla con campos M, A y H de distinto tipo. El actualizador nunca debe tocar
// los H, y el plan se construye a partir del veredicto del juez.
const TEMPLATE = [
  '<!--section:s1-->',
  '## 1. Resumen',
  '- **Qué es**: [[ summary.what_is | M | text | i ]]',
  '- **Canales**: [[ usage.channels | A | csv | i ]]',
  '- **Contacto**: [[ contact.owner | H | text | i ]]',
  '<!--/section-->',
  '<!--section:s2-->',
  '## 2. Puesta en marcha',
  '- **Instalación**: [[ setup.install | M | list | i ]]',
  '<!--/section-->'
].join('\n');

beforeEach(() => {
  initTemplateSpec(TEMPLATE);
});

const newData = {
  summary: { what_is: 'Una CLI mejorada.' },
  usage: { channels: ['CLI', 'API'] },
  setup: { install: ['npm install', 'npm run build'] }
};

function judge(...changes: JudgeChange[]): JudgeChange[] {
  return changes;
}

describe('buildPlanFromJudge', () => {
  it('crea un FieldChange por cada cambio del juez, tomando el valor de newData', () => {
    const plan = buildPlanFromJudge(
      judge({ path: 'summary.what_is', current_readme_value: 'Una CLI.', reason: 'descripción ampliada' }),
      newData
    );
    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0];
    expect(change.path).toBe('summary.what_is');
    expect(change.oldValue).toBe('Una CLI.');
    expect(change.newValue).toBe('Una CLI mejorada.');
    expect(change.reason).toBe('descripción ampliada');
  });

  it('acepta campos A igual que los M', () => {
    const plan = buildPlanFromJudge(
      judge({ path: 'usage.channels', current_readme_value: 'CLI', reason: 'nuevo canal API' }),
      newData
    );
    expect(plan.changes.map((c) => c.path)).toContain('usage.channels');
  });

  it('ignora rutas de campos H aunque el juez las devuelva', () => {
    const plan = buildPlanFromJudge(
      judge({ path: 'contact.owner', current_readme_value: 'Ana', reason: 'x' }),
      { ...newData, contact: { owner: 'Otro' } }
    );
    expect(plan.changes.find((c) => c.path === 'contact.owner')).toBeUndefined();
  });

  it('ignora rutas desconocidas que no existen en la plantilla', () => {
    const plan = buildPlanFromJudge(
      judge({ path: 'campo.inventado', current_readme_value: 'x', reason: 'y' }),
      newData
    );
    expect(plan.changes).toHaveLength(0);
  });

  it('descarta un cambio si newData no tiene valor para ese campo (nada que aplicar)', () => {
    const plan = buildPlanFromJudge(
      judge({ path: 'setup.install', current_readme_value: 'npm i', reason: 'x' }),
      { ...newData, setup: { install: [] } }
    );
    expect(plan.changes.find((c) => c.path === 'setup.install')).toBeUndefined();
  });

  it('no duplica un campo si el juez lo devuelve dos veces', () => {
    const plan = buildPlanFromJudge(
      judge(
        { path: 'summary.what_is', current_readme_value: 'Una CLI.', reason: 'a' },
        { path: 'summary.what_is', current_readme_value: 'Una CLI.', reason: 'b' }
      ),
      newData
    );
    expect(plan.changes).toHaveLength(1);
  });

  it('omite un cambio si el juez no localizó el valor actual en el README (no se añaden campos ausentes)', () => {
    const plan = buildPlanFromJudge(
      judge({ path: 'summary.what_is', current_readme_value: '   ', reason: 'x' }),
      newData
    );
    expect(plan.changes).toHaveLength(0);
  });

  it('devuelve un plan vacío si el juez no reporta cambios', () => {
    const plan = buildPlanFromJudge([], newData);
    expect(plan.changes).toHaveLength(0);
  });
});
