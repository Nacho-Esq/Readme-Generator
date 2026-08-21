import * as vscode from 'vscode';
import { UnreadFileInfo } from '../prompt/promptBuilder';
import { getNonce } from './webviewHtml';

interface PanelFileData {
  path: string;
  nanoReason: string;
  estimatedTokens: number;
}

export interface BudgetWarningResult {
  action: 'expand' | 'continue';
  selectedPaths: string[];
}

export class BudgetWarningPanel {
  static async show(
    overflowFiles: UnreadFileInfo[],
    inputCostPerToken: number | null,
    extensionUri: vscode.Uri
  ): Promise<BudgetWarningResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorBudgetWarning',
      'CAI Readme-Generator — Archivos fuera del presupuesto',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    const panelData: PanelFileData[] = overflowFiles.map((f) => ({
      path: f.path,
      nanoReason: f.nanoReason,
      estimatedTokens: f.estimatedTokens
    }));

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
        if (message.command === 'expand' && Array.isArray(message.selectedPaths) && message.selectedPaths.length > 0) {
          doResolve({ action: 'expand', selectedPaths: message.selectedPaths as string[] });
        } else {
          doResolve({ action: 'continue', selectedPaths: [] });
        }
        panel.dispose();
      });

      panel.onDidDispose(() => {
        doResolve({ action: 'continue', selectedPaths: [] });
      });
    });
  }
}

function buildHtml(files: PanelFileData[], inputCostPerToken: number | null): string {
  const nonce = getNonce();
  // Escapamos "<" para que ninguna ruta o razón del nano rompa el bloque <script>.
  const filesJson = JSON.stringify(files).replace(/</g, '\\u003c');
  const costParam = inputCostPerToken === null ? 'null' : String(inputCostPerToken);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Archivos fuera del presupuesto</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 28px 32px;
      max-width: 860px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 1.3em;
      font-weight: 600;
    }
    .description {
      margin: 0;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .bulk-actions {
      display: flex;
      gap: 8px;
    }
    .link-btn {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      padding: 4px 6px;
      font-size: 0.85em;
      font-family: var(--vscode-font-family);
      border-radius: 2px;
    }
    .link-btn:hover:not(:disabled) {
      color: var(--vscode-textLink-activeForeground);
      background: var(--vscode-toolbar-hoverBackground, transparent);
      text-decoration: underline;
    }
    .link-btn:disabled {
      color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
      cursor: not-allowed;
    }
    .file-count {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .file-list {
      list-style: none;
      padding: 0;
      margin: 0 0 18px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      max-height: 420px;
      overflow-y: auto;
    }
    .file-item {
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .file-item:last-child { border-bottom: none; }
    .file-item:hover { background: var(--vscode-list-hoverBackground); }
    .file-item.is-checked { background: var(--vscode-list-inactiveSelectionBackground); }
    .file-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .file-header input[type="checkbox"] {
      cursor: pointer;
      flex-shrink: 0;
      width: 15px;
      height: 15px;
      accent-color: var(--vscode-button-background);
    }
    .file-path {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      overflow-wrap: anywhere;
    }
    .file-nano-reason {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-left: 25px;
      font-style: italic;
    }
    .file-meta {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-left: 25px;
    }
    .empty-state {
      padding: 20px 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .total-box {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      margin-bottom: 22px;
    }
    .total-label {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .total-value {
      font-weight: 600;
      font-size: 1.05em;
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
    .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <header>
    <h2>Archivos fuera del presupuesto de tokens</h2>
    <p class="description">
      El modelo de selección ha identificado más archivos relevantes de los que caben en el presupuesto configurado.
      Los archivos aparecen ordenados por importancia según el análisis del modelo.
      Selecciona los que deseas incluir en la lectura:
    </p>
  </header>

  <div class="toolbar">
    <div class="bulk-actions">
      <button class="link-btn" id="btnSelectAll" type="button">Añadir todo</button>
      <button class="link-btn" id="btnSelectNone" type="button">Quitar todo</button>
    </div>
    <span class="file-count" id="fileCount"></span>
  </div>

  <ul class="file-list" id="fileList"></ul>

  <div class="total-box">
    <span class="total-label">Total seleccionado</span>
    <span class="total-value" id="totalValue">0 tokens</span>
  </div>

  <div class="buttons">
    <button class="btn-primary" id="btnExpand" disabled>Sí, incluir archivos adicionales</button>
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
    const fileCountEl = document.getElementById('fileCount');

    if (FILES.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No hay archivos adicionales fuera del presupuesto.';
      list.appendChild(empty);
    }

    fileCountEl.textContent = FILES.length === 1 ? '1 archivo' : FILES.length + ' archivos';

    function setItemCheckedClass(cb) {
      const li = cb.closest('.file-item');
      if (li) { li.classList.toggle('is-checked', cb.checked); }
    }

    FILES.forEach(function(file) {
      const li = document.createElement('li');
      li.className = 'file-item';

      const header = document.createElement('div');
      header.className = 'file-header';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = file.path;
      cb.checked = false;
      cb.id = 'cb-' + file.path;
      cb.addEventListener('change', function() {
        setItemCheckedClass(cb);
        updateTotal();
      });

      const pathSpan = document.createElement('span');
      pathSpan.className = 'file-path';
      pathSpan.textContent = file.path;

      header.appendChild(cb);
      header.appendChild(pathSpan);
      li.appendChild(header);

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
      const allCheckboxes = document.querySelectorAll('#fileList input[type="checkbox"]');
      const checked = document.querySelectorAll('#fileList input[type="checkbox"]:checked');
      let total = 0;
      checked.forEach(function(cb) {
        const file = FILES.find(function(f) { return f.path === cb.value; });
        if (file) { total += file.estimatedTokens; }
      });

      const btnExpand = document.getElementById('btnExpand');
      btnExpand.disabled = checked.length === 0;

      const btnSelectAll = document.getElementById('btnSelectAll');
      const btnSelectNone = document.getElementById('btnSelectNone');
      btnSelectAll.disabled = allCheckboxes.length > 0 && checked.length === allCheckboxes.length;
      btnSelectNone.disabled = checked.length === 0;

      document.getElementById('totalValue').textContent =
        total.toLocaleString('es-ES') + ' tokens' + formatCost(total);
    }

    function setAllChecked(value) {
      document.querySelectorAll('#fileList input[type="checkbox"]').forEach(function(cb) {
        cb.checked = value;
        setItemCheckedClass(cb);
      });
      updateTotal();
    }

    document.getElementById('btnSelectAll').addEventListener('click', function() {
      setAllChecked(true);
    });

    document.getElementById('btnSelectNone').addEventListener('click', function() {
      setAllChecked(false);
    });

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
