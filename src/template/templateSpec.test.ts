import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildDataJsonSchema,
  buildEmptyData,
  buildFieldInstructionText,
  ENV_DESCRIPTION_INSTRUCTION,
  ENV_NAME_INSTRUCTION,
  fieldKey,
  getFieldInstruction,
  getFormSections,
  initTemplateSpec,
  parseTemplate,
  parseToken
} from './templateSpec';

describe('parseToken', () => {
  it('parsea ruta, rol, tipo e instrucción completos', () => {
    const token = parseToken('project_name | M | text | Nombre del proyecto');
    expect(token).toEqual({
      path: 'project_name',
      role: 'M',
      type: 'text',
      instruction: 'Nombre del proyecto'
    });
  });

  it('si no se indica rol, por defecto es M', () => {
    const token = parseToken('project_name | | Nombre del proyecto');
    expect(token.role).toBe('M');
  });

  it('detecta el rol H sin importar mayúsculas/minúsculas', () => {
    expect(parseToken('contacto | h | Email').role).toBe('H');
    expect(parseToken('contacto | Humano | Email').role).toBe('H');
  });

  it('detecta el rol A (ambos) sin importar mayúsculas/minúsculas', () => {
    expect(parseToken('campo | A | i').role).toBe('A');
    expect(parseToken('campo | a | i').role).toBe('A');
    expect(parseToken('campo | Ambos | i').role).toBe('A');
  });

  it('si el segundo segmento no es un tipo conocido, se trata como parte de la instrucción', () => {
    const token = parseToken('algo | M | Instrucción sin tipo válido');
    expect(token.type).toBeUndefined();
    expect(token.instruction).toBe('Instrucción sin tipo válido');
  });

  it('reconoce todos los tipos válidos', () => {
    for (const type of ['text', 'csv', 'list', 'env', 'code', 'raw', 'image']) {
      expect(parseToken(`x | M | ${type} | instr`).type).toBe(type);
    }
  });

  it('reconstruye la instrucción aunque contenga "|" dentro', () => {
    const token = parseToken('x | M | text | Elige entre A | B según el caso');
    expect(token.instruction).toBe('Elige entre A | B según el caso');
  });

  it('recorta espacios sobrantes en cada segmento', () => {
    const token = parseToken('  x   |  M  |  text  |   instrucción con espacios   ');
    expect(token.path).toBe('x');
    expect(token.instruction).toBe('instrucción con espacios');
  });
});

