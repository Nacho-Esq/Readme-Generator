import * as vscode from 'vscode';

type PreviewAction = 'edit' | 'cancel';

export class PreviewPanel {
  static show(markdown: string, warnings: string[], extensionUri: vscode.Uri): Promise<PreviewAction> {
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

      try {
        panel.webview.html = getPreviewHtml(panel.webview, markdown, warnings);
      } catch (error) {
        resolved = true;
        reject(error);
        return;
      }

      const subscription = panel.webview.onDidReceiveMessage((message) => {
        if (message?.command === 'edit') {
          cleanup('edit');
        }
        if (message?.command === 'cancel') {
          cleanup('cancel');
        }
      });

      panel.onDidDispose(() => {
        subscription.dispose();
        if (!resolved) {
          resolved = true;
          resolve('cancel');
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

function getPreviewHtml(webview: vscode.Webview, markdown: string, warnings: string[]): string {
  const nonce = getNonce();
  const warningItems = warnings.length
    ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
    : '<li>No hay advertencias del modelo.</li>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>README Preview</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .toolbar { display: flex; gap: 8px; position: sticky; top: 0; background: var(--vscode-editor-background); padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 12px; cursor: pointer; border-radius: 2px; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    section { margin-top: 16px; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid var(--vscode-panel-border); padding: 16px; background: var(--vscode-textCodeBlock-background); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="edit">Editar campos</button>
    <button id="cancel" class="secondary">Cancelar</button>
  </div>
  <section>
    <h2>Advertencias</h2>
    <ul>${warningItems}</ul>
  </section>
  <section>
    <h2>Markdown generado</h2>
    <pre>${escapeHtml(markdown)}</pre>
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('edit').addEventListener('click', () => vscode.postMessage({ command: 'edit' }));
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
