import * as vscode from 'vscode';
import { ReadmeData } from '../types';

type EditResult =
  | { action: 'save'; data: ReadmeData }
  | { action: 'cancel' };

type FieldKind = 'text' | 'list' | 'env';

interface FieldDefinition {
  path: string;
  label: string;
  kind: FieldKind;
  hint?: string;
}

interface FormSection {
  title: string;
  fields: FieldDefinition[];
}

const FORM_SECTIONS: FormSection[] = [
  {
    title: 'Base',
    fields: [
      { path: 'project_name', label: 'Nombre del proyecto', kind: 'text' },
      { path: 'screenshot_path', label: 'Ruta de captura/GIF', kind: 'text' }
    ]
  },
  {
    title: 'Resumen',
    fields: [
      { path: 'summary.what_is', label: 'Qué es', kind: 'text' },
      { path: 'summary.project_type', label: 'Tipo de proyecto', kind: 'text' },
      { path: 'summary.purpose', label: 'Propósito', kind: 'text' },
      { path: 'summary.target_users', label: 'Usuarios objetivo', kind: 'list' },
      { path: 'summary.status', label: 'Estado', kind: 'text' },
      { path: 'summary.success_criteria', label: 'Objetivo y éxito', kind: 'text' }
    ]
  },
  {
    title: 'Alcance y Uso',
    fields: [
      { path: 'scope.includes', label: 'Qué incluye', kind: 'list' },
      { path: 'scope.excludes', label: 'Qué no incluye', kind: 'list' },
      { path: 'scope.known_limitations', label: 'Limitaciones conocidas', kind: 'list' },
      { path: 'usage.channels', label: 'Canales', kind: 'list' },
      { path: 'usage.languages', label: 'Idiomas', kind: 'list' },
      { path: 'usage.contexts', label: 'Contextos de uso', kind: 'list' }
    ]
  },
  {
    title: 'Experiencia de Usuario',
    fields: [
      { path: 'ux.start_flow', label: 'Cómo se inicia', kind: 'text' },
      { path: 'ux.expected_questions', label: 'Preguntas esperadas', kind: 'list' },
      { path: 'ux.attachments_support', label: 'Adjuntos', kind: 'text' },
      { path: 'ux.fallback_error_handling', label: 'Errores y fallback', kind: 'text' },
      { path: 'ux.human_handoff', label: 'Handoff a humano', kind: 'text' },
      { path: 'ux.history_session_memory', label: 'Historial/memoria', kind: 'text' }
    ]
  },
  {
    title: 'Arquitectura y Conocimiento',
    fields: [
      { path: 'architecture.logical_flow', label: 'Diagrama/flujo lógico', kind: 'text' },
      { path: 'architecture.components', label: 'Componentes principales', kind: 'list' },
      { path: 'architecture.external_dependencies', label: 'Dependencias externas', kind: 'list' },
      { path: 'knowledge_prompts.sources', label: 'Fuentes de conocimiento', kind: 'list' },
      { path: 'knowledge_prompts.rag_summary', label: 'Recuperación/RAG', kind: 'text' },
      { path: 'knowledge_prompts.prompt_guardrails_location', label: 'Prompts/guardrails', kind: 'text' },
      { path: 'knowledge_prompts.forbidden_content_handling', label: 'Contenido no permitido', kind: 'text' }
    ]
  },
  {
    title: 'Seguridad y Privacidad',
    fields: [
      { path: 'security_privacy.processed_data', label: 'Datos tratados', kind: 'list' },
      { path: 'security_privacy.retention_storage', label: 'Retención/almacenamiento', kind: 'text' },
      { path: 'security_privacy.access_auth', label: 'Acceso/autenticación', kind: 'text' },
      { path: 'security_privacy.anonymization_secrets', label: 'Anonimización/secretos', kind: 'text' },
      { path: 'security_privacy.compliance_notes', label: 'Cumplimiento', kind: 'text' }
    ]
  },
  {
    title: 'Desarrollo Local',
    fields: [
      { path: 'local_development.requirements', label: 'Requisitos', kind: 'list' },
      { path: 'local_development.env_variables', label: 'Variables de entorno', kind: 'env', hint: 'Una variable por línea: NOMBRE: descripción' },
      { path: 'local_development.resources', label: 'Recursos/datos', kind: 'list' },
      { path: 'local_development.install_run_commands', label: 'Comandos de instalación/arranque', kind: 'list' },
      { path: 'local_development.validation_checks', label: 'Validación rápida', kind: 'list' },
      { path: 'local_development.testing_strategy', label: 'Pruebas', kind: 'text' }
    ]
  },
  {
    title: 'Despliegue y Operación',
    fields: [
      { path: 'deployment.environments', label: 'Entornos', kind: 'list' },
      { path: 'deployment.process', label: 'Proceso de despliegue', kind: 'text' },
      { path: 'deployment.environment_differences', label: 'Diferencias por entorno', kind: 'text' },
      { path: 'operations.logs', label: 'Logs', kind: 'text' },
      { path: 'operations.traces', label: 'Trazas', kind: 'text' },
      { path: 'operations.metrics', label: 'Métricas', kind: 'text' },
      { path: 'operations.alerts_runbooks', label: 'Alertas/runbooks', kind: 'text' },
      { path: 'operations.incident_process', label: 'Proceso de incidencias', kind: 'text' }
    ]
  },
  {
    title: 'Documentación y Ownership',
    fields: [
      { path: 'documentation_links.coordination_tools', label: 'Gestión y coordinación', kind: 'list' },
      { path: 'documentation_links.repos_pipelines', label: 'Repositorios y CI/CD', kind: 'list' },
      { path: 'documentation_links.environments_resources', label: 'Entornos y recursos', kind: 'list' },
      { path: 'documentation_links.manuals_docs', label: 'Manuales/docs', kind: 'list' },
      { path: 'roadmap', label: 'Roadmap/mejoras', kind: 'list' },
      { path: 'contacts.product_owner', label: 'Product owner', kind: 'text' },
      { path: 'contacts.technical_owner', label: 'Responsable técnico', kind: 'text' },
      { path: 'contacts.responsible_team', label: 'Equipo responsable', kind: 'text' },
      { path: 'contacts.support_operations', label: 'Soporte/Operación', kind: 'text' },
      { path: 'related_projects', label: 'Proyectos relacionados (solo desarrollador)', kind: 'list' }
    ]
  }
];

