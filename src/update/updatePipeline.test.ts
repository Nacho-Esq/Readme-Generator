import { beforeEach, describe, expect, it } from 'vitest';

import { initTemplateSpec } from '../template/templateSpec';
import { planStructuralRemoval, stripRemovedStructure } from './updatePipeline';

// Plantilla mínima que reproduce la forma real: secciones omitibles (token S) con
// subsecciones `### Etiqueta`, una sección con campo humano (H) y una sección con un
// único campo en línea (sin ###). Sirve para probar la desaparición determinista.
const TEMPLATE = [
  '# [[ project_name | M | Nombre. ]]',
  '',
  '---',
  '',
  '## 1. Resumen [[ resumen | S | ctx ]]',
  '',
  '### Qué es [[ summary.what_is | M | Qué es. ]]',
  '',
  '### Estado [[ summary.status | H | Estado. ]]',
  '',
  '---',
  '',
  '## 2. Arquitectura [[ arquitectura | S | ctx ]]',
  '',
  '### Componentes [[ architecture.components | M | list | Componentes. ]]',
  '',
  '### Dependencias [[ architecture.dependencies | M | list | Dependencias. ]]',
  '',
  '---',
  '',
  '## 3. Seguridad [[ seguridad | S | ctx ]]',
  '',
  '### Datos [[ security.data | M | list | Datos. ]]',
  '',
  '---',
  '',
  '## 4. Roadmap [[ mejoras | S | ctx ]]',
  '',
  '[[ roadmap | M | list | Mejoras. ]]',
  '',
  ''
].join('\n');

beforeEach(() => {
  initTemplateSpec(TEMPLATE);
});

describe('planStructuralRemoval', () => {
  const fichas = {
    project_name: 'Demo',
    summary: { what_is: 'Una app.' },
    architecture: { components: ['A', 'B'], dependencies: ['dep'] },
    security: { data: ['perfiles'] },
    roadmap: ['idea']
  };

  it('marca una sección entera (sin campos H) cuando se quitan todos sus campos', () => {
    const plan = planStructuralRemoval(new Set(['security.data']), fichas);
    expect(plan.removedSectionTitles).toEqual(['Seguridad']);
    expect(plan.removedFieldLabels).toEqual([]);
    expect(plan.structuralPaths.has('security.data')).toBe(true);
  });

  it('borra una subsección `###` pero conserva la sección si sobrevive otro campo', () => {
    const plan = planStructuralRemoval(new Set(['architecture.dependencies']), fichas);
    expect(plan.removedSectionTitles).toEqual([]);
    expect(plan.removedFieldLabels).toEqual(['Dependencias']);
  });

  it('NO borra la sección entera si tiene un campo humano (H) — la decide el texto', () => {
    // summary.what_is es el único campo M/A poblado; status es H (no está en fichas).
    const plan = planStructuralRemoval(new Set(['summary.what_is']), fichas);
    expect(plan.removedSectionTitles).toEqual([]);
    expect(plan.removedFieldLabels).toEqual(['Qué es']);
  });

  it('no propone nada para un campo en línea (sin ###) de una sección que sobrevive', () => {
    // roadmap es el único campo y es en línea: si su sección no se vacía por completo
    // no hay bloque ### que quitar. Aquí se quita y la sección (sin H) se va entera.
    const plan = planStructuralRemoval(new Set(['roadmap']), fichas);
    expect(plan.removedSectionTitles).toEqual(['Roadmap']);
    expect(plan.removedFieldLabels).toEqual([]);
  });
});

describe('stripRemovedStructure', () => {
  const README = [
    '# Demo',
    '',
    '---',
    '',
    '## 1. Resumen',
    '',
    '### Qué es',
    '',
    'Una app.',
    '',
    '### Estado',
    '',
    'En desarrollo.',
    '',
    '---',
    '',
    '## 2. Arquitectura',
    '',
    '### Componentes',
    '',
    '- A',
    '- B',
    '',
    '### Dependencias',
    '',
    '- dep',
    '',
    '---',
    '',
    '## 3. Seguridad',
    '',
    '### Datos',
    '',
    '- perfiles',
    ''
  ].join('\n');

  it('elimina una sección entera y renumera las siguientes', () => {
    const out = stripRemovedStructure(README, [], ['Arquitectura']);
    expect(out).not.toContain('Arquitectura');
    expect(out).not.toContain('Componentes');
    expect(out).toContain('## 1. Resumen');
    expect(out).toContain('## 2. Seguridad'); // era la 3, renumerada a 2
    expect(out).not.toContain('## 3.');
  });

  it('elimina solo una subsección `###` y deja el resto de la sección intacto', () => {
    const out = stripRemovedStructure(README, ['Dependencias'], []);
    expect(out).not.toContain('### Dependencias');
    expect(out).not.toContain('- dep');
    expect(out).toContain('### Componentes');
    expect(out).toContain('## 2. Arquitectura');
  });

  it('colapsa una sección que se queda sin subsecciones tras borrarlas todas', () => {
    const out = stripRemovedStructure(README, ['Datos'], []);
    // La sección Seguridad se queda vacía -> desaparece el encabezado también.
    expect(out).not.toContain('Seguridad');
    expect(out).not.toContain('### Datos');
  });

  it('conserva la sección si al borrar una subsección aún queda otra con contenido', () => {
    const out = stripRemovedStructure(README, ['Qué es'], []);
    expect(out).not.toContain('### Qué es');
    expect(out).toContain('### Estado'); // el campo humano sobrevive
    expect(out).toContain('## 1. Resumen');
  });

  it('no deja separadores `---` duplicados ni sueltos al final', () => {
    const out = stripRemovedStructure(README, [], ['Seguridad']);
    expect(out).not.toMatch(/---\s*\n\s*---/); // sin separadores consecutivos
    expect(out.trimEnd().endsWith('---')).toBe(false); // sin separador final
  });

  it('devuelve el texto intacto si no hay nada que quitar', () => {
    expect(stripRemovedStructure(README, [], [])).toBe(README);
  });
});
