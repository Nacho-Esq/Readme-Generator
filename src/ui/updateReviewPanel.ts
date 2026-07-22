import * as vscode from 'vscode';
import { PanelKind } from '../template/templateSpec';
import { FieldChange, UpdatePlan } from '../readme/updatePlanner';

// Decisión del usuario para un campo cambiado:
//  - 'accept': aplicar el valor propuesto por el actualizador.
//  - 'keep':   mantener lo que el README dice ahora (no se toca).
//  - 'edit':   aplicar un valor editado a mano (en `value`).
export interface ResolvedChange {
  path: string;
  decision: 'accept' | 'keep' | 'edit';
  value?: unknown;
}

export type UpdateResult =
  | { action: 'save'; resolved: ResolvedChange[] }
  | { action: 'cancel' };

// Genera el Markdown reconciliado a partir de las decisiones actuales (llamada al
// modelo). El panel la invoca bajo demanda con el botón "Previsualizar README".
type ReconcilePreview = (resolved: ResolvedChange[]) => Promise<string>;

interface CardData {
  path: string;
  key: string;
  label: string;
  section: string;
  panelKind: PanelKind;
  oldText: string;
  newText: string;
  reason: string;
}

export class UpdateReviewPanel {
  static show(
    plan: UpdatePlan,
    extensionUri: vscode.Uri,
    readmeFileName: string,
    reconcilePreview: ReconcilePreview
  ): Promise<UpdateResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorAiUpdate',
      'README Update',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        panel.webview.html = getUpdateHtml(panel.webview, plan, readmeFileName);
      } catch (error) {
        resolved = true;
        reject(error);
        return;
      }

      const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        try {
          if (message?.command === 'preview') {
            const markdown = await reconcilePreview(message.resolved as ResolvedChange[]);
            await panel.webview.postMessage({ command: 'previewMarkdown', markdown });
          }
          if (message?.command === 'save') {
            cleanup({ action: 'save', resolved: message.resolved as ResolvedChange[] });
          }
          if (message?.command === 'cancel') {
            cleanup({ action: 'cancel' });
          }
        } catch (error) {
          await panel.webview.postMessage({
            command: 'previewError',
            message: error instanceof Error ? error.message : String(error)
          });
        }
      });

      panel.onDidDispose(() => {
        subscription.dispose();
        if (!resolved) {
          resolved = true;
          resolve({ action: 'cancel' });
        }
      });

      function cleanup(result: UpdateResult): void {
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

function getUpdateHtml(webview: vscode.Webview, plan: UpdatePlan, readmeFileName: string): string {
  const nonce = getNonce();
  const cards: CardData[] = plan.changes.map((change) => ({
    path: change.path,
    key: change.key,
    label: change.label,
    section: change.section,
    panelKind: change.panelKind,
    oldText: typeof change.oldValue === 'string' ? change.oldValue : formatValue(change.oldValue, change.panelKind),
    newText: formatValue(change.newValue, change.panelKind),
    reason: change.reason
  }));

  const cardsHtml = cards.map((card) => cardHtml(card)).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>README Update</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .toolbar { display: flex; gap: 8px; align-items: center; position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
    .toolbar .spacer { flex: 1; }
    .summary { font-size: 13px; color: var(--vscode-descriptionForeground); }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 12px; cursor: pointer; border-radius: 2px; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .card { border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-panel-border); margin: 14px 0; padding: 12px 14px; }
    .card[data-state="keep"] { border-left-color: var(--vscode-descriptionForeground); opacity: 0.75; }
    .card[data-state="accept"] { border-left-color: var(--vscode-charts-green, #388a34); }
    .card[data-state="edit"] { border-left-color: var(--vscode-charts-blue, #007acc); }
    .card-head { display: flex; justify-content: space-between; align-items: start; gap: 10px; margin-bottom: 10px; }
    .section-prefix { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .label { font-weight: 600; margin-top: 2px; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
    .badge.nuevo { color: var(--vscode-editorInfo-foreground, #3794ff); border: 1px solid var(--vscode-editorInfo-foreground, #3794ff); }
    .badge.actualizado { color: var(--vscode-editorWarning-foreground, #cca700); border: 1px solid var(--vscode-editorWarning-foreground, #cca700); }
    .reason { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .cols.single { grid-template-columns: 1fr; }
    .box { border: 1px solid var(--vscode-panel-border); padding: 8px 10px; background: var(--vscode-textCodeBlock-background); }
    .box .box-title { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .box pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    .seg { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 3px; overflow: hidden; }
    .seg button { background: var(--vscode-editor-background); color: var(--vscode-foreground); border: 0; border-left: 1px solid var(--vscode-panel-border); padding: 6px 12px; font-size: 12px; }
    .seg button:first-child { border-left: 0; }
    .seg button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    textarea { width: 100%; box-sizing: border-box; margin-top: 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; font-family: var(--vscode-editor-font-family); min-height: 72px; resize: vertical; }
    textarea.hidden { display: none; }
    .edit-hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); font-size: 13px; }
    .preview-wrap { margin-top: 16px; }
    pre.preview { white-space: pre-wrap; word-break: break-word; border: 1px solid var(--vscode-panel-border); padding: 16px; background: var(--vscode-textCodeBlock-background); min-height: 40vh; }
    .preview-status { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 6px 0; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="save">Guardar en ${escapeHtml(readmeFileName)}</button>
    <button id="preview" class="secondary">Previsualizar README</button>
    <button id="cancel" class="secondary">Cancelar</button>
    <span class="spacer"></span>
    <span class="summary">${plan.changes.length} ${plan.changes.length === 1 ? 'campo con información nueva' : 'campos con información nueva'}</span>
  </div>

  <p class="muted">Todos los cambios están <strong>aceptados por defecto</strong>: si guardas sin revisar, se aplica la propuesta completa. Usa <em>Mantener</em> para conservar lo que el README dice ahora, o <em>Editar</em> para ajustar el valor propuesto.</p>

  ${cardsHtml || '<p class="muted">No hay cambios que revisar.</p>'}

  <div class="footer">
    <p class="muted">El resto del README (incluidos los campos sin información nueva y los datos escritos por personas) se conserva intacto.</p>
  </div>

  <div class="preview-wrap">
    <div class="preview-status" id="preview-status"></div>
    <pre class="preview" id="preview-output" style="display:none;"></pre>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const cards = ${embedJson(cards)};
    const byPath = {};
    cards.forEach((c) => { byPath[c.key] = c; });

    function parseValue(kind, raw) {
      const linesArr = raw.split('\\n').map((l) => l.trim()).filter(Boolean);
      if (kind === 'list') {
        return linesArr;
      }
      if (kind === 'env') {
        return linesArr.map((line) => {
          const i = line.indexOf(':');
          if (i === -1) {
            return { name: line, description: '' };
          }
          return { name: line.slice(0, i).trim(), description: line.slice(i + 1).trim() };
        }).filter((x) => x.name);
      }
      return raw.trim();
    }

    function collect() {
      return cards.map((card) => {
        const el = document.querySelector('[data-card="' + card.key + '"]');
        const decision = el.getAttribute('data-state');
        if (decision === 'edit') {
          const textarea = el.querySelector('textarea');
          return { path: card.path, decision: 'edit', value: parseValue(card.panelKind, textarea.value) };
        }
        return { path: card.path, decision: decision };
      });
    }

    function setState(key, decision) {
      const el = document.querySelector('[data-card="' + key + '"]');
      el.setAttribute('data-state', decision);
      el.querySelectorAll('.seg button').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-decision') === decision);
      });
      const textarea = el.querySelector('textarea');
      if (textarea) {
        textarea.classList.toggle('hidden', decision !== 'edit');
      }
    }

    document.querySelectorAll('.seg button').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.closest('.card').getAttribute('data-card');
        setState(key, button.getAttribute('data-decision'));
      });
    });

    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({ command: 'save', resolved: collect() });
    });
    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });
    document.getElementById('preview').addEventListener('click', () => {
      const status = document.getElementById('preview-status');
      status.textContent = 'Generando previsualización…';
      vscode.postMessage({ command: 'preview', resolved: collect() });
    });

    function escapeHtml(value) {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.command === 'previewMarkdown') {
        document.getElementById('preview-status').textContent = 'Previsualización del README resultante:';
        const output = document.getElementById('preview-output');
        output.style.display = 'block';
        output.textContent = message.markdown;
      }
      if (message?.command === 'previewError') {
        document.getElementById('preview-status').textContent = 'No se pudo generar la previsualización: ' + message.message;
      }
    });
  </script>
</body>
</html>`;
}

function cardHtml(card: CardData): string {
  const oldBox = card.oldText.trim()
    ? `<div class="box">
        <div class="box-title">Antes (tu README)</div>
        <pre>${escapeHtml(card.oldText)}</pre>
      </div>`
    : `<div class="box">
        <div class="box-title">Antes (tu README)</div>
        <pre class="muted">(el modelo no localizó el valor actual)</pre>
      </div>`;

  const reason = card.reason.trim()
    ? `<div class="reason"><strong>Motivo:</strong> ${escapeHtml(card.reason)}</div>`
    : '';

  return `<div class="card" data-card="${escapeAttribute(card.key)}" data-state="accept">
    <div class="card-head">
      <div>
        <div class="section-prefix">${escapeHtml(card.section)}</div>
        <div class="label">${escapeHtml(card.label)}</div>
      </div>
      <span class="badge actualizado">Información nueva</span>
    </div>
    ${reason}
    <div class="cols">
      ${oldBox}
      <div class="box">
        <div class="box-title">Ahora (propuesto)</div>
        <pre>${escapeHtml(card.newText)}</pre>
      </div>
    </div>
    <div class="seg">
      <button data-decision="keep">Mantener</button>
      <button data-decision="accept" class="active">Aceptar</button>
      <button data-decision="edit">Editar</button>
    </div>
    <div class="edit-hint">${escapeHtml(editHint(card.panelKind))}</div>
    <textarea class="hidden">${escapeHtml(card.newText)}</textarea>
  </div>`;
}

function editHint(kind: PanelKind): string {
  if (kind === 'env') {
    return 'Editando el valor propuesto. Una variable por línea: NOMBRE: descripción';
  }
  if (kind === 'list') {
    return 'Editando el valor propuesto. Un elemento por línea.';
  }
  return 'Editando el valor propuesto.';
}

function formatValue(value: unknown, kind: PanelKind): string {
  if (kind === 'env' && Array.isArray(value)) {
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
    return value.map((item) => String(item)).join('\n');
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

// Serializa datos para incrustarlos dentro de un <script>. JSON.stringify no
// escapa `<`, así que un valor con `</script>` (posible en texto del repo o del
// README) rompería el bloque; escapamos `<` como <.
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
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
