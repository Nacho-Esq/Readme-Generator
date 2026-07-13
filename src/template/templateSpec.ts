// Parser de la plantilla README. La plantilla es la FUENTE ÚNICA de:
//  - qué campos existen y su estructura JSON (de las rutas + el tipo del token),
//  - las instrucciones que recibe el modelo (la instrucción de cada token),
//  - el rol M/H (qué busca el modelo y qué deja para el humano),
//  - el label y la sección de cada campo para el panel de edición,
//  - el render del README final.
// No hay estructura de campos hardcodeada en ningún otro fichero.

// Roles: M = lo busca el modelo; H = lo rellena el humano (fuera de prompt y
// schema); A = "ambos" = el modelo lo trata igual que un M (lo busca y rellena),
// pero lo que rellene se marca para revisión humana en el panel antes de guardar.
export type FieldRole = 'M' | 'H' | 'A';

export type RenderType = 'text' | 'csv' | 'list' | 'env' | 'code' | 'raw' | 'image';

// Tipo del valor en el JSON que devuelve el modelo.
export type JsonType = 'string' | 'string[]' | 'env';

// Tipo de input en el panel de edición.
export type PanelKind = 'text' | 'list' | 'env';

// Token recién parseado, sin contexto de línea.
export interface ParsedToken {
  path: string;
  role: FieldRole;
  type?: RenderType;
  instruction: string;
}

// Campo completo: token enriquecido con lo que se deriva de su contexto.
export interface FieldSpec extends ParsedToken {
  label: string;
  section: string;
  // Clave del marcador <!--section:KEY--> que envuelve al campo (secciones
  // omitibles). undefined si el campo no está en una sección opcional.
  sectionKey?: string;
  jsonType: JsonType;
  panelKind: PanelKind;
}

export interface FormSection {
  title: string;
  fields: FieldSpec[];
}

export interface TemplateSpec {
  fields: FieldSpec[];
  byPath: Map<string, FieldSpec>;
}

const KNOWN_TYPES = new Set<RenderType>(['text', 'csv', 'list', 'env', 'code', 'raw', 'image']);

// Sub-campos de un campo `env`: el modelo los rellena como objeto {name, description}.
export const ENV_NAME_INSTRUCTION = 'Nombre exacto de la variable de entorno.';
export const ENV_DESCRIPTION_INSTRUCTION = 'Finalidad de la variable de entorno, solo si puede inferirse con evidencia.';

// Token: [[ ruta | ROL | tipo? | instrucción ]]. El contenido no debe incluir "]]".
export const TOKEN_REGEX = /\[\[([\s\S]*?)\]\]/g;
const COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const SECTION_OPEN_SENTINEL = '@@SECTION:';
const SECTION_CLOSE_SENTINEL = '@@ENDSECTION';
const HEADING_REGEX = /^#{1,6}\s+(\S.*?)\s*$/;
const BOLD_REGEX = /\*\*(.+?)\*\*/;
const SECTION_NUMBER_PREFIX = /^\d+\.\s*/;

export function parseToken(rawContent: string): ParsedToken {
  const parts = rawContent.split('|').map((part) => part.trim());
  const path = parts[0] ?? '';
  // Roles: M (lo busca el modelo), H (lo rellena el humano) y A (el modelo lo
  // busca como un M, pero se marca para revisión humana). No existe la noción de
  // campo "opcional": cualquier campo M/A puede quedar vacío para que lo complete
  // el usuario, y cualquier campo puede descartarse.
  const roleLetter = (parts[1] ?? 'M').toUpperCase();
  const role: FieldRole = roleLetter.startsWith('H') ? 'H' : roleLetter.startsWith('A') ? 'A' : 'M';

  const rest = parts.slice(2);
  let type: RenderType | undefined;
  if (rest.length > 0 && KNOWN_TYPES.has(rest[0] as RenderType)) {
    type = rest[0] as RenderType;
    rest.shift();
  }
  const instruction = rest.join(' | ').trim();

  return { path, role, type, instruction };
}