describe('parseTemplate', () => {
  it('asigna la sección a partir del heading más cercano', () => {
    const spec = parseTemplate('## 1. Resumen\n\n- **Qué es**: [[ summary.what | M | text | descripción ]]\n');
    const field = spec.byPath.get('summary.what');
    expect(field?.section).toBe('Resumen');
    expect(field?.label).toBe('Qué es');
  });

  it('un heading con número se limpia (quita el "1. ")', () => {
    const spec = parseTemplate('## 3. Experiencia de usuario\n\n[[ x | M | text | i ]]\n');
    expect(spec.fields[0].section).toBe('Experiencia de usuario');
  });

  it('si no hay negrita ni sección, usa la ruta formateada como label', () => {
    const spec = parseTemplate('[[ project_name | M | text | Nombre ]]\n');
    expect(spec.fields[0].label).toBe('Project name');
  });

  it('un heading que contiene un token no se trata como título de sección', () => {
    const spec = parseTemplate('# [[ project_name | M | text | Nombre ]]\n');
    expect(spec.fields[0].section).toBe('General');
  });

  it('varios tokens en la misma línea se recogen todos', () => {
    const spec = parseTemplate('[[ a | M | text | uno ]] y [[ b | M | text | dos ]]\n');
    expect(spec.fields.map((f) => f.path)).toEqual(['a', 'b']);
  });

  it('respeta las secciones omitibles marcadas con un token de sección (rol S) en el encabezado', () => {
    const template = [
      '[[ fuera.seccion | M | text | otro ]]',
      '## 5. Extra [[ extra | S | contexto de la sección ]]',
      '[[ extra.field | M | text | algo ]]'
    ].join('\n');
    const spec = parseTemplate(template);
    expect(spec.byPath.get('extra.field')?.sectionKey).toBe('extra');
    expect(spec.byPath.get('fuera.seccion')?.sectionKey).toBeUndefined();
  });

  it('asocia el contexto del token de sección (rol S) a los campos de la sección', () => {
    const template = [
      '## 3. Experiencia de usuario [[ experiencia | S | Contexto de la sección UX. ]]',
      '### Canales [[ usage.channels | M | csv | Canales ]]',
      '### Idiomas [[ usage.languages | M | csv | Idiomas ]]'
    ].join('\n');
    const spec = parseTemplate(template);
    expect(spec.byPath.get('usage.channels')?.sectionContext).toBe('Contexto de la sección UX.');
    expect(spec.byPath.get('usage.languages')?.sectionContext).toBe('Contexto de la sección UX.');
  });

  it('el contexto de una sección no se filtra a la siguiente', () => {
    const template = [
      '## 3. UX [[ ux | S | Contexto UX. ]]',
      '### Campo [[ ux.field | M | text | i ]]',
      '## 4. Arquitectura [[ arquitectura | S | ]]',
      '### Campo [[ arch.field | M | text | i ]]'
    ].join('\n');
    const spec = parseTemplate(template);
    expect(spec.byPath.get('ux.field')?.sectionContext).toBe('Contexto UX.');
    expect(spec.byPath.get('arch.field')?.sectionContext).toBeUndefined();
  });

  it('un token de sección con instrucción vacía deja la sección sin contexto', () => {
    const spec = parseTemplate('## 4. Arquitectura [[ arquitectura | S | ]]\n[[ arch.field | M | text | i ]]\n');
    expect(spec.byPath.get('arch.field')?.sectionKey).toBe('arquitectura');
    expect(spec.byPath.get('arch.field')?.sectionContext).toBeUndefined();
  });

  it('ignora comentarios HTML que no son marcadores de sección', () => {
    const template = '<!-- ejemplo: [[ ejemplo | M | text | no cuenta ]] -->\n[[ real | M | text | sí cuenta ]]\n';
    const spec = parseTemplate(template);
    expect(spec.fields).toHaveLength(1);
    expect(spec.fields[0].path).toBe('real');
  });

  it('un campo con tipo env genera jsonType env y panelKind env', () => {
    const spec = parseTemplate('[[ vars | M | env | variables de entorno ]]\n');
    expect(spec.byPath.get('vars')?.jsonType).toBe('env');
    expect(spec.byPath.get('vars')?.panelKind).toBe('env');
  });

  it('los tipos list/csv/code producen jsonType string[]', () => {
    for (const type of ['list', 'csv', 'code']) {
      const spec = parseTemplate(`[[ x | M | ${type} | instr ]]\n`);
      expect(spec.byPath.get('x')?.jsonType).toBe('string[]');
    }
  });

  it('si el mismo path aparece dos veces, solo se guarda la primera aparición en byPath', () => {
    const spec = parseTemplate('[[ x | M | text | primera ]]\n[[ x | M | text | segunda ]]\n');
    expect(spec.fields).toHaveLength(2);
    expect(spec.byPath.get('x')?.instruction).toBe('primera');
  });

  it('lanza un error de inicialización claro si la plantilla no tiene tokens', () => {
    expect(() => initTemplateSpec('# Sin tokens\n\nSolo texto.')).toThrow(/no contiene ningún token/);
  });
});

