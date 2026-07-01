import { RepositoryMap, SelectedFile } from '../scanner/types';
import { buildDataJsonSchema, buildEmptyData, buildFieldInstructionText } from '../template/templateSpec';

export interface UnreadFileInfo {
  path: string;
  nanoReason: string;
  estimatedTokens: number;
}

export interface NanoContext {
  nanoReasonsByPath: Map<string, string>;
  unreadFiles: UnreadFileInfo[];
}

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
    'Eres un asistente experto en documentación técnica de proyectos de software de cualquier tipo (chatbots, agentes IA, APIs, librerías, CLIs, extensiones, aplicaciones web, servicios internos, etc.).',
    'Analiza solamente los archivos proporcionados de un repositorio local. No inventes datos.',
    'El README final se generará en español a partir de una plantilla Markdown.',
    '',
    'Objetivo: extraer valores estructurados para todos los campos de la plantilla README.',
    'Reglas estrictas:',
    '- Devuelve solo JSON válido.',
    '- Escribe todos los textos en español.',
    '- Rellena un campo SOLO si su valor se puede afirmar con alta certeza a partir de los archivos. Ante cualquier duda, ambigüedad o falta de evidencia, deja el campo vacío (string vacío o array vacío) para que lo complete el usuario. Esto aplica a TODOS los campos por igual: es siempre preferible dejar un campo vacío que rellenarlo con información inventada, supuesta o dudosa.',
    '- En particular, no rellenes contactos, seguridad, despliegue, observabilidad, documentación, roadmap o proyectos relacionados si no aparecen evidencias claras.',
    '- Los campos conversacionales de "Experiencia de usuario" (preguntas esperadas, adjuntos, errores/fallback, handoff a humano, historial/memoria) y toda la sección "Conocimiento y prompts" (fuentes, RAG, prompts/guardrails, contenido no permitido) solo aplican si el proyecto tiene un componente conversacional, de agente IA, o basado en modelos de lenguaje/RAG. Si no hay evidencia de ello, déjalos vacíos.',
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
    JSON.stringify({ data: buildEmptyData({ excludeHuman: true }), warnings: ['campo pendiente de completar manualmente'] }, null, 2),
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
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'warnings'],
    properties: {
      data: buildDataJsonSchema(),
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}
