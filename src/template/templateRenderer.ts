import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ReadmeData } from '../types';
import { createDefaultRenderOptions, FILL_PLACEHOLDER, RenderOptions } from '../readme/reviewModel';
import { fieldKey, FieldSpec, getTemplateSpec, parseToken, RenderType, TOKEN_REGEX } from './templateSpec';

interface RenderContext {
  data: ReadmeData;
  renderOptions: RenderOptions;
  byPath: Map<string, FieldSpec>;
}

const SECTION_REGEX = /<!--section:([\w-]+)-->([\s\S]*?)<!--\/section-->/g;
const COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const BLOCK_TYPES = new Set<RenderType>(['list', 'env', 'code', 'raw']);

// Símbolo que marca un hueco pendiente de rellenar por el usuario. Debe destacar
// claramente frente al texto real generado por el modelo.
const FILL_NOTE_ICON = '⚠️';

export class TemplateRenderer {
  // El contenido de la plantilla no cambia durante una generación, pero render()
  // se invoca en cada pulsación del preview. Cacheamos el texto por ruta para no
  // releer del disco en cada keystroke. Una instancia nueva por generación
  // garantiza que un cambio en la plantilla entre ejecuciones se recoja.
  private readonly templateCache = new Map<string, string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveTemplatePath(configuredPath: string): Promise<string> {
    if (configuredPath) {
      return configuredPath;
    }
    return path.join(this.extensionUri.fsPath, 'templates', 'readme.template.md');
  }

  async render(templatePath: string, data: ReadmeData, renderOptions: RenderOptions = createDefaultRenderOptions()): Promise<string> {
    const template = await this.loadTemplate(templatePath);
    return renderTemplate(template, data, renderOptions);
  }

  private async loadTemplate(templatePath: string): Promise<string> {
    const cached = this.templateCache.get(templatePath);
    if (cached !== undefined) {
      return cached;
    }
    const template = await fs.readFile(templatePath, 'utf8');
    this.templateCache.set(templatePath, template);
    return template;
  }
}

export function renderTemplate(template: string, data: ReadmeData, renderOptions: RenderOptions): string {
  const { byPath } = getTemplateSpec();
  const ctx: RenderContext = { data, renderOptions, byPath };

  // 1) Secciones omitibles: se elimina el bloque entero o solo sus marcadores.
  const withSections = template.replace(SECTION_REGEX, (_match, key: string, inner: string) =>
    renderOptions.omitSections[key] ? '' : inner
  );

  // 2) Comentarios de plantilla (cabecera explicativa, marcadores sueltos).
  const withoutComments = withSections.replace(COMMENT_REGEX, '');

  // 3) Tokens, línea a línea.
  const outputLines: string[] = [];
  for (const line of withoutComments.split('\n')) {
    outputLines.push(...renderLine(line, ctx));
  }

  const body = outputLines.join('\n');
  const cleaned = collapseBlankLines(body).replace(/^\n+/, '').trimEnd() + '\n';
  return renumberSections(cleaned);
}

// Renumera los encabezados de sección (`## N. Título`) de forma secuencial sobre el
// resultado ya renderizado. Las secciones omitibles (`<!--section:clave-->`) pueden
// haberse eliminado antes; sin esto la numeración escrita en la plantilla dejaría
// huecos (p. ej. 7, 9, 10 si desaparece la 8). Reasigna 1..N a las que sobreviven.
function renumberSections(markdown: string): string {
  let counter = 0;
  return markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^##\s+\d+\.\s+(.*)$/);
      if (!match) {
        return line;
      }
      counter += 1;
      return `## ${counter}. ${match[1]}`;
    })
    .join('\n');
}

