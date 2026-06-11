import * as vscode from 'vscode';
import { RelevantUnreadFile } from '../types';
import { UnreadFileInfo } from '../prompt/promptBuilder';

interface PanelFileData {
  path: string;
  nanoReason: string;
  estimatedTokens: number;
  missingTopics: string[];
  recommended: boolean;
}

export interface BudgetWarningResult {
  action: 'expand' | 'continue';
  selectedPaths: string[];
}

export class BudgetWarningPanel {
  static async show(
    unreadFiles: UnreadFileInfo[],
    relevantUnreadFiles: RelevantUnreadFile[],
    inputCostPerToken: number | null,
    extensionUri: vscode.Uri
  ): Promise<BudgetWarningResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorBudgetWarning',
      'README Generator AI — Archivos no leídos',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    const relevantMap = new Map(relevantUnreadFiles.map((f) => [f.path, f.missingTopics]));
    const panelData: PanelFileData[] = unreadFiles
      .map((f) => ({
        path: f.path,
        nanoReason: f.nanoReason,
        estimatedTokens: f.estimatedTokens,
        missingTopics: relevantMap.get(f.path) ?? [],
        recommended: relevantMap.has(f.path)
      }))
      .sort((a, b) => {
        if (a.recommended !== b.recommended) {
          return a.recommended ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
      });

    panel.webview.html = buildHtml(panelData, inputCostPerToken);

    return new Promise<BudgetWarningResult>((resolve) => {
      let resolved = false;

      const doResolve = (result: BudgetWarningResult): void => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      panel.webview.onDidReceiveMessage((message) => {
        panel.dispose();
        if (message.command === 'expand' && Array.isArray(message.selectedPaths) && message.selectedPaths.length > 0) {
          doResolve({ action: 'expand', selectedPaths: message.selectedPaths as string[] });
        } else {
          doResolve({ action: 'continue', selectedPaths: [] });
        }
      });

      panel.onDidDispose(() => {
        doResolve({ action: 'continue', selectedPaths: [] });
      });
    });
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars[Math.floor(Math.random() * chars.length)];
  }
  return text;
}

function buildHtml(files: PanelFileData[], inputCostPerToken: number | null): string {
  const nonce = getNonce();
  const filesJson = JSON.stringify(files);
  const costParam = inputCostPerToken === null ? 'null' : String(inputCostPerToken);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Archivos no leídos</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
      max-width: 820px;
    }
    h2 { margin-top: 0; margin-bottom: 8px; }
    .description { margin-bottom: 20px; line-height: 1.5; color: var(--vscode-descriptionForeground); }
    .file-list {
      list-style: none;
      padding: 0;
      margin: 0 0 16px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
    }
    .file-item {
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .file-item:last-child { border-bottom: none; }
    .file-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .file-header input[type="checkbox"] {
      cursor: pointer;
      flex-shrink: 0;
      width: 14px;
      height: 14px;
    }
    .file-path {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
    }
    .badge-recommended {
      font-size: 0.72em;
      padding: 2px 7px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      white-space: nowrap;
    }
    .file-topics {
      font-size: 0.85em;
      color: var(--vscode-foreground);
      margin-left: 24px;
    }
    .file-nano-reason {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-left: 24px;
      font-style: italic;
    }
    .file-meta {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-left: 24px;
    }
    .total-box {
      padding: 10px 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 3px;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .buttons { display: flex; gap: 10px; }
    button {
      padding: 7px 14px;
      cursor: pointer;
      border: none;
      border-radius: 2px;
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <h2>Archivos no leídos por presupuesto de tokens</h2>
  <p class="description">
    El modelo principal no pudo leer todos los archivos relevantes por límite de tokens.
    Los archivos marcados como <strong>recomendado</strong> son los que el modelo considera que podrían completar campos que quedaron vacíos.
    Selecciona los que deseas incluir en una segunda lectura:
  </p>

  <ul class="file-list" id="fileList"></ul>
  <div class="total-box" id="totalBox">Total seleccionado: 0 tokens</div>

  <div class="buttons">
    <button class="btn-primary" id="btnExpand" disabled>Sí, leer archivos adicionales</button>
    <button class="btn-secondary" id="btnContinue">No, continuar con la selección actual</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const FILES = ${filesJson};
    const INPUT_COST_PER_TOKEN = ${costParam};

    function formatCost(tokens) {
      if (INPUT_COST_PER_TOKEN === null || tokens === 0) { return ''; }
      const cost = tokens * INPUT_COST_PER_TOKEN;
      return ' · ~\\u20ac' + cost.toFixed(4);
    }

    const list = document.getElementById('fileList');

    FILES.forEach(function(file) {
      const li = document.createElement('li');
      li.className = 'file-item';

      const header = document.createElement('div');
      header.className = 'file-header';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = file.path;
      cb.checked = file.recommended;
      cb.id = 'cb-' + file.path;
      cb.addEventListener('change', updateTotal);

      const pathSpan = document.createElement('span');
      pathSpan.className = 'file-path';
      pathSpan.textContent = file.path;

      header.appendChild(cb);
      header.appendChild(pathSpan);

      if (file.recommended) {
        const badge = document.createElement('span');
        badge.className = 'badge-recommended';
        badge.textContent = 'recomendado';
        header.appendChild(badge);
      }

      li.appendChild(header);

      if (file.missingTopics && file.missingTopics.length > 0) {
        const topics = document.createElement('div');
        topics.className = 'file-topics';
        topics.textContent = 'Información relevante: ' + file.missingTopics.join(', ');
        li.appendChild(topics);
      }

      if (file.nanoReason) {
        const reason = document.createElement('div');
        reason.className = 'file-nano-reason';
        reason.textContent = file.nanoReason;
        li.appendChild(reason);
      }

      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = '~' + file.estimatedTokens.toLocaleString('es-ES') + ' tokens estimados' + formatCost(file.estimatedTokens);
      li.appendChild(meta);

      list.appendChild(li);
    });

    function updateTotal() {
      const checked = document.querySelectorAll('#fileList input[type="checkbox"]:checked');
      let total = 0;
      checked.forEach(function(cb) {
        const file = FILES.find(function(f) { return f.path === cb.value; });
        if (file) { total += file.estimatedTokens; }
      });

      const btnExpand = document.getElementById('btnExpand');
      btnExpand.disabled = checked.length === 0;

      const costStr = formatCost(total);
      document.getElementById('totalBox').textContent =
        'Total seleccionado: ' + total.toLocaleString('es-ES') + ' tokens' + costStr;
    }

    updateTotal();

    document.getElementById('btnExpand').addEventListener('click', function() {
      const selected = Array.from(document.querySelectorAll('#fileList input[type="checkbox"]:checked'))
        .map(function(cb) { return cb.value; });
      if (selected.length > 0) {
        vscode.postMessage({ command: 'expand', selectedPaths: selected });
      }
    });

    document.getElementById('btnContinue').addEventListener('click', function() {
      vscode.postMessage({ command: 'continue' });
    });
  </script>
</body>
</html>`;
}
