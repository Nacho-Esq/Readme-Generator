// Parser de la plantilla README. La plantilla es la fuente única de las
// instrucciones que recibe el modelo (antes en src/prompt/fieldInstructions.ts),
// además del rol M/H, el tipo de render y la estructura del documento.

export type FieldRole = 'M' | 'H';

export type RenderType = 'text' | 'csv' | 'list' | 'env' | 'code' | 'raw' | 'image';

export interface FieldSpec {
  path: string;
  role: FieldRole;
  optional: boolean;
  type?: RenderType;
  instruction: string;
}

export interface TemplateSpec {
  fields: FieldSpec[];
  byPath: Map<string, FieldSpec>;
}

const KNOWN_TYPES = new Set<RenderType>(['text', 'csv', 'list', 'env', 'code', 'raw', 'image']);

// Sub-campos de local_development.env_variables: el modelo los rellena como
// objeto, pero el JSON Schema necesita una descripción para cada uno.
export const ENV_NAME_INSTRUCTION = 'Nombre exacto de la variable de entorno.';
export const ENV_DESCRIPTION_INSTRUCTION = 'Finalidad de la variable de entorno, solo si puede inferirse con evidencia.';

// Token: [[ ruta | ROL | tipo? | instrucción ]]
// El contenido no debe incluir la secuencia "]]"; las instrucciones no la usan.
export const TOKEN_REGEX = /\[\[([\s\S]*?)\]\]/g;

export function parseToken(rawContent: string): FieldSpec {
  const parts = rawContent.split('|').map((part) => part.trim());
  const path = parts[0] ?? '';
  const roleRaw = (parts[1] ?? 'M').toUpperCase();
  const optional = roleRaw.endsWith('?');
  const roleLetter = roleRaw.replace('?', '');
  const role: FieldRole = roleLetter === 'H' ? 'H' : 'M';

  const rest = parts.slice(2);
  let type: RenderType | undefined;
  if (rest.length > 0 && KNOWN_TYPES.has(rest[0] as RenderType)) {
    type = rest[0] as RenderType;
    rest.shift();
  }
  const instruction = rest.join(' | ').trim();

  return { path, role, optional, type, instruction };
}

export function parseTemplate(text: string): TemplateSpec {
  const fields: FieldSpec[] = [];
  const byPath = new Map<string, FieldSpec>();

  for (const match of text.matchAll(TOKEN_REGEX)) {
    const field = parseToken(match[1]);
    if (!field.path) {
      continue;
    }
    fields.push(field);
    if (!byPath.has(field.path)) {
      byPath.set(field.path, field);
    }
  }

  return { fields, byPath };
}

// --- Singleton para los consumidores síncronos (prompt builder, panel) ---

let current: TemplateSpec | undefined;

export function initTemplateSpec(text: string): void {
  current = parseTemplate(text);
}

export function getTemplateSpec(): TemplateSpec {
  if (!current) {
    throw new Error('La plantilla no se ha inicializado todavía (initTemplateSpec).');
  }
  return current;
}

export function getFieldInstruction(path: string): string | undefined {
  if (path === 'local_development.env_variables.name') {
    return ENV_NAME_INSTRUCTION;
  }
  if (path === 'local_development.env_variables.description') {
    return ENV_DESCRIPTION_INSTRUCTION;
  }
  return getTemplateSpec().byPath.get(path)?.instruction;
}

export function isHumanField(path: string): boolean {
  return getTemplateSpec().byPath.get(path)?.role === 'H';
}

// Instrucciones por campo que se inyectan en el prompt del modelo: solo los
// campos marcados como M (los H los rellena el humano y el modelo no los busca).
export function buildFieldInstructionText(): string {
  const spec = getTemplateSpec();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const field of spec.fields) {
    if (field.role !== 'M' || seen.has(field.path)) {
      continue;
    }
    seen.add(field.path);
    lines.push(`- ${field.path}: ${field.instruction}`);
  }
  lines.push(`- local_development.env_variables.name: ${ENV_NAME_INSTRUCTION}`);
  lines.push(`- local_development.env_variables.description: ${ENV_DESCRIPTION_INSTRUCTION}`);
  return lines.join('\n');
}
