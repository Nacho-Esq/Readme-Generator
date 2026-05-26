import * as vscode from 'vscode';
import { MissingField, RenderOptions, ReviewModel } from '../readme/reviewModel';

type PreviewAction =
  | { action: 'edit'; renderOptions: RenderOptions }
  | { action: 'cancel' };

type RenderPreview = (renderOptions: RenderOptions) => Promise<string>;

export class PreviewPanel {
  static show(
    markdown: string,
    warnings: string[],
    extensionUri: vscode.Uri,
    review: ReviewModel,
    initialRenderOptions: RenderOptions,
    renderPreview: RenderPreview
  ): Promise<PreviewAction> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorAiPreview',
      'README Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    return new Promise((resolve, reject) => {
      let resolved = false;
      let currentRenderOptions = initialRenderOptions;

      try {
        panel.webview.html = getPreviewHtml(panel.webview, markdown, warnings, review, initialRenderOptions);
      } catch (error) {
        resolved = true;
        reject(error);
        return;
      }

      const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        try {
          if (message?.command === 'previewOptions') {
            currentRenderOptions = normalizeRenderOptions(message.renderOptions);
            const nextMarkdown = await renderPreview(currentRenderOptions);
            await panel.webview.postMessage({ command: 'previewMarkdown', markdown: nextMarkdown });
          }
          if (message?.command === 'edit') {
            cleanup({ action: 'edit', renderOptions: currentRenderOptions });
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

      function cleanup(action: PreviewAction): void {
        if (!resolved) {
          resolved = true;
          subscription.dispose();
          panel.dispose();
          resolve(action);
        }
      }
    });
  }
}

function getPreviewHtml(
  webview: vscode.Webview,
  markdown: string,
  warnings: string[],
  review: ReviewModel,
  initialRenderOptions: RenderOptions
): string {
  const nonce = getNonce();
  const warningItems = warnings.length
    ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
    : '<li>No hay advertencias del modelo.</li>';
  const essentialItems = review.essentialMissing.length
    ? review.essentialMissing.map((field) => missingItem(field, false)).join('')
    : '<li>No hay campos esenciales pendientes.</li>';
  const optionalCards = review.optionalMissing.length
    ? review.optionalMissing.map(optionalCard).join('')
    : '<p class="muted">No hay campos opcionales vacíos.</p>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>README Preview</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .toolbar { display: flex; gap: 8px; position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 12px; cursor: pointer; border-radius: 2px; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .layout { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 18px; align-items: start; }
    section { border: 1px solid var(--vscode-panel-border); margin-bottom: 14px; padding: 12px; }
    h2 { margin-top: 0; font-size: 16px; }
    h3 { margin: 0 0 8px; font-size: 13px; }
    ul { padding-left: 20px; }
    .critical { color: var(--vscode-errorForeground); font-weight: 700; text-transform: uppercase; }
    .optional-card { border: 1px solid var(--vscode-panel-border); padding: 10px; margin: 10px 0; background: var(--vscode-editor-background); }
    .card-actions { display: flex; gap: 8px; margin-top: 8px; }
    .toggle { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .toggle.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .muted { color: var(--vscode-descriptionForeground); }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid var(--vscode-panel-border); padding: 16px; background: var(--vscode-textCodeBlock-background); min-height: 60vh; }
    .placeholder { color: var(--vscode-errorForeground); font-weight: 800; background: color-mix(in srgb, var(--vscode-errorForeground) 16%, transparent); }
    @media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="edit">Editar campos</button>
    <button id="cancel" class="secondary">Cancelar</button>
  </div>
  <div class="layout">
    <div>
      <section>
        <h2>Campos esenciales pendientes</h2>
        <ul>${essentialItems}</ul>
      </section>
      <section>
        <h2>Campos opcionales vacíos</h2>
        ${optionalCards}
      </section>
      <section>
        <h2>Advertencias del modelo</h2>
        <ul>${warningItems}</ul>
      </section>
    </div>
    <section>
      <h2>Markdown generado</h2>
      <pre id="markdown">${renderMarkdown(markdown)}</pre>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const renderOptions = ${JSON.stringify(initialRenderOptions)};

    function sendPreviewOptions() {
      vscode.postMessage({ command: 'previewOptions', renderOptions });
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

    document.querySelectorAll('[data-optional-key]').forEach((card) => {
      const key = card.getAttribute('data-optional-key');
      card.querySelector('[data-action="keep"]').addEventListener('click', () => {
        renderOptions.omitFields[key] = false;
        card.querySelectorAll('.toggle').forEach((button) => button.classList.remove('active'));
        card.querySelector('[data-action="keep"]').classList.add('active');
        sendPreviewOptions();
      });
      card.querySelector('[data-action="remove"]').addEventListener('click', () => {
        renderOptions.omitFields[key] = true;
        card.querySelectorAll('.toggle').forEach((button) => button.classList.remove('active'));
        card.querySelector('[data-action="remove"]').classList.add('active');
        sendPreviewOptions();
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.command === 'previewMarkdown') {
        document.getElementById('markdown').innerHTML = renderMarkdown(message.markdown);
      }
    });

    document.getElementById('edit').addEventListener('click', () => vscode.postMessage({ command: 'edit' }));
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
  </script>
</body>
</html>`;
}

function optionalCard(field: MissingField): string {
  return `<div class="optional-card" data-optional-key="${escapeAttribute(field.key)}">
    <h3>${escapeHtml(field.label)}</h3>
    <div class="muted">${escapeHtml(field.path)}</div>
    <div class="card-actions">
      <button class="toggle active" data-action="keep">Mantener sección</button>
      <button class="toggle" data-action="remove">Eliminar sección</button>
    </div>
  </div>`;
}

function missingItem(field: MissingField, includePath: boolean): string {
  return `<li><span class="critical">${escapeHtml(field.label)}: RELLENAR POR USUARIO</span>${includePath ? ` <span class="muted">${escapeHtml(field.path)}</span>` : ''}</li>`;
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