function renderLine(line: string, ctx: RenderContext): string[] {
  const tokens = [...line.matchAll(TOKEN_REGEX)];
  if (tokens.length === 0) {
    return [line];
  }

  if (tokens.length === 1) {
    const match = tokens[0];
    const parsed = parseToken(match[1]);
    const field = ctx.byPath.get(parsed.path) ?? parsed;
    const before = line.slice(0, match.index ?? 0);
    const after = line.slice((match.index ?? 0) + match[0].length);

    // Cualquier campo puede descartarse desde el panel; si el usuario lo descartó,
    // no se renderiza (se elimina su línea entera, incluida la etiqueta en negrita).
    if (ctx.renderOptions.omitFields[fieldKey(field.path)]) {
      return [];
    }

    const value = getPathValue(ctx.data, field.path);
    const type = resolveType(field.type, value);
    // Hueco pendiente: si el valor es el centinela de relleno, en vez del dato se
    // muestra el marcador + la instrucción del campo (reutilizada de la plantilla).
    const note = isPlaceholderData(value) ? fillNote(field.instruction) : undefined;

    if (type === 'image') {
      if (note) {
        return [`${before}${note}${after}`];
      }
      const ref = typeof value === 'string' ? value.trim() : '';
      if (!ref) {
        return [];
      }
      const alt = typeof ctx.data.project_name === 'string' ? ctx.data.project_name : '';
      return [`${before}![${alt}](${ref})${after}`];
    }

    if (BLOCK_TYPES.has(type)) {
      const prefix = before.replace(/\s+$/, '');
      const leadingIndent = before.match(/^\s*/)?.[0] ?? '';
      const childIndent = prefix.length ? '  ' : leadingIndent;
      const blockLines = note
        ? [type === 'raw' ? `${childIndent}${note}` : `${childIndent}- ${note}`]
        : renderBlock(type, value, childIndent);
      const out: string[] = [];
      if (prefix.length) {
        out.push(prefix);
      }
      out.push(...blockLines);
      return out;
    }

    return [`${before}${note ?? renderInline(type, value)}${after}`];
  }

  // Varios tokens en una línea: sustitución en sitio.
  let out = line;
  for (const match of tokens) {
    const parsed = parseToken(match[1]);
    const field = ctx.byPath.get(parsed.path) ?? parsed;
    const value = getPathValue(ctx.data, field.path);
    const type = resolveType(field.type, value);
    let replacement: string;
    if (type === 'image') {
      replacement = '';
    } else if (isPlaceholderData(value)) {
      replacement = fillNote(field.instruction);
    } else {
      replacement = renderInline(type, value);
    }
    out = out.replace(match[0], replacement);
  }
  return [out];
}

// Marcador de un hueco pendiente de rellenar por el usuario, seguido de la
// instrucción del campo en cursiva (para que se distinga del contenido real).
function fillNote(instruction: string | undefined): string {
  const description = (instruction ?? '').trim();
  const marker = `${FILL_NOTE_ICON} **${FILL_PLACEHOLDER}**`;
  return description ? `${marker} — _${description}_` : marker;
}

// True si el valor es exactamente el centinela de relleno (en cualquiera de sus
// formas: texto, lista de un elemento, o par name/description de un env).
function isPlaceholderData(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim() === FILL_PLACEHOLDER;
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => {
      if (typeof item === 'string') {
        return item.trim() === FILL_PLACEHOLDER;
      }
      if (item && typeof item === 'object') {
        const record = item as { name?: unknown; description?: unknown };
        return record.name === FILL_PLACEHOLDER || record.description === FILL_PLACEHOLDER;
      }
      return false;
    });
  }
  return false;
}

function renderBlock(type: RenderType, value: unknown, indent: string): string[] {
  if (type === 'raw') {
    return typeof value === 'string' ? value.split('\n') : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  if (type === 'env') {
    return value.map((item) => {
      const record = (item ?? {}) as { name?: unknown; description?: unknown };
      const name = typeof record.name === 'string' ? record.name : '';
      const description = typeof record.description === 'string' ? record.description : '';
      return `${indent}- **${name}**: ${description}`;
    });
  }
  if (type === 'code') {
    return value.map((item) => `${indent}- \`${stringify(item)}\``);
  }
  // list
  return value.map((item) => `${indent}- ${stringify(item)}`);
}

function renderInline(type: RenderType, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => stringify(item)).join(', ');
  }
  return stringify(value);
}

function resolveType(declared: RenderType | undefined, value: unknown): RenderType {
  if (declared) {
    return declared;
  }
  return Array.isArray(value) ? 'list' : 'text';
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function getPathValue(value: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function collapseBlankLines(markdown: string): string {
  return markdown.replace(/\n{3,}/g, '\n\n');
}
