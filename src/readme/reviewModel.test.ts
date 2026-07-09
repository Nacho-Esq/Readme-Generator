import { beforeEach, describe, expect, it } from 'vitest';
import { initTemplateSpec } from '../template/templateSpec';
import {
  analyzeReadmeData,
  completeRenderOptions,
  createDefaultRenderOptions,
  FILL_PLACEHOLDER,
  isPlaceholderValue,
  prepareDataForReview
} from './reviewModel';

const SAMPLE_TEMPLATE = [
  '<!--section:s1-->',
  '## 1. Sección 1',
  '- **Texto**: [[ texto | M | text | i ]]',
  '- **Lista**: [[ lista | M | list | i ]]',
  '- **Vars**: [[ vars | M | env | i ]]',
  '<!--/section-->',
  '## 2. Otra',
  '- **Otro**: [[ otro | M | text | i ]]'
].join('\n');

beforeEach(() => {
  initTemplateSpec(SAMPLE_TEMPLATE);
});

describe('analyzeReadmeData', () => {
  it('detecta como faltante un texto vacío o solo espacios', () => {
    const missing = analyzeReadmeData({ texto: '   ', lista: [], vars: [], otro: 'ok' }).missing;
    expect(missing.map((m) => m.path)).toContain('texto');
  });

  it('no marca como faltante un texto con contenido', () => {
    const missing = analyzeReadmeData({ texto: 'hola', lista: [], vars: [], otro: '' }).missing;
    expect(missing.map((m) => m.path)).not.toContain('texto');
  });

  it('una lista vacía o con solo elementos en blanco se considera faltante', () => {
    const vacia = analyzeReadmeData({ texto: 'x', lista: [], vars: [], otro: 'x' }).missing;
    expect(vacia.map((m) => m.path)).toContain('lista');

    const soloBlancos = analyzeReadmeData({ texto: 'x', lista: ['', '  '], vars: [], otro: 'x' }).missing;
    expect(soloBlancos.map((m) => m.path)).toContain('lista');
  });

  it('una lista con al menos un elemento con contenido no es faltante', () => {
    const missing = analyzeReadmeData({ texto: 'x', lista: ['algo'], vars: [], otro: 'x' }).missing;
    expect(missing.map((m) => m.path)).not.toContain('lista');
  });

  it('un campo env sin entradas, o con entradas totalmente en blanco, se considera faltante', () => {
    const vacio = analyzeReadmeData({ texto: 'x', lista: ['a'], vars: [], otro: 'x' }).missing;
    expect(vacio.map((m) => m.path)).toContain('vars');

    const blanco = analyzeReadmeData({ texto: 'x', lista: ['a'], vars: [{ name: '', description: '' }], otro: 'x' }).missing;
    expect(blanco.map((m) => m.path)).toContain('vars');
  });

  it('un campo env con al menos un name o description relleno no es faltante', () => {
    const missing = analyzeReadmeData({
      texto: 'x',
      lista: ['a'],
      vars: [{ name: 'API_KEY', description: '' }],
      otro: 'x'
    }).missing;
    expect(missing.map((m) => m.path)).not.toContain('vars');
  });
});

describe('prepareDataForReview', () => {
  it('inserta el placeholder de texto en los campos faltantes', () => {
    const result = prepareDataForReview({ texto: '', lista: ['a'], vars: [{ name: 'X', description: '' }], otro: 'x' }, createDefaultRenderOptions());
    expect(result.texto).toBe(FILL_PLACEHOLDER);
  });

  it('inserta un placeholder de lista de un elemento en los campos de lista faltantes', () => {
    const result = prepareDataForReview({ texto: 'x', lista: [], vars: [{ name: 'X', description: '' }], otro: 'x' }, createDefaultRenderOptions());
    expect(result.lista).toEqual([FILL_PLACEHOLDER]);
  });

  it('inserta un placeholder name/description en los campos env faltantes', () => {
    const result = prepareDataForReview({ texto: 'x', lista: ['a'], vars: [], otro: 'x' }, createDefaultRenderOptions());
    expect(result.vars).toEqual([{ name: FILL_PLACEHOLDER, description: FILL_PLACEHOLDER }]);
  });

  it('no toca los campos que ya tienen contenido', () => {
    const result = prepareDataForReview({ texto: 'hola', lista: ['a'], vars: [{ name: 'X', description: 'Y' }], otro: 'x' }, createDefaultRenderOptions());
    expect(result.texto).toBe('hola');
  });

  it('respeta omitFields: no rellena un campo marcado como omitido aunque esté vacío', () => {
    const result = prepareDataForReview(
      { texto: '', lista: ['a'], vars: [{ name: 'X', description: '' }], otro: 'x' },
      { omitFields: { texto: true }, omitSections: {} }
    );
    expect(result.texto).toBe('');
  });

  it('no muta el objeto original', () => {
    const original = { texto: '', lista: ['a'], vars: [{ name: 'X', description: '' }], otro: 'x' };
    prepareDataForReview(original, createDefaultRenderOptions());
    expect(original.texto).toBe('');
  });
});

describe('completeRenderOptions', () => {
  it('por defecto NO oculta una sección vacía si el usuario no ha omitido nada explícitamente', () => {
    // Aunque todos los campos de la sección estén vacíos, si el usuario no ha marcado
    // ningún omitFields, la sección se deja visible (mostrará los huecos de relleno).
    const result = completeRenderOptions(
      { texto: '', lista: [], vars: [], otro: 'x' },
      createDefaultRenderOptions()
    );
    expect(result.omitSections.s1).toBe(false);
  });

  it('marca omitSections=false si al menos un campo de la sección tiene datos visibles', () => {
    const result = completeRenderOptions(
      { texto: 'hola', lista: [], vars: [], otro: 'x' },
      createDefaultRenderOptions()
    );
    expect(result.omitSections.s1).toBe(false);
  });

  it('marca omitSections=true cuando el usuario ha omitido explícitamente todos los campos de la sección', () => {
    const result = completeRenderOptions(
      { texto: '', lista: [], vars: [], otro: 'x' },
      { omitFields: { texto: true, lista: true, vars: true }, omitSections: {} }
    );
    expect(result.omitSections.s1).toBe(true);
  });

  it('si queda un campo con datos sin omitir, la sección no se oculta aunque el resto esté omitido', () => {
    const result = completeRenderOptions(
      { texto: 'hola', lista: [], vars: [], otro: 'x' },
      { omitFields: { lista: true, vars: true }, omitSections: {} }
    );
    expect(result.omitSections.s1).toBe(false);
  });

  it('conserva una copia de las omitFields recibidas', () => {
    const options = { omitFields: { texto: true }, omitSections: {} };
    const result = completeRenderOptions({ texto: '', lista: [], vars: [], otro: 'x' }, options);
    expect(result.omitFields).toEqual({ texto: true });
    expect(result.omitFields).not.toBe(options.omitFields);
  });
});

describe('isPlaceholderValue', () => {
  it('reconoce el centinela tal cual y envuelto en negrita', () => {
    expect(isPlaceholderValue(FILL_PLACEHOLDER)).toBe(true);
    expect(isPlaceholderValue(`**${FILL_PLACEHOLDER}**`)).toBe(true);
  });

  it('no confunde un texto real con el centinela', () => {
    expect(isPlaceholderValue('un valor real')).toBe(false);
  });
});
