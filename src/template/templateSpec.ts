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
// S = "sección": no es un campo real, es el token que marca el encabezado de una
// sección omitible y transporta su clave (path) y su contexto (instrucción). Los
// tokens S no se convierten nunca en FieldSpec: se consumen al parsear.
export type FieldRole = 'M' | 'H' | 'A' | 'S';

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
  // Contexto de la sección declarado con <!--context: ... --> bajo el encabezado.
  // Describe de qué trata la sección para el modelo; se inyecta en el prompt junto
  // a la instrucción del campo, pero NO aparece en el README final. undefined si la
  // sección no declara contexto.
  sectionContext?: string;
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
const HEADING_REGEX = /^#{1,6}\s+(\S.*?)\s*$/;
const HEADING_PREFIX_REGEX = /^\s*#{1,6}\s+/;
const BULLET_PREFIX_REGEX = /^\s*[-*]\s+/;
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
  const role: FieldRole = roleLetter.startsWith('H')
    ? 'H'
    : roleLetter.startsWith('A')
      ? 'A'
      : roleLetter.startsWith('S')
        ? 'S'
        : 'M';

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

  let currentSection = '';
  let currentSectionKey: string | undefined;
  let currentSectionContext: string | undefined;

  for (const rawLine of text.split('\n')) {
    // Se quitan los comentarios HTML sueltos por si la plantilla los llevara (ya no
    // se usan como marcadores, pero no deben tomarse como campos reales).
    const line = rawLine.replace(COMMENT_REGEX, '');
    const tokenMatches = [...line.matchAll(TOKEN_REGEX)];

    // Encabezado de sección: un heading cuyo token tiene rol S. Transporta la clave
    // de omisión (path) y el contexto de la sección (instrucción), que se inyecta en
    // el prompt pero NO se renderiza. No genera campo. Al abrir sección se descarta
    // el contexto anterior: cada sección declara el suyo en su propio token.
    const sectionToken = findSectionToken(tokenMatches);
    if (sectionToken) {
      currentSection = sectionTitleFromHeading(line);
      currentSectionKey = sectionToken.path || undefined;
      currentSectionContext = sectionToken.instruction || undefined;
      continue;
    }

    // Un heading SIN token también define una nueva sección (formato sin token S), y
    // sale de cualquier sección omitible. Si el heading contiene un token de campo
    // (p. ej. "# [[ project_name ]]"), no es un título de sección: es un campo.
    if (tokenMatches.length === 0) {
      const heading = line.match(HEADING_REGEX);
      if (heading) {
        currentSection = heading[1].replace(SECTION_NUMBER_PREFIX, '').trim();
        currentSectionKey = undefined;
        currentSectionContext = undefined;
      }
      continue;
    }

    for (const match of tokenMatches) {
      const token = parseToken(match[1]);
      if (!token.path) {
        continue;
      }
      const before = line.slice(0, match.index ?? 0);
      const field = enrichField(token, before, currentSection, currentSectionKey, currentSectionContext);
      fields.push(field);
      if (!byPath.has(field.path)) {
        byPath.set(field.path, field);
      }
    }
  }

  return { fields, byPath };
}

// Devuelve el token de sección (rol S) de una línea, si lo hay. El encabezado de
// una sección es el único sitio donde aparece un token S.
function findSectionToken(matches: RegExpMatchArray[]): ParsedToken | undefined {
  for (const match of matches) {
    const token = parseToken(match[1]);
    if (token.role === 'S') {
      return token;
    }
  }
  return undefined;
}

// Título de sección a partir de la línea de encabezado: se quita el token, el nivel
// de heading (##) y el número ("4. "), dejando solo el texto ("Arquitectura").
function sectionTitleFromHeading(line: string): string {
  const withoutToken = line.replace(TOKEN_REGEX, '').trim();
  const heading = withoutToken.match(HEADING_REGEX);
  const title = heading ? heading[1] : withoutToken.replace(HEADING_PREFIX_REGEX, '');
  return title.replace(SECTION_NUMBER_PREFIX, '').trim();
}

function enrichField(
  token: ParsedToken,
  before: string,
  currentSection: string,
  sectionKey: string | undefined,
  sectionContext: string | undefined
): FieldSpec {
  const jsonType = jsonTypeOf(token.type);
  return {
    ...token,
    jsonType,
    panelKind: panelKindOf(jsonType),
    label: deriveLabel(before, currentSection, token.path),
    section: currentSection || 'General',
    sectionKey,
    sectionContext
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

// Label del panel: el texto que precede al token en su línea, ya venga como negrita
// de un bullet ("- **Diagrama lógico**: [[…]]") o como texto de un encabezado
// ("### Diagrama lógico [[…]]"). Se limpian los marcadores de heading/bullet, la
// negrita y los dos puntos finales. Si no hay texto, se usa el título de la sección
// y, como último recurso, la ruta formateada.
function deriveLabel(before: string, currentSection: string, path: string): string {
  const cleaned = before
    .replace(HEADING_PREFIX_REGEX, '')
    .replace(BULLET_PREFIX_REGEX, '')
    .trim();
  const bold = cleaned.match(BOLD_REGEX);
  if (bold) {
    return bold[1].trim();
  }
  const text = cleaned.replace(/:\s*$/, '').trim();
  if (text) {
    return text;
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

export function fieldKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_');
}

// Instrucciones por campo que se inyectan en el prompt del modelo: los campos que
// el modelo debe rellenar (M y A). Los A se tratan igual que los M en el prompt;
// su distinción (revisión humana) solo aplica después, en el panel.
//
// Los campos se agrupan por sección y cada grupo se encabeza con el nombre de la
// sección y su contexto (el <!--context: ... --> de la plantilla, si lo hay), para
// que el modelo rellene cada campo sabiendo a qué sección pertenece y con qué fin.
export function buildFieldInstructionText(includePaths?: Set<string>): string {
  const lines: string[] = [];
  let lastSection: string | undefined;
  for (const field of getAllFields()) {
    if (field.role === 'H') {
      continue;
    }
    // Alcance opcional: si se pasa `includePaths`, solo se emiten esos campos (lo usa
    // el actualizador para buscar en el código únicamente lo que el README documenta).
    if (includePaths && !includePaths.has(field.path)) {
      continue;
    }
    if (field.section !== lastSection) {
      lastSection = field.section;
      if (lines.length > 0) {
        lines.push('');
      }
      const context = field.sectionContext ? ` — ${field.sectionContext}` : '';
      lines.push(`Sección «${field.section}»${context}`);
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