describe('derivación de estructura de datos desde la plantilla', () => {
  const SAMPLE_TEMPLATE = [
    '## 1. Resumen',
    '- **Nombre**: [[ project_name | M | text | Nombre del proyecto ]]',
    '- **Estado**: [[ summary.status | H | text | Estado ]]',
    '- **Incluye**: [[ scope.includes | M | list | Qué incluye ]]',
    '- **Variables**: [[ local_development.env_variables | M | env | Variables de entorno ]]'
  ].join('\n');

  beforeEach(() => {
    initTemplateSpec(SAMPLE_TEMPLATE);
  });

  it('buildEmptyData crea la forma anidada exacta con valores vacíos', () => {
    const data = buildEmptyData();
    expect(data).toEqual({
      project_name: '',
      summary: { status: '' },
      scope: { includes: [] },
      local_development: { env_variables: [] }
    });
  });

  it('buildEmptyData con excludeHuman omite los campos de rol H', () => {
    const data = buildEmptyData({ excludeHuman: true }) as Record<string, unknown>;
    expect(data).not.toHaveProperty('summary');
    expect(data).toHaveProperty('project_name');
  });

  it('buildDataJsonSchema excluye los campos H y respeta la estructura anidada', () => {
    const schema = buildDataJsonSchema() as any;
    expect(schema.type).toBe('object');
    expect(schema.properties).not.toHaveProperty('summary');
    expect(schema.properties.project_name).toEqual({ type: 'string', description: 'Nombre del proyecto' });
    expect(schema.properties.scope.properties.includes).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'Qué incluye'
    });
  });

  it('buildDataJsonSchema modela los campos env como array de {name, description}', () => {
    const schema = buildDataJsonSchema() as any;
    const envSchema = schema.properties.local_development.properties.env_variables;
    expect(envSchema.type).toBe('array');
    expect(envSchema.items.required).toEqual(['name', 'description']);
    expect(envSchema.items.properties.name.description).toBe(ENV_NAME_INSTRUCTION);
    expect(envSchema.items.properties.description.description).toBe(ENV_DESCRIPTION_INSTRUCTION);
  });

  it('getFieldInstruction devuelve las sub-instrucciones .name/.description de un campo env', () => {
    expect(getFieldInstruction('local_development.env_variables.name')).toBe(ENV_NAME_INSTRUCTION);
    expect(getFieldInstruction('local_development.env_variables.description')).toBe(ENV_DESCRIPTION_INSTRUCTION);
  });

  it('getFieldInstruction no aplica la sub-instrucción env a un campo que no es de tipo env', () => {
    expect(getFieldInstruction('scope.includes.name')).toBeUndefined();
  });

  it('un campo A se incluye en el schema y en buildEmptyData como un campo del modelo (no como H)', () => {
    initTemplateSpec(
      [
        '[[ a_campo | A | text | i ]]',
        '[[ h_campo | H | text | i ]]'
      ].join('\n')
    );
    const schema = buildDataJsonSchema() as any;
    expect(schema.properties).toHaveProperty('a_campo');
    expect(schema.properties).not.toHaveProperty('h_campo');
    const withoutHuman = buildEmptyData({ excludeHuman: true }) as Record<string, unknown>;
    expect(withoutHuman).toHaveProperty('a_campo');
    expect(withoutHuman).not.toHaveProperty('h_campo');
  });

  it('fieldKey convierte cualquier carácter no alfanumérico en "_"', () => {
    expect(fieldKey('local_development.env_variables')).toBe('local_development_env_variables');
  });

  it('buildFieldInstructionText incluye campos M y A (no H), y añade las sub-líneas de los campos env', () => {
    const text = buildFieldInstructionText();
    expect(text).toContain('project_name: Nombre del proyecto');
    expect(text).not.toContain('summary.status');
    expect(text).toContain('local_development.env_variables.name');
    expect(text).toContain('local_development.env_variables.description');
  });

  it('buildFieldInstructionText agrupa los campos por sección e inyecta el contexto de cada una', () => {
    initTemplateSpec(
      [
        '## 3. Experiencia de usuario [[ experiencia | S | Cómo interactúan las personas usuarias. ]]',
        '### Canales [[ usage.channels | M | csv | Canales ]]',
        '## 4. Arquitectura [[ arquitectura | S | Estructura técnica interna. ]]',
        '### Componentes [[ architecture.components | M | list | Componentes ]]'
      ].join('\n')
    );
    const text = buildFieldInstructionText();
    expect(text).toContain('Sección «Experiencia de usuario» — Cómo interactúan las personas usuarias.');
    expect(text).toContain('Sección «Arquitectura» — Estructura técnica interna.');
    // El campo de cada sección aparece bajo su encabezado de contexto.
    const uxIdx = text.indexOf('Experiencia de usuario');
    const archIdx = text.indexOf('Arquitectura');
    expect(text.indexOf('usage.channels')).toBeGreaterThan(uxIdx);
    expect(text.indexOf('usage.channels')).toBeLessThan(archIdx);
    expect(text.indexOf('architecture.components')).toBeGreaterThan(archIdx);
  });

  it('buildFieldInstructionText incluye el encabezado de sección aunque no haya contexto declarado', () => {
    initTemplateSpec('## 1. Resumen\n[[ project_name | M | text | Nombre ]]\n');
    const text = buildFieldInstructionText();
    expect(text).toContain('Sección «Resumen»');
    expect(text).not.toContain('Sección «Resumen» —');
  });

  it('buildFieldInstructionText trata los campos A igual que los M (los incluye en el prompt)', () => {
    initTemplateSpec(
      [
        '[[ a_campo | A | text | instrucción del campo A ]]',
        '[[ h_campo | H | text | instrucción del campo H ]]'
      ].join('\n')
    );
    const text = buildFieldInstructionText();
    expect(text).toContain('a_campo: instrucción del campo A');
    expect(text).not.toContain('h_campo');
  });

  it('getFormSections agrupa los campos por sección en orden de aparición', () => {
    const sections = getFormSections();
    expect(sections.map((s) => s.title)).toEqual(['Resumen']);
    expect(sections[0].fields).toHaveLength(4);
  });
});

describe('regresión: la plantilla real del proyecto debe seguir siendo válida', () => {
  it('parsea templates/readme.template.md sin errores y produce campos con instrucción no vacía', () => {
    const templatePath = join(__dirname, '..', '..', 'templates', 'readme.template.md');
    const text = readFileSync(templatePath, 'utf8');
    const spec = parseTemplate(text);

    expect(spec.fields.length).toBeGreaterThan(0);

    for (const field of spec.fields) {
      expect(field.path.length).toBeGreaterThan(0);
      expect(['M', 'H', 'A']).toContain(field.role);
      expect(field.instruction.trim().length).toBeGreaterThan(0);
    }
  });

  it('todas las rutas de la plantilla real son únicas por byPath', () => {
    const templatePath = join(__dirname, '..', '..', 'templates', 'readme.template.md');
    const text = readFileSync(templatePath, 'utf8');
    const spec = parseTemplate(text);
    const uniquePaths = new Set(spec.fields.map((f) => f.path));
    expect(spec.byPath.size).toBe(uniquePaths.size);
  });
});