export function parseTemplate(text: string): TemplateSpec {
  const fields: FieldSpec[] = [];
  const byPath = new Map<string, FieldSpec>();

  // Convertir los marcadores de sección en sentinels de una línea y luego quitar
  // el resto de comentarios HTML (p. ej. la cabecera explicativa con su token de
  // ejemplo), para no tomarlos como campos reales.
  const stripped = text
    .replace(/<!--section:([\w-]+)-->/g, `${SECTION_OPEN_SENTINEL}$1`)
    .replace(/<!--\/section-->/g, SECTION_CLOSE_SENTINEL)
    .replace(COMMENT_REGEX, '');

  let currentSection = '';
  let currentSectionKey: string | undefined;

  for (const line of stripped.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(SECTION_OPEN_SENTINEL)) {
      currentSectionKey = trimmed.slice(SECTION_OPEN_SENTINEL.length);
      continue;
    }
    if (trimmed === SECTION_CLOSE_SENTINEL) {
      currentSectionKey = undefined;
      continue;
    }

    const tokenMatches = [...line.matchAll(TOKEN_REGEX)];

    // Un heading SIN token define una nueva sección. Si el heading contiene un
    // token (p. ej. "# [[ project_name ]]"), no es un título de sección.
    if (tokenMatches.length === 0) {
      const heading = line.match(HEADING_REGEX);
      if (heading) {
        currentSection = heading[1].replace(SECTION_NUMBER_PREFIX, '').trim();
      }
      continue;
    }

    for (const match of tokenMatches) {
      const token = parseToken(match[1]);
      if (!token.path) {
        continue;
      }
      const before = line.slice(0, match.index ?? 0);
      const field = enrichField(token, before, currentSection, currentSectionKey);
      fields.push(field);
      if (!byPath.has(field.path)) {
        byPath.set(field.path, field);
      }
    }
  }

  return { fields, byPath };
}

function enrichField(token: ParsedToken, before: string, currentSection: string, sectionKey: string | undefined): FieldSpec {
  const jsonType = jsonTypeOf(token.type);
  return {
    ...token,
    jsonType,
    panelKind: panelKindOf(jsonType),
    label: deriveLabel(before, currentSection, token.path),
    section: currentSection || 'General',
    sectionKey
  };
}

function jsonTypeOf(type: RenderType | undefined): JsonType {
  if (type === 'env') {
    return 'env';
  }
  if (type === 'list' || type === 'csv' || type === 'code') {
    return 'string[]';
  }
  return 'string';
}

function panelKindOf(jsonType: JsonType): PanelKind {
  if (jsonType === 'env') {
    return 'env';
  }
  return jsonType === 'string[]' ? 'list' : 'text';
}

// Label del panel: la negrita que precede al token; si no hay, el título de la
// sección; y como último recurso, la ruta formateada.
function deriveLabel(before: string, currentSection: string, path: string): string {
  const bold = before.match(BOLD_REGEX);
  if (bold) {
    return bold[1].trim();
  }
  if (currentSection) {
    return currentSection;
  }
  return formatPath(path);
}

function formatPath(path: string): string {
  const last = path.split('.').pop() ?? path;
  const words = last.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// --- Singleton para los consumidores síncronos (prompt builder, panel, render) ---

let current: TemplateSpec | undefined;

export function initTemplateSpec(text: string): void {
  const spec = parseTemplate(text);
  if (spec.fields.length === 0) {
    throw new Error('La plantilla README no contiene ningún token [[ ... ]] válido; revisa el formato de la plantilla.');
  }
  current = spec;
}

export function getTemplateSpec(): TemplateSpec {
  if (!current) {
    throw new Error('La plantilla no se ha inicializado todavía (initTemplateSpec).');
  }
  return current;
}

// Todos los campos únicos (primera aparición por ruta), en orden de plantilla.
export function getAllFields(): FieldSpec[] {
  return [...getTemplateSpec().byPath.values()];
}

// Campos agrupados por sección para el panel de edición.
export function getFormSections(): FormSection[] {
  const sections: FormSection[] = [];
  const byTitle = new Map<string, FormSection>();
  for (const field of getAllFields()) {
    let section = byTitle.get(field.section);
    if (!section) {
      section = { title: field.section, fields: [] };
      byTitle.set(field.section, section);
      sections.push(section);
    }
    section.fields.push(field);
  }
  return sections;
}

export function getFieldInstruction(path: string): string | undefined {
  const envSub = envSubInstruction(path);
  if (envSub) {
    return envSub;
  }
  return getTemplateSpec().byPath.get(path)?.instruction;
}

// Sub-instrucción de un campo `env` (`.name` / `.description`), derivada de la
// plantilla: solo aplica si el padre del path es un campo de tipo env. Así el
// path concreto del campo env no se hardcodea en ningún sitio.
function envSubInstruction(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    return undefined;
  }
  const parent = path.slice(0, dot);
  if (getTemplateSpec().byPath.get(parent)?.jsonType !== 'env') {
    return undefined;
  }
  const leaf = path.slice(dot + 1);
  if (leaf === 'name') {
    return ENV_NAME_INSTRUCTION;
  }
  if (leaf === 'description') {
    return ENV_DESCRIPTION_INSTRUCTION;
  }
  return undefined;
}

