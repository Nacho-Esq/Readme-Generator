import * as vscode from 'vscode';

// Paso 5 del actualizador — panel de revisión. Muestra las PROPUESTAS del Paso 4 (una
// tarjeta por campo) y deja al humano decidir por cada una: aceptar el cambio, mantener
// lo antiguo, o editar. Los botones (verde/rojo/amarillo) van arriba a la derecha de la
// tarjeta; al elegir, se resalta con ese color el cuadro afectado.

export interface UpdateCard {
  path: string;
  label: string;
  section: string;
  panelKind: 'text' | 'list' | 'env';
  recommendation: 'update' | 'remove';
  currentText: string;
  proposedText: string;
  reason: string;
}

export interface ResolvedChange {
  path: string;
  decision: 'accept' | 'keep' | 'edit';
  value?: string; // texto editado (solo si decision === 'edit')
}

export type UpdateResult =
  | { action: 'save'; resolved: ResolvedChange[] }
  | { action: 'cancel' };

export class UpdateReviewPanel {
  static async show(
    cards: UpdateCard[],
    _extensionUri: vscode.Uri,
    readmeFileName: string
  ): Promise<UpdateResult> {
    const panel = vscode.window.createWebviewPanel(
      'readmeGeneratorAiUpdateReview',
      'README Update — Revisión de cambios',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = buildHtml(cards, readmeFileName);

    return new Promise<UpdateResult>((resolve) => {
      let resolved = false;
      const doResolve = (result: UpdateResult): void => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      panel.webview.onDidReceiveMessage((message) => {
        if (message?.command === 'save' && Array.isArray(message.resolved)) {
          doResolve({ action: 'save', resolved: message.resolved as ResolvedChange[] });
          panel.dispose();
        } else if (message?.command === 'cancel') {
          doResolve({ action: 'cancel' });
          panel.dispose();
        }
      });

      panel.onDidDispose(() => doResolve({ action: 'cancel' }));
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

function buildHtml(cards: UpdateCard[], readmeFileName: string): string {
  const nonce = getNonce();
  const cardsJson = JSON.stringify(cards).replace(/</g, '\\u003c');
  const fileName = readmeFileName.replace(/</g, '&lt;');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Revisión de cambios</title>
  <style>
    :root {
      --accept: #2da44e; --accept-dim: rgba(45,164,78,0.14);
      --keep: #e5534b; --keep-dim: rgba(229,83,75,0.14);
      --edit: #d29922; --edit-dim: rgba(210,153,34,0.16);
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px; max-width: 940px;
    }
    h2 { margin: 0 0 6px 0; }
    .intro { margin-bottom: 18px; line-height: 1.5; color: var(--vscode-descriptionForeground); }

    .toolbar { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .toolbar .bulk { display: flex; gap: 6px; }
    .toolbar .filter { display: flex; gap: 4px; align-items: center; margin-left: auto; }
    .filter-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-right: 4px; }
    .filter-btn { padding: 4px 10px; border-radius: 5px; cursor: pointer; font-size: 0.8em; border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); }
    .filter-btn.active { background: var(--vscode-button-secondaryBackground); border-color: var(--vscode-button-secondaryBackground); }

    .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 14px 16px; margin-bottom: 14px; }
    .card-head { display: flex; gap: 12px; justify-content: space-between; align-items: start; margin-bottom: 8px; }
    .head-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .label { font-weight: 600; font-size: 1.02em; }
    .section { font-size: 0.78em; color: var(--vscode-descriptionForeground); }
    .badge { font-size: 0.72em; padding: 2px 9px; border-radius: 10px; border: 1px solid; }
    .badge-remove { color: var(--keep); border-color: var(--keep); background: var(--keep-dim); }
    .badge-update { color: var(--edit); border-color: var(--edit); background: var(--edit-dim); }

    .head-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .dec-btn { padding: 5px 11px; border-radius: 5px; cursor: pointer; font-size: 0.82em; font-weight: 600; border: 1px solid; background: transparent; }
    .dec-accept { color: var(--accept); border-color: var(--accept); }
    .dec-keep   { color: var(--keep);   border-color: var(--keep); }
    .dec-edit   { color: var(--edit);   border-color: var(--edit); }
    .card.mode-accept .dec-accept { background: var(--accept); color: #fff; }
    .card.mode-keep   .dec-keep   { background: var(--keep);   color: #fff; }
    .card.mode-edit   .dec-edit   { background: var(--edit);   color: #fff; }

    .reason { color: var(--vscode-descriptionForeground); margin-bottom: 10px; line-height: 1.4; }
    .values { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .val-title { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
    .val-body {
      margin: 0; padding: 8px 10px; border-radius: 4px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-inactiveSelectionBackground));
      white-space: pre-wrap; word-break: break-word;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em;
      max-height: 240px; overflow: auto; border: 2px solid transparent;
    }
    .val-body.removed { color: var(--keep); font-style: italic; }
    /* Resalta el cuadro afectado según la decisión */
    .card.mode-keep   .cur .val-body  { border-color: var(--keep);   background: var(--keep-dim); }
    .card.mode-accept .prop .val-body { border-color: var(--accept); background: var(--accept-dim); }

    .edit-wrap { grid-column: 1 / -1; display: none; }
    .card.mode-edit .edit-wrap { display: block; }
    .edit-wrap textarea {
      width: 100%; min-height: 92px; box-sizing: border-box;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 2px solid var(--edit); border-radius: 4px; padding: 8px; resize: vertical;
    }
    .edit-hint { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-top: 3px; }

    .card-foot { display: flex; justify-content: flex-end; margin-top: 12px; }
    .confirm-btn { padding: 6px 16px; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 0.85em; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .confirm-btn:hover { background: var(--vscode-button-hoverBackground); }
    .all-confirmed { color: var(--vscode-descriptionForeground); padding: 10px 0 4px; }

    .bar {
      position: sticky; bottom: 0; background: var(--vscode-editor-background);
      padding-top: 14px; margin-top: 8px; border-top: 1px solid var(--vscode-panel-border);
      display: flex; gap: 10px; align-items: center;
    }
    .bar .summary { margin-right: auto; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .summary b.g { color: var(--accept); } .summary b.r { color: var(--keep); }
    button.act { padding: 7px 14px; cursor: pointer; border: none; border-radius: 3px; font-size: var(--vscode-font-size); font-family: var(--vscode-font-family); }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style>
</head>
<body>
  <h2>Revisar cambios en ${fileName}</h2>
  <p class="intro">
    Estas son las diferencias detectadas entre el README y el código. Por cada una, elige
    <b>Aceptar cambio</b>, <b>Mantener antiguo</b> o <b>Editar</b>. El cuadro afectado se resalta con el color de tu elección.
  </p>

  <div class="toolbar">
    <div class="bulk">
      <button class="dec-btn dec-accept" id="bulkAccept">Aceptar todo</button>
      <button class="dec-btn dec-keep" id="bulkKeep">Mantener todo</button>
    </div>
    <div class="filter">
      <span class="filter-label">Ver:</span>
      <button class="filter-btn active" data-filter="all">Todos</button>
      <button class="filter-btn" data-filter="update">Solo actualizar</button>
      <button class="filter-btn" data-filter="remove">Solo quitar</button>
    </div>
  </div>

  <div id="cards"></div>
  <div id="allConfirmed" class="all-confirmed" style="display:none">Todos los campos revisados. Pulsa «Guardar cambios».</div>

  <div class="bar">
    <span class="summary" id="summary"></span>
    <button class="act btn-secondary" id="btnCancel">Cancelar</button>
    <button class="act btn-primary" id="btnSave">Guardar cambios</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const CARDS = ${cardsJson};
    const container = document.getElementById('cards');
    const confirmed = new Set();

    function hintFor(panelKind) {
      if (panelKind === 'list') { return 'Un elemento por línea.'; }
      if (panelKind === 'env') { return 'Una variable por línea, formato "NOMBRE: descripción".'; }
      return '';
    }

    CARDS.forEach(function(card, i) {
      const isRemove = card.recommendation === 'remove';

      const el = document.createElement('div');
      el.className = 'card mode-accept';
      el.id = 'card-' + i;

      const head = document.createElement('div');
      head.className = 'card-head';

      const left = document.createElement('div');
      left.className = 'head-left';
      const label = document.createElement('span'); label.className = 'label'; label.textContent = card.label;
      const section = document.createElement('span'); section.className = 'section'; section.textContent = card.section;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (isRemove ? 'badge-remove' : 'badge-update');
      badge.textContent = isRemove ? 'El código no respalda esto' : 'El código dice algo distinto';
      left.appendChild(label); left.appendChild(section); left.appendChild(badge);

      const acts = document.createElement('div');
      acts.className = 'head-actions';
      [['accept', isRemove ? 'Quitar dato' : 'Aceptar cambio', 'dec-accept'],
       ['keep', 'Mantener antiguo', 'dec-keep'],
       ['edit', 'Editar', 'dec-edit']].forEach(function(opt) {
        const b = document.createElement('button');
        b.className = 'dec-btn ' + opt[2];
        b.textContent = opt[1];
        b.addEventListener('click', function() { setMode(i, opt[0]); });
        acts.appendChild(b);
      });

      head.appendChild(left); head.appendChild(acts);
      el.appendChild(head);

      if (card.reason) {
        const reason = document.createElement('div'); reason.className = 'reason'; reason.textContent = card.reason;
        el.appendChild(reason);
      }

      const values = document.createElement('div'); values.className = 'values';

      const cur = document.createElement('div'); cur.className = 'cur';
      const curTitle = document.createElement('div'); curTitle.className = 'val-title'; curTitle.textContent = 'README actual';
      const curBody = document.createElement('pre'); curBody.className = 'val-body'; curBody.textContent = card.currentText || '(vacío)';
      cur.appendChild(curTitle); cur.appendChild(curBody);

      const prop = document.createElement('div'); prop.className = 'prop';
      const propTitle = document.createElement('div'); propTitle.className = 'val-title'; propTitle.textContent = 'Propuesta';
      const propBody = document.createElement('pre'); propBody.className = 'val-body' + (isRemove ? ' removed' : '');
      propBody.textContent = isRemove ? '— quitar este dato —' : (card.proposedText || '(vacío)');
      prop.appendChild(propTitle); prop.appendChild(propBody);

      const editWrap = document.createElement('div'); editWrap.className = 'edit-wrap';
      const ta = document.createElement('textarea'); ta.id = 'ta-' + i;
      ta.value = isRemove ? card.currentText : (card.proposedText || card.currentText);
      editWrap.appendChild(ta);
      const hint = hintFor(card.panelKind);
      if (hint) { const h = document.createElement('div'); h.className = 'edit-hint'; h.textContent = hint; editWrap.appendChild(h); }

      values.appendChild(cur); values.appendChild(prop); values.appendChild(editWrap);
      el.appendChild(values);

      const foot = document.createElement('div'); foot.className = 'card-foot';
      const confirmBtn = document.createElement('button'); confirmBtn.className = 'confirm-btn'; confirmBtn.textContent = 'Confirmar';
      confirmBtn.addEventListener('click', function() { confirmCard(i); });
      foot.appendChild(confirmBtn);
      el.appendChild(foot);

      container.appendChild(el);
    });

    function setMode(i, mode) {
      document.getElementById('card-' + i).className = 'card mode-' + mode;
      updateSummary();
    }

    // Confirma la decisión actual de la tarjeta (aceptar/mantener/editar) y la retira del
    // panel. La tarjeta sigue en el DOM (oculta), así que su decisión cuenta al guardar.
    function confirmCard(i) {
      confirmed.add(i);
      document.getElementById('card-' + i).style.display = 'none';
      document.getElementById('allConfirmed').style.display =
        (confirmed.size === CARDS.length && CARDS.length > 0) ? 'block' : 'none';
      updateSummary();
    }

    function decisionOf(i) {
      const cl = document.getElementById('card-' + i).classList;
      if (cl.contains('mode-keep')) { return 'keep'; }
      if (cl.contains('mode-edit')) { return 'edit'; }
      return 'accept';
    }

    function updateSummary() {
      let apply = 0, keep = 0;
      CARDS.forEach(function(_, i) { if (decisionOf(i) === 'keep') { keep++; } else { apply++; } });
      const pend = CARDS.length - confirmed.size;
      document.getElementById('summary').innerHTML =
        '<b class="g">' + apply + '</b> se aplican · <b class="r">' + keep + '</b> se mantienen · ' +
        confirmed.size + ' confirmado(s), ' + pend + ' sin confirmar';
    }

    document.getElementById('btnSave').addEventListener('click', function() {
      const resolved = CARDS.map(function(card, i) {
        const decision = decisionOf(i);
        const out = { path: card.path, decision: decision };
        if (decision === 'edit') { out.value = document.getElementById('ta-' + i).value; }
        return out;
      });
      vscode.postMessage({ command: 'save', resolved: resolved });
    });
    document.getElementById('btnCancel').addEventListener('click', function() {
      vscode.postMessage({ command: 'cancel' });
    });

    // Acciones masivas (aplican solo a las tarjetas visibles según el filtro).
    function isVisible(i) { return document.getElementById('card-' + i).style.display !== 'none'; }
    document.getElementById('bulkAccept').addEventListener('click', function() {
      CARDS.forEach(function(_, i) { if (isVisible(i)) { setMode(i, 'accept'); } });
    });
    document.getElementById('bulkKeep').addEventListener('click', function() {
      CARDS.forEach(function(_, i) { if (isVisible(i)) { setMode(i, 'keep'); } });
    });

    // Filtro por tipo de cambio (solo vista; las decisiones ocultas siguen contando).
    function applyFilter(filter) {
      CARDS.forEach(function(card, i) {
        const show = !confirmed.has(i) && (filter === 'all' || card.recommendation === filter);
        document.getElementById('card-' + i).style.display = show ? '' : 'none';
      });
    }
    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        applyFilter(btn.getAttribute('data-filter'));
      });
    });

    updateSummary();
  </script>
</body>
</html>`;
}
