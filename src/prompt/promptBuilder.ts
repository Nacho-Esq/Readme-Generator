import { SelectedFile } from '../scanner/types';
import { ReadmeData } from '../types';

export const emptyReadmeData: ReadmeData = {
  project_name: '',
  screenshot_path: '',
  summary: {
    what_is: '',
    project_type: '',
    purpose: '',
    target_users: [],
    status: '',
    success_criteria: ''
  },
  scope: {
    includes: [],
    excludes: [],
    known_limitations: []
  },
  usage: {
    channels: [],
    languages: [],
    contexts: []
  },
  ux: {
    start_flow: '',
    expected_questions: [],
    attachments_support: '',
    fallback_error_handling: '',
    human_handoff: '',
    history_session_memory: ''
  },
  architecture: {
    logical_flow: '',
    components: [],
    external_dependencies: []
  },
  knowledge_prompts: {
    sources: [],
    rag_summary: '',
    prompt_guardrails_location: '',
    forbidden_content_handling: ''
  },
  security_privacy: {
    processed_data: [],
    retention_storage: '',
    access_auth: '',
    anonymization_secrets: '',
    compliance_notes: ''
  },
  local_development: {
    requirements: [],
    env_variables: [],
    resources: [],
    install_run_commands: [],
    validation_checks: [],
    testing_strategy: ''
  },
  deployment: {
    environments: [],
    process: '',
    environment_differences: ''
  },
  operations: {
    logs: '',
    traces: '',
    metrics: '',
    alerts_runbooks: '',
    incident_process: ''
  },
  documentation_links: {
    coordination_tools: [],
    repos_pipelines: [],
    environments_resources: [],
    manuals_docs: []
  },
  roadmap: [],
  contacts: {
    product_owner: '',
    technical_owner: '',
    responsible_team: '',
    support_operations: ''
  },
  related_projects: []
};

export function buildExtractionPrompt(files: SelectedFile[], workspaceName: string): string {
  const fileBlocks = files.map((file) => {
    const truncation = file.truncated ? '\n[TRUNCATED]' : '';
    return [
      `### FILE: ${file.relativePath}`,
      `Score: ${file.score}`,
      `Reasons: ${file.reasons.join(', ')}`,
      '```',
      file.content,
      '```',
      truncation
    ].join('\n');
  });

  return [
    'Eres un asistente experto en documentación técnica de proyectos de software, especialmente chatbots, agentes, copilotos y asistentes IA.',
    'Analiza solamente los archivos proporcionados de un repositorio local. No inventes datos.',
    'El README final se generará en español con una plantilla Jinja/Nunjucks.',
    '',
    'Objetivo: extraer valores estructurados para todos los campos de la plantilla README v1.0.2.',
    'Reglas estrictas:',
    '- Devuelve solo JSON válido.',
    '- Escribe todos los textos en español.',
    '- Si falta información, deja strings vacíos o arrays vacíos.',
    '- No rellenes contactos, seguridad, despliegue, observabilidad, documentación, roadmap o proyectos relacionados si no aparecen evidencias.',
    '- Usa package.json, requirements.txt, pyproject.toml y scripts para requisitos, instalación, ejecución, checks y pruebas.',
    '- Usa config, .env.example, Docker, Kubernetes, IaC, CI/CD, docs markdown y código para buscar despliegue, entornos, seguridad, observabilidad y dependencias externas.',
    '- Usa archivos de prompts, agentes, workflows, RAG, tools, servicios y comentarios de código para inferir UX, arquitectura, fuentes de conocimiento y guardrails.',
    '- Para variables de entorno, extrae nombres desde .env.example, config o código, y describe su propósito solo si es evidente.',
    '- Incluye advertencias breves para campos importantes que queden vacíos y requieran completar manualmente.',
    '',
    'Fuentes probables a revisar dentro de los archivos seleccionados:',
    '- package.json, requirements.txt, pyproject.toml',
    '- config, env, CI/CD, Docker, Kubernetes, IaC',
    '- docs/, README y markdowns técnicos',
    '- código fuente, comentarios, prompts y configuración de agentes',
    '',
    `Nombre del workspace: ${workspaceName}`,
    '',
    'Campos esperados:',
    JSON.stringify(emptyReadmeData, null, 2),
    '',
    'Formato exacto de salida:',
    JSON.stringify({ data: emptyReadmeData, warnings: ['campo pendiente de completar manualmente'] }, null, 2),
    '',
    'Archivos seleccionados:',
    fileBlocks.join('\n\n')
  ].join('\n');
}

export function getExtractionJsonSchema(): object {
  const stringArray = { type: 'array', items: { type: 'string' } };
  const envVariableArray = {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' }
      }
    }
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'warnings'],
    properties: {
      data: schemaFromValue(emptyReadmeData, '', stringArray, envVariableArray),
      warnings: stringArray
    }
  };
}

function schemaFromValue(value: unknown, path: string, stringArray: object, envVariableArray: object): object {
  if (typeof value === 'string') {
    return { type: 'string' };
  }
  if (Array.isArray(value)) {
    return path === 'local_development.env_variables' ? envVariableArray : stringArray;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: 'object',
      additionalProperties: false,
      required: entries.map(([key]) => key),
      properties: Object.fromEntries(
        entries.map(([key, child]) => [
          key,
          schemaFromValue(child, path ? `${path}.${key}` : key, stringArray, envVariableArray)
        ])
      )
    };
  }
  return { type: 'string' };
}