export function isHumanField(path: string): boolean {
  return getTemplateSpec().byPath.get(path)?.role === 'H';
}

// Campo A (ambos): el modelo lo rellena como un M, pero requiere revisión humana.
export function isReviewField(path: string): boolean {
  return getTemplateSpec().byPath.get(path)?.role === 'A';
}

export function fieldKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_');
}

// Instrucciones por campo que se inyectan en el prompt del modelo: los campos que
// el modelo debe rellenar (M y A). Los A se tratan igual que los M en el prompt;
// su distinción (revisión humana) solo aplica después, en el panel.
export function buildFieldInstructionText(): string {
  const lines: string[] = [];
  for (const field of getAllFields()) {
    if (field.role === 'H') {
      continue;
    }
    lines.push(`- ${field.path}: ${field.instruction}`);
    // Los sub-campos de un campo env se describen junto a su padre, derivados
    // del tipo del propio campo (no de un path hardcodeado).
    if (field.jsonType === 'env') {
      lines.push(`- ${field.path}.name: ${ENV_NAME_INSTRUCTION}`);
      lines.push(`- ${field.path}.description: ${ENV_DESCRIPTION_INSTRUCTION}`);
    }
  }
  return lines.join('\n');
}

// --- Derivación de la estructura de datos desde la plantilla ---

// Objeto vacío con la forma exacta de ReadmeData. `excludeHuman` quita los campos
// H (para el ejemplo de salida del prompt, que debe coincidir con el schema).
export function buildEmptyData(options: { excludeHuman?: boolean } = {}): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const field of getAllFields()) {
    if (options.excludeHuman && field.role === 'H') {
      continue;
    }
    setPath(root, field.path, emptyValue(field.jsonType));
  }
  return root;
}

function emptyValue(jsonType: JsonType): unknown {
  return jsonType === 'string' ? '' : [];
}

// JSON Schema de la propiedad `data`, derivado de las rutas y tipos de los tokens.
// Excluye los campos H: el modelo no puede devolverlos.
export function buildDataJsonSchema(): object {
  const root = buildNodeTree(getAllFields().filter((field) => field.role !== 'H'));
  return nodeToSchema(root);
}

interface SchemaNode {
  children: Map<string, SchemaNode>;
  field?: FieldSpec;
}

function buildNodeTree(fields: FieldSpec[]): SchemaNode {
  const root: SchemaNode = { children: new Map() };
  for (const field of fields) {
    let node = root;
    for (const part of field.path.split('.')) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.field = field;
  }
  return root;
}

function nodeToSchema(node: SchemaNode): object {
  if (node.field && node.children.size === 0) {
    return leafSchema(node.field);
  }
  const entries = [...node.children.entries()].map(([key, child]) => [key, nodeToSchema(child)] as const);
  return {
    type: 'object',
    additionalProperties: false,
    required: entries.map(([key]) => key),
    properties: Object.fromEntries(entries)
  };
}

function leafSchema(field: FieldSpec): object {
  if (field.jsonType === 'env') {
    return withDescription({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description'],
        properties: {
          name: withDescription({ type: 'string' }, ENV_NAME_INSTRUCTION),
          description: withDescription({ type: 'string' }, ENV_DESCRIPTION_INSTRUCTION)
        }
      }
    }, field.instruction);
  }
  if (field.jsonType === 'string[]') {
    return withDescription({ type: 'array', items: { type: 'string' } }, field.instruction);
  }
  return withDescription({ type: 'string' }, field.instruction);
}

function withDescription(schema: object, description: string | undefined): object {
  return description ? { ...schema, description } : schema;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) {
      node[parts[i]] = {};
    }
    node = node[parts[i]] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}
