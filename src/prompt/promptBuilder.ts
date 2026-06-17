import { RepositoryMap, SelectedFile } from '../scanner/types';
import { ReadmeData } from '../types';
import { buildFieldInstructionText, getFieldInstruction } from './fieldInstructions';

export interface UnreadFileInfo {
  path: string;
  nanoReason: string;
  estimatedTokens: number;
}

export interface NanoContext {
  nanoReasonsByPath: Map<string, string>;
  unreadFiles: UnreadFileInfo[];
}

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

export function buildExtractionPrompt(
  files: SelectedFile[],
  workspaceName: string,
  repositoryMap: RepositoryMap,
  nanoContext: NanoContext
): string {
  const fileBlocks = files.map((file) => {
    const nanoReason = nanoContext.nanoReasonsByPath.get(file.relativePath);
    const truncation = file.truncated ? '\n[TRUNCATED]' : '';
    const lines = [
      `### FILE: ${file.relativePath}`,
    ];
    if (nanoReason) {
      lines.push(`Relevancia segun selector: ${nanoReason}`);
    }
    lines.push('```');
    lines.push(file.content);
    lines.push('```');
    if (truncation) {
      lines.push(truncation);
    }
    return lines.join('\n');
  });

  const unreadBlock: string[] = [];
  if (nanoContext.unreadFiles.length > 0) {
    unreadBlock.push('');
    unreadBlock.push('AVISO — Archivos no leidos por presupuesto de tokens:');
    unreadBlock.push('El modelo de seleccion identifico los siguientes archivos como relevantes, pero no pudieron ser leidos por limite de tokens.');
    unreadBlock.push('Si un campo no puede rellenarse con certeza porque su informacion puede estar en estos archivos, dejalo vacio en lugar de inferir o inventar:');
    for (const f of nanoContext.unreadFiles) {
      const reason = f.nanoReason ? ` — ${f.nanoReason}` : '';
      unreadBlock.push(`- ${f.path} (~${f.estimatedTokens} tokens estimados)${reason}`);
    }
  }

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
    'Instrucciones específicas por campo:',
    buildFieldInstructionText(),
    '',
    `Nombre del workspace: ${workspaceName}`,
    '',
    'Mapa estructural del repositorio:',
    formatRepositoryMap(repositoryMap, files.length),
    '',
    'Formato exacto de salida:',
    JSON.stringify({ data: emptyReadmeData, warnings: ['campo pendiente de completar manualmente'] }, null, 2),
    ...unreadBlock,
    '',
    'Archivos seleccionados:',
    fileBlocks.join('\n\n')
  ].join('\n');
}

function formatRepositoryMap(repositoryMap: RepositoryMap, selectedFileCount: number): string {
  const technologies = repositoryMap.technologies.length
    ? repositoryMap.technologies.map((tech) => `- ${tech.name} (${tech.evidence.join(', ')})`).join('\n')
    : '- No detectadas';
  const entrypoints = repositoryMap.entrypoints.length
    ? repositoryMap.entrypoints.map((entrypoint) => `- ${entrypoint}`).join('\n')
    : '- No detectados';
  const modules = repositoryMap.modules.length
    ? repositoryMap.modules
        .map((module) => `- ${module.path} [${module.kind}, ${module.fileCount} archivos]`)
        .join('\n')
    : '- No detectados';
  const documentation = repositoryMap.documentation.length
    ? repositoryMap.documentation.map((doc) => `- ${doc}`).join('\n')
    : '- No detectada';
  const structure = repositoryMap.structure.length
    ? repositoryMap.structure
        .map((entry) => {
          const detail = entry.kind === 'directory'
            ? `${entry.fileCount || 0} archivos`
            : `${entry.size || 0} bytes`;
          return `- ${entry.path} [${entry.kind}, ${detail}]`;
        })
        .join('\n')
    : '- No detectada';
  const discarded = repositoryMap.discardedSummary.length
    ? repositoryMap.discardedSummary
        .map((item) => `- ${item.reason} (${item.stage || 'local'}): ${item.count} archivos; ejemplos: ${item.examples.join(', ')}`)
        .join('\n')
    : '- Sin descartes locales adicionales';

  return [
    `Workspace: ${repositoryMap.workspaceName}`,
    `Estadisticas: ${repositoryMap.stats.candidateFiles} archivos candidatos, ${selectedFileCount} archivos seleccionados, ${repositoryMap.stats.sourceFiles} fuente, ${repositoryMap.stats.documentationFiles} documentacion, ${repositoryMap.stats.totalBytes} bytes candidatos.`,
    '',
    'Tecnologias detectadas:',
    technologies,
    '',
    'Entrypoints probables:',
    entrypoints,
    '',
    'Modulos/carpetas principales:',
    modules,
    '',
    'Documentacion existente:',
    documentation,
    '',
    'Estructura del repositorio:',
    structure,
    '',
    'Resumen de archivos descartados:',
    discarded
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
        name: withDescription({ type: 'string' }, getFieldInstruction('local_development.env_variables.name')),
        description: withDescription(
          { type: 'string' },
          getFieldInstruction('local_development.env_variables.description')
        )
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
  const description = getFieldInstruction(path);
  if (typeof value === 'string') {
    return withDescription({ type: 'string' }, description);
  }
  if (Array.isArray(value)) {
    return withDescription(path === 'local_development.env_variables' ? envVariableArray : stringArray, description);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return withDescription({
      type: 'object',
      additionalProperties: false,
      required: entries.map(([key]) => key),
      properties: Object.fromEntries(
        entries.map(([key, child]) => [
          key,
          schemaFromValue(child, path ? `${path}.${key}` : key, stringArray, envVariableArray)
        ])
      )
    }, description);
  }
  return withDescription({ type: 'string' }, description);
}

function withDescription(schema: object, description: string | undefined): object {
  return description ? { ...schema, description } : schema;
}
