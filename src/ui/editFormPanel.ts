import * as vscode from 'vscode';
import { FieldDefinition, FormSection, FORM_SECTIONS, fieldKey } from '../readme/fieldMetadata';
import { FILL_PLACEHOLDER, isPlaceholderValue, RenderOptions } from '../readme/reviewModel';
import { ReadmeData } from '../types';

type EditResult =
  | { action: 'save'; data: ReadmeData; renderOptions: RenderOptions }
  | { action: 'cancel' };

export class EditFormPanel {
  static show(
    data: ReadmeData,
    warnings: string[],
    extensionUri: vscode.Uri,
    renderOptions: RenderOptions
  ): Promise<EditResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorAiEdit',
      'README Fields',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        panel.webview.html = getEditHtml(panel.webview, data, warnings, renderOptions);
      } catch (error) {
        resolved = true;
        reject(error);
        return;
      }

      const subscription = panel.webview.onDidReceiveMessage((message) => {
        if (message?.command === 'save') {
          cleanup({ action: 'save', data: message.data as ReadmeData, renderOptions });
        }
        if (message?.command === 'cancel') {
          cleanup({ action: 'cancel' });
        }
      });

      panel.onDidDispose(() => {
        subscription.dispose();
        if (!resolved) {
          resolved = true;
          resolve({ action: 'cancel' });
        }
      });

      function cleanup(result: EditResult): void {
        if (!resolved) {
          resolved = true;
          subscription.dispose();
          panel.dispose();
          resolve(result);
        }
      }
    });
  }
}

function getEditHtml(
  webview: vscode.Webview,
  data: ReadmeData,
  warnings: string[],
  renderOptions: RenderOptions
): string {
  const nonce = getNonce();
  const visibleSections = FORM_SECTIONS.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !renderOptions.omitFields[fieldKey(field.path)])
  })).filter((section) => section.fields.length > 0);
  const sections = visibleSections.map((section) => sectionEditor(section, data)).join('');
  const warningItems = warnings.length
    ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
    : '<li>Revisa los campos marcados antes de guardar.</li>';
  const fields = visibleSections.flatMap((section) => section.fields);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>README Fields</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .toolbar { display: flex; gap: 8px; position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 12px; cursor: pointer; border-radius: 2px; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
    section { border: 1px solid var(--vscode-panel-border); margin: 16px 0; padding: 12px; }
    fieldset { border: 0; margin: 12px 0; padding: 0; }
    label { display: block; font-weight: 600; margin-bottom: 6px; }
    textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; font-family: var(--vscode-editor-font-family); min-height: 82px; resize: vertical; }
    .missing label::after { content: " pendiente"; color: var(--vscode-errorForeground); font-weight: 700; text-transform: uppercase; }
    .missing textarea { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); font-weight: 700; }
    .essential label::before { content: "Esencial "; display: inline-block; margin-right: 6px; color: var(--vscode-errorForeground); font-size: 11px; text-transform: uppercase; }
    .optional label::before { content: "Opcional "; display: inline-block; margin-right: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="save">Guardar README.generated.md</button>
    <button id="cancel" class="secondary">Cancelar</button>
  </div>
  <section>
    <h2>Campos a revisar</h2>
    <ul>${warningItems}</ul>
  </section>
  <div class="grid">${sections}</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const fields = ${JSON.stringify(fields)};

    function lines(id) {
      return document.getElementById(id).value.split('\\n').map((line) => line.trim()).filter(Boolean);
    }

    function setPath(target, path, value) {
      const parts = path.split('.');
      let current = target;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = current[parts[i]] || {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }

    function collectEnv(id) {
      return lines(id).map((line) => {
        const index = line.indexOf(':');
        if (index === -1) {
          return { name: line, description: '' };
        }
        return { name: line.slice(0, index).trim(), description: line.slice(index + 1).trim() };
      }).filter((item) => item.name);
    }

    function collect() {
      const data = {};
      for (const field of fields) {
        const id = field.path;
        if (field.kind === 'list') {
          setPath(data, field.path, lines(id));
        } else if (field.kind === 'env') {
          setPath(data, field.path, collectEnv(id));
        } else {
          setPath(data, field.path, document.getElementById(id).value.trim());
        }
      }
      return data;
    }

    function markMissing() {
      for (const field of fields) {
        const element = document.getElementById(field.path);
        const fieldset = element.closest('fieldset');
        const value = element.value.trim();
        fieldset.classList.toggle('missing', value.length === 0 || value.includes('${FILL_PLACEHOLDER}'));
      }
    }

    document.querySelectorAll('textarea').forEach((element) => element.addEventListener('input', markMissing));
    document.getElementById('save').addEventListener('click', () => vscode.postMessage({ command: 'save', data: collect() }));
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
    markMissing();
  </script>
</body>
</html>`;
}

function sectionEditor(section: FormSection, data: ReadmeData): string {
  return `<section><h2>${escapeHtml(section.title)}</h2>${section.fields.map((field) => fieldEditor(field, data)).join('')}</section>`;
}

function fieldEditor(field: FieldDefinition, data: ReadmeData): string {
  const rawValue = getPathValue(data, field.path);
  const value = formatValue(rawValue, field);
  const hint = field.hint || (field.kind === 'list' ? 'Un valor por línea' : '');
  const classes = [
    field.importance,
    value.split('\n').some((line) => isPlaceholderValue(line) || line.includes(FILL_PLACEHOLDER)) ? 'missing' : ''
  ].filter(Boolean).join(' ');
  return `<fieldset class="${escapeAttribute(classes)}">
    <label for="${escapeAttribute(field.path)}">${escapeHtml(field.label)}</label>
    <textarea id="${escapeAttribute(field.path)}">${escapeHtml(value)}</textarea>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </fieldset>`;
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function formatValue(value: unknown, field: FieldDefinition): string {
  if (field.kind === 'env' && Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return `${String(record.name || '')}: ${String(record.description || '')}`.trim();
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (Array.isArray(value)) {
    return value.map(String).join('\n');
  }
  return typeof value === 'string' ? value : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\n/g, ' ');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
