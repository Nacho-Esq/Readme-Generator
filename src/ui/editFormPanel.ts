import * as vscode from 'vscode';
import { FieldSpec, fieldKey, getFieldInstruction, getFormSections, PanelKind } from '../template/templateSpec';
import { FILL_PLACEHOLDER, isPlaceholderValue, RenderOptions, ReviewModel } from '../readme/reviewModel';
import { ReadmeData } from '../types';

type EditResult =
  | { action: 'save'; data: ReadmeData; renderOptions: RenderOptions }
  | { action: 'cancel' };

type RenderPreview = (data: ReadmeData, renderOptions: RenderOptions) => Promise<string>;
// `kind` (= panelKind) se incluye explícitamente porque el JS del webview lo lee.
type PendingField = FieldSpec & { key: string; sectionTitle: string; kind: PanelKind };

export class EditFormPanel {
  static show(
    data: ReadmeData,
    markdown: string,
    warnings: string[],
    extensionUri: vscode.Uri,
    review: ReviewModel,
    renderOptions: RenderOptions,
    renderPreview: RenderPreview
  ): Promise<EditResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorAiEdit',
      'README Review',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    return new Promise((resolve, reject) => {
      let resolved = false;
      let currentRenderOptions = renderOptions;

      try {
        panel.webview.html = getEditHtml(panel.webview, data, markdown, warnings, review, renderOptions);
      } catch (error) {
        resolved = true;
        reject(error);
        return;
      }

      const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        try {
          if (message?.command === 'preview') {
            currentRenderOptions = normalizeRenderOptions(message.renderOptions);
            const nextMarkdown = await renderPreview(message.data as ReadmeData, currentRenderOptions);
            await panel.webview.postMessage({ command: 'previewMarkdown', markdown: nextMarkdown });
          }
          if (message?.command === 'save') {
            currentRenderOptions = normalizeRenderOptions(message.renderOptions);
            cleanup({
              action: 'save',
              data: message.data as ReadmeData,
              renderOptions: currentRenderOptions
            });
          }
          if (message?.command === 'cancel') {
            cleanup({ action: 'cancel' });
          }
        } catch (error) {
          cleanup({ action: 'cancel' });
          reject(error);
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
  markdown: string,
  warnings: string[],
  review: ReviewModel,
  renderOptions: RenderOptions
): string {
  const nonce = getNonce();
  const reviewFields = getReviewFields(review);
  const pendingFields = getPendingFields(review);
  // El JS del webview necesita ambos grupos para recolectar valores, marcar
  // vacíos y descartar. Los de revisión van primero (aparecen antes en el panel).
  const editableFields = [...reviewFields, ...pendingFields];
  const warningItems = warnings.length
    ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
    : '<li>No hay advertencias del modelo.</li>';
  const reviewSection = reviewFields.length
    ? `<section>
        <h2>Campos a revisar</h2>
        <p class="muted">El modelo rellenó estos campos, pero pueden estar incompletos o ser imprecisos. Revísalos y corrige lo que sea necesario antes de guardar.</p>
        ${reviewFields.map((field) => fieldEditor(field, data, 'review')).join('')}
      </section>`
    : '';
  const pendingContent = pendingFields.length
    ? pendingFields.map((field) => fieldEditor(field, data, 'pending')).join('')
    : '<p class="muted">No hay campos pendientes de completar.</p>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>README Review</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .toolbar { display: flex; gap: 8px; position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 12px; cursor: pointer; border-radius: 2px; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.danger { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .layout { display: flex; flex-direction: column; gap: 18px; }
    section { border: 1px solid var(--vscode-panel-border); margin: 16px 0; padding: 12px; }
    h2 { margin-top: 0; font-size: 16px; }
    fieldset { border: 1px solid var(--vscode-panel-border); margin: 12px 0; padding: 12px; }
    fieldset.omitted { display: none; }
    label { display: block; font-weight: 600; margin-bottom: 6px; }
    .section-prefix { color: var(--vscode-descriptionForeground); font-weight: 400; font-size: 11px; }
    textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; font-family: var(--vscode-editor-font-family); min-height: 82px; resize: vertical; }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); font-style: italic; }
    .review label::before { content: "revisar"; display: block; color: var(--vscode-editorWarning-foreground, #cca700); font-weight: 700; text-transform: uppercase; }
    .review textarea { border-color: var(--vscode-editorWarning-foreground, #cca700); }
    .missing label::before { content: "pendiente"; display: block; color: var(--vscode-errorForeground); font-weight: 700; text-transform: uppercase; }
    .missing textarea { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); font-weight: 700; }
    .field-header { display: flex; gap: 8px; justify-content: space-between; align-items: start; }
    .field-header label { margin-right: 8px; }
    .hint, .muted { color: var(--vscode-descriptionForeground); }
    .hint { font-size: 12px; margin-top: 4px; }
    ul { padding-left: 20px; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid var(--vscode-panel-border); padding: 16px; background: var(--vscode-textCodeBlock-background); min-height: 70vh; }
    .placeholder { color: var(--vscode-errorForeground); font-weight: 800; background: color-mix(in srgb, var(--vscode-errorForeground) 16%, transparent); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="save">Guardar README.generated.md</button>
    <button id="cancel" class="secondary">Cancelar</button>
  </div>
  <div class="layout">
    <div>
      <section>
        <h2>Advertencias del generador</h2>
        <ul>${warningItems}</ul>
      </section>
      ${reviewSection}
      <section>
        <h2>Campos pendientes</h2>
        ${pendingContent}
      </section>
    </div>
    <section>
      <h2>Markdown generado</h2>
      <pre id="markdown">${renderMarkdown(markdown)}</pre>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const baseData = ${JSON.stringify(data)};
    const fields = ${JSON.stringify(editableFields)};
    const renderOptions = ${JSON.stringify(renderOptions)};

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function lines(id) {
      const element = document.getElementById(id);
      return element ? element.value.split('\\n').map((line) => line.trim()).filter(Boolean) : [];
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
      const data = clone(baseData);
      for (const field of fields) {
        if (renderOptions.omitFields[field.key]) {
          continue;
        }
        const element = document.getElementById(field.path);
        if (!element) {
          continue;
        }
        if (field.kind === 'list') {
          setPath(data, field.path, lines(field.path));
        } else if (field.kind === 'env') {
          setPath(data, field.path, collectEnv(field.path));
        } else {
          setPath(data, field.path, element.value.trim());
        }
      }
      return data;
    }

    function markMissing() {
      for (const field of fields) {
        if (renderOptions.omitFields[field.key]) {
          continue;
        }
        const element = document.getElementById(field.path);
        if (!element) {
          continue;
        }
        const fieldset = element.closest('fieldset');
        const value = element.value.trim();
        fieldset.classList.toggle('missing', value.length === 0 || value.includes('${FILL_PLACEHOLDER}'));
      }
    }

    function escapeHtml(value) {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderMarkdown(value) {
      return escapeHtml(value).replace(/\\*\\*RELLENAR POR USUARIO\\*\\*/g, '<span class="placeholder">**RELLENAR POR USUARIO**</span>');
    }

    let previewTimer;
    function requestPreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        vscode.postMessage({ command: 'preview', data: collect(), renderOptions });
      }, 150);
    }

    document.querySelectorAll('textarea').forEach((element) => {
      element.addEventListener('input', () => {
        markMissing();
        requestPreview();
      });
    });

    document.querySelectorAll('[data-action="discard"]').forEach((button) => {
      button.addEventListener('click', () => {
        const fieldset = button.closest('fieldset');
        const key = fieldset.getAttribute('data-field-key');
        renderOptions.omitFields[key] = true;
        fieldset.classList.add('omitted');
        requestPreview();
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.command === 'previewMarkdown') {
        document.getElementById('markdown').innerHTML = renderMarkdown(message.markdown);
      }
    });

    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({ command: 'save', data: collect(), renderOptions });
    });
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
    markMissing();
  </script>
</body>
</html>`;
}

function getPendingFields(review: ReviewModel): PendingField[] {
  return selectFields(review.missing);
}

// Campos A que el modelo rellenó: se muestran para verificación humana.
function getReviewFields(review: ReviewModel): PendingField[] {
  return selectFields(review.reviewNeeded);
}

function selectFields(entries: ReviewModel['missing']): PendingField[] {
  const paths = new Set(entries.map((field) => field.path));
  return getFormSections()
    .flatMap((section) => section.fields.map((field) => ({ ...field, sectionTitle: section.title })))
    .filter((field) => paths.has(field.path))
    .map((field) => ({ ...field, key: fieldKey(field.path), kind: field.panelKind }));
}

function fieldEditor(field: PendingField, data: ReadmeData, variant: 'pending' | 'review' = 'pending'): string {
  const rawValue = getPathValue(data, field.path);
  const value = formatValue(rawValue, field);
  const isMissing = value.trim() === '' || value.split('\n').some((line) => isPlaceholderValue(line) || line.includes(FILL_PLACEHOLDER));
  // En 'review' el modelo sí aportó un valor: se muestra para verificar/corregir,
  // no se vacía. En 'pending' se deja en blanco para que el usuario lo complete.
  const displayValue = variant === 'review' ? value : (isMissing ? '' : value);
  const hint = hintForKind(field.kind);
  const key = fieldKey(field.path);
  const classes = variant === 'review' ? 'review' : (isMissing ? 'missing' : '');
  const discardButton = '<button type="button" class="danger" data-action="discard">Descartar campo</button>';
  const placeholder = getPlaceholderText(field.path);

  return `<fieldset class="${escapeAttribute(classes)}" data-field-key="${escapeAttribute(key)}">
    <div class="field-header">
      <label for="${escapeAttribute(field.path)}"><span class="section-prefix">${escapeHtml(field.sectionTitle)} →</span> ${escapeHtml(field.label)}</label>
      ${discardButton}
    </div>
    <textarea id="${escapeAttribute(field.path)}" placeholder="${escapeAttribute(placeholder)}">${escapeHtml(displayValue)}</textarea>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </fieldset>`;
}

function getPlaceholderText(path: string): string {
  const instruction = getFieldInstruction(path);
  if (!instruction || instruction.length > 200) {
    return 'Completa con la información del campo.';
  }
  return instruction;
}

function normalizeRenderOptions(value: unknown): RenderOptions {
  if (!value || typeof value !== 'object') {
    return { omitFields: {}, omitSections: {} };
  }
  const record = value as Partial<RenderOptions>;
  return {
    omitFields: record.omitFields || {},
    omitSections: record.omitSections || {}
  };
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function hintForKind(kind: PanelKind): string {
  if (kind === 'env') {
    return 'Una variable por línea: NOMBRE: descripción';
  }
  return kind === 'list' ? 'Un valor por linea' : '';
}

function formatValue(value: unknown, field: PendingField): string {
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

function renderMarkdown(markdown: string): string {
  return escapeHtml(markdown).replace(/\*\*RELLENAR POR USUARIO\*\*/g, '<span class="placeholder">**RELLENAR POR USUARIO**</span>');
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
