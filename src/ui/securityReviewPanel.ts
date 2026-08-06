import * as vscode from 'vscode';
import { getNonce } from './webviewHtml';

export type AutoSensitiveDisposition = 'redact' | 'exclude';

export interface AutoSensitiveFile {
  path: string;
  suggested: AutoSensitiveDisposition;
  reason: string;
}

export interface SecurityReviewInput {
  autoSensitiveFiles: AutoSensitiveFile[];
  candidateFiles: Array<{ relativePath: string }>;
}

export interface RedactedFile {
  path: string;
  content: string;
  redactionCount: number;
}

/** Lee y redacta los archivos indicados. La provee la extensión (acceso a disco + redactor). */
export type RedactFn = (paths: string[]) => Promise<RedactedFile[]>;

export interface SecurityReviewResult {
  action: 'continue' | 'cancel';
  /** Rutas que NO deben enviarse a ningún modelo. */
  excludePaths: string[];
  /** Contenido final (redactado y, en su caso, editado por el usuario) que sustituye la lectura de disco. */
  redactedFiles: Array<{ path: string; content: string }>;
}

export class SecurityReviewPanel {
  static async show(
    input: SecurityReviewInput,
    extensionUri: vscode.Uri,
    redact: RedactFn
  ): Promise<SecurityReviewResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorSecurityReview',
      'README Generator AI — Protección de datos sensibles',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = buildHtml(input);

    return new Promise<SecurityReviewResult>((resolve) => {
      let resolved = false;
      const finish = (result: SecurityReviewResult): void => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
        panel.dispose();
      };

      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'classify') {
          const redactPaths = toStringArray(message.redactPaths);
          const excludePaths = toStringArray(message.excludePaths);
          if (redactPaths.length === 0) {
            finish({ action: 'continue', excludePaths, redactedFiles: [] });
            return;
          }
          try {
            const files = await redact(redactPaths);
            await panel.webview.postMessage({ type: 'redacted', files, stage1Exclude: excludePaths });
          } catch {
            // Ante un fallo al leer/redactar, cancelar es la opción segura (no se envía nada).
            finish({ action: 'cancel', excludePaths: [], redactedFiles: [] });
          }
        } else if (message.command === 'confirm') {
          finish({
            action: 'continue',
            excludePaths: toStringArray(message.excludePaths),
            redactedFiles: toRedactedFiles(message.redactedFiles)
          });
        } else if (message.command === 'cancel') {
          finish({ action: 'cancel', excludePaths: [], redactedFiles: [] });
        }
      });

      // Cerrar la ventana equivale a cancelar (fail-closed): no se envía nada al modelo.
      panel.onDidDispose(() => {
        if (!resolved) {
          resolved = true;
          resolve({ action: 'cancel', excludePaths: [], redactedFiles: [] });
        }
      });
    });
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toRedactedFiles(value: unknown): Array<{ path: string; content: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((v): v is { path: string; content: string } =>
      v && typeof v.path === 'string' && typeof v.content === 'string')
    .map((v) => ({ path: v.path, content: v.content }));
}