export class EditFormPanel {
  static show(data: ReadmeData, warnings: string[], extensionUri: vscode.Uri): Promise<EditResult> {
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
        panel.webview.html = getEditHtml(panel.webview, data, warnings);
      } catch (error) {
        resolved = true;
        reject(error);
        return;
      }

      const subscription = panel.webview.onDidReceiveMessage((message) => {
        if (message?.command === 'save') {
          cleanup({ action: 'save', data: message.data as ReadmeData });
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

function getEditHtml(webview: vscode.Webview, data: ReadmeData, warnings: string[]): string {
  const nonce = getNonce();
  const sections = FORM_SECTIONS.map((section) => sectionEditor(section, data)).join('');
  const warningItems = warnings.length
    ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
    : '<li>Revisa los campos vacíos antes de guardar.</li>';
  const fields = FORM_SECTIONS.flatMap((section) => section.fields);

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
    .missing label::after { content: " pendiente"; color: var(--vscode-errorForeground); font-weight: 400; }
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
    <h2>Advertencias y campos a revisar</h2>
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
        fieldset.classList.toggle('missing', element.value.trim().length === 0);
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
  const value = formatValue(rawValue, field.kind);
  const hint = field.hint || (field.kind === 'list' ? 'Un valor por línea' : '');
  return `<fieldset>
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

function formatValue(value: unknown, kind: FieldKind): string {
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