function buildHtml(input: SecurityReviewInput): string {
  const nonce = getNonce();
  // Escapamos "<" para que ningún contenido de repo no confiable rompa el bloque <script>.
  const inputJson = JSON.stringify(input).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Protección de datos sensibles</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
      max-width: 900px;
    }
    h2 { margin-top: 0; margin-bottom: 6px; }
    h3 { margin-top: 0; margin-bottom: 8px; font-size: 1em; }
    .section { margin-bottom: 28px; }
    .section-desc { margin: 0 0 12px 0; line-height: 1.5; color: var(--vscode-descriptionForeground); }
    .hidden { display: none; }
    .note {
      padding: 10px 14px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 3px;
      color: var(--vscode-descriptionForeground);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
    }
    .row .path {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      flex: 1;
      word-break: break-all;
    }
    .row .reason {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 2px;
      padding: 3px 6px;
      font-size: 0.85em;
    }
    details {
      margin-bottom: 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
    }
    summary {
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      font-size: 0.9em;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    summary:hover { background: var(--vscode-list-hoverBackground); }
    .file-list { list-style: none; padding: 4px 12px; margin: 0; }
    .file-list li { padding: 2px 0; }
    .file-list .path { font-size: 0.88em; }
    .review-file {
      margin-bottom: 16px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      overflow: hidden;
    }
    .review-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 14px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .review-header .path { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; font-weight: 600; flex: 1; word-break: break-all; }
    .badge {
      font-size: 0.78em;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      white-space: nowrap;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-textCodeBlock-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.85em;
      line-height: 1.5;
      padding: 10px 14px;
      min-height: 120px;
      max-height: 320px;
      resize: vertical;
    }
    .buttons { display: flex; gap: 10px; margin-top: 8px; }
    button {
      padding: 7px 16px;
      cursor: pointer;
      border: none;
      border-radius: 2px;
      font-size: var(--vscode-font-size);
      font-family: var(--vscode-font-family);
    }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <!-- ETAPA 1: clasificación -->
  <div id="stage1">
    <h2>Protección de datos sensibles</h2>

    <div class="section">
      <h3>Archivos sensibles detectados automáticamente</h3>
      <p class="section-desc" id="autoDesc"></p>
      <div id="autoList"></div>
    </div>

    <div class="section">
      <h3>¿Hay otros archivos que no deban llegar al modelo?</h3>
      <p class="section-desc">
        Estos son los archivos que se enviarán al modelo. Para los que contengan información confidencial,
        elige <strong>Codificar</strong> (se ocultan sus valores) o <strong>No enviar</strong> (se excluyen por completo).
      </p>
      <div id="fileTree"></div>
    </div>

    <div class="buttons">
      <button class="btn-primary" id="btnContinue">Continuar</button>
      <button class="btn-secondary" id="btnCancel1">Cancelar</button>
    </div>
  </div>

  <!-- ETAPA 2: verificación de lo codificado -->
  <div id="stage2" class="hidden">
    <h2>Revisión de los datos codificados</h2>
    <p class="section-desc">
      Estos son los archivos ya codificados, tal y como se enviarían al modelo. Revísalos: puedes editarlos a mano,
      o cambiar a <strong>No enviar</strong> si prefieres excluir alguno. Nada se envía hasta que pulses Confirmar.
    </p>
    <div id="reviewList"></div>
    <div class="buttons">
      <button class="btn-primary" id="btnConfirm">Confirmar y continuar</button>
      <button class="btn-secondary" id="btnCancel2">Cancelar</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const INPUT = ${inputJson};
    const AUTO_PATHS = new Set(INPUT.autoSensitiveFiles.map(function(f) { return f.path; }));
    let stage1Exclude = [];

    // --- ETAPA 1, sección A: sensibles detectados ---
    const autoDesc = document.getElementById('autoDesc');
    const autoList = document.getElementById('autoList');

    if (INPUT.autoSensitiveFiles.length === 0) {
      autoDesc.textContent = 'No se han detectado archivos con patrones sensibles conocidos (.env, claves, credenciales).';
      const box = document.createElement('div');
      box.className = 'note';
      box.textContent = 'Puedes marcar manualmente cualquier archivo en la sección siguiente.';
      autoList.appendChild(box);
    } else {
      autoDesc.textContent = 'Revisa la acción para cada archivo detectado:';
      INPUT.autoSensitiveFiles.forEach(function(file) {
        const row = document.createElement('div');
        row.className = 'row';

        const sel = document.createElement('select');
        sel.className = 'auto-sel';
        sel.setAttribute('data-path', file.path);
        [['redact', 'Codificar'], ['exclude', 'No enviar']].forEach(function(opt) {
          const o = document.createElement('option');
          o.value = opt[0];
          o.textContent = opt[1];
          if (opt[0] === file.suggested) { o.selected = true; }
          sel.appendChild(o);
        });

        const path = document.createElement('span');
        path.className = 'path';
        path.textContent = file.path;

        const reason = document.createElement('span');
        reason.className = 'reason';
        reason.textContent = file.reason;

        row.appendChild(sel);
        row.appendChild(path);
        row.appendChild(reason);
        autoList.appendChild(row);
      });
    }

    // --- ETAPA 1, sección B: resto de candidatos agrupados por directorio ---
    const fileTree = document.getElementById('fileTree');
    const byDir = {};
    INPUT.candidateFiles.forEach(function(file) {
      if (AUTO_PATHS.has(file.relativePath)) { return; }
      const slashIdx = file.relativePath.indexOf('/');
      const dir = slashIdx === -1 ? '(raíz)' : file.relativePath.substring(0, slashIdx);
      if (!byDir[dir]) { byDir[dir] = []; }
      byDir[dir].push(file.relativePath);
    });

    const dirs = Object.keys(byDir).sort();
    if (dirs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'section-desc';
      empty.textContent = 'No hay archivos adicionales disponibles.';
      fileTree.appendChild(empty);
    } else {
      dirs.forEach(function(dir) {
        const paths = byDir[dir];
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = dir + '  (' + paths.length + (paths.length === 1 ? ' archivo)' : ' archivos)');
        details.appendChild(summary);

        const ul = document.createElement('ul');
        ul.className = 'file-list';
        paths.sort().forEach(function(filePath) {
          const li = document.createElement('li');
          const row = document.createElement('div');
          row.className = 'row';

          const sel = document.createElement('select');
          sel.className = 'cand-sel';
          sel.setAttribute('data-path', filePath);
          [['send', 'Enviar'], ['redact', 'Codificar'], ['exclude', 'No enviar']].forEach(function(opt) {
            const o = document.createElement('option');
            o.value = opt[0];
            o.textContent = opt[1];
            sel.appendChild(o);
          });

          const span = document.createElement('span');
          span.className = 'path';
          span.textContent = filePath;

          row.appendChild(sel);
          row.appendChild(span);
          li.appendChild(row);
          ul.appendChild(li);
        });
        details.appendChild(ul);
        fileTree.appendChild(details);
      });
    }

    function collectDispositions() {
      const redactPaths = [];
      const excludePaths = [];
      document.querySelectorAll('.auto-sel, .cand-sel').forEach(function(sel) {
        const p = sel.getAttribute('data-path');
        if (sel.value === 'redact') { redactPaths.push(p); }
        else if (sel.value === 'exclude') { excludePaths.push(p); }
      });
      return { redactPaths: redactPaths, excludePaths: excludePaths };
    }

    document.getElementById('btnContinue').addEventListener('click', function() {
      const d = collectDispositions();
      stage1Exclude = d.excludePaths;
      vscode.postMessage({ command: 'classify', redactPaths: d.redactPaths, excludePaths: d.excludePaths });
    });
    document.getElementById('btnCancel1').addEventListener('click', function() {
      vscode.postMessage({ command: 'cancel' });
    });

    // --- ETAPA 2: render de lo codificado ---
    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (!msg || msg.type !== 'redacted') { return; }
      stage1Exclude = Array.isArray(msg.stage1Exclude) ? msg.stage1Exclude : stage1Exclude;
      renderReview(msg.files || []);
      document.getElementById('stage1').classList.add('hidden');
      document.getElementById('stage2').classList.remove('hidden');
      window.scrollTo(0, 0);
    });

    function renderReview(files) {
      const list = document.getElementById('reviewList');
      list.textContent = '';
      files.forEach(function(file) {
        const wrapper = document.createElement('div');
        wrapper.className = 'review-file';

        const header = document.createElement('div');
        header.className = 'review-header';

        const sel = document.createElement('select');
        sel.className = 's2-action';
        sel.setAttribute('data-path', file.path);
        [['send', 'Enviar'], ['exclude', 'No enviar']].forEach(function(opt) {
          const o = document.createElement('option');
          o.value = opt[0];
          o.textContent = opt[1];
          sel.appendChild(o);
        });

        const path = document.createElement('span');
        path.className = 'path';
        path.textContent = file.path;

        const badge = document.createElement('span');
        badge.className = 'badge';
        const n = file.redactionCount || 0;
        badge.textContent = n === 1 ? '1 valor codificado' : n + ' valores codificados';

        header.appendChild(sel);
        header.appendChild(path);
        header.appendChild(badge);

        const textarea = document.createElement('textarea');
        textarea.className = 's2-content';
        textarea.setAttribute('data-path', file.path);
        textarea.value = file.content;

        wrapper.appendChild(header);
        wrapper.appendChild(textarea);
        list.appendChild(wrapper);
      });
    }

    document.getElementById('btnConfirm').addEventListener('click', function() {
      const redactedFiles = [];
      const excludeSet = {};
      stage1Exclude.forEach(function(p) { excludeSet[p] = true; });

      document.querySelectorAll('.s2-action').forEach(function(sel) {
        const p = sel.getAttribute('data-path');
        if (sel.value === 'exclude') {
          excludeSet[p] = true;
        } else {
          const ta = document.querySelector('.s2-content[data-path="' + cssEscape(p) + '"]');
          redactedFiles.push({ path: p, content: ta ? ta.value : '' });
        }
      });

      vscode.postMessage({
        command: 'confirm',
        redactedFiles: redactedFiles,
        excludePaths: Object.keys(excludeSet)
      });
    });
    document.getElementById('btnCancel2').addEventListener('click', function() {
      vscode.postMessage({ command: 'cancel' });
    });

    function cssEscape(value) {
      return String(value).replace(/["\\\\]/g, '\\\\$&');
    }
  </script>
</body>
</html>`;
}
