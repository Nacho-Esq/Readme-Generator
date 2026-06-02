import { FileOverview, RepositoryMap } from '../scanner/types';

export function buildFileSelectionPrompt(
  repositoryMap: RepositoryMap,
  inventory: FileOverview[],
  maxDetailedTokens: number
): string {
  return [
    'Eres un analista experto de repositorios de software.',
    'Tu tarea es seleccionar y ordenar los archivos que deben leerse en detalle para generar un README tecnico fiable.',
    'No recibes contenido completo de archivos. Solo recibes un mapa del repositorio y metadatos compactos por archivo.',
    '',
    'Reglas:',
    '- Devuelve solo JSON valido con el schema solicitado.',
    '- Selecciona solo rutas que aparezcan exactamente en el inventario.',
    '- La estructura del repositorio y los descartes son solo contexto; no selecciones rutas descartadas si no aparecen en el inventario.',
    '- Prioriza archivos que expliquen proposito, arquitectura, entrypoints, configuracion, instalacion, ejecucion, despliegue, prompts, agentes, RAG, herramientas, seguridad y observabilidad.',
    '- Evita tests, fixtures y archivos enormes salvo que sean imprescindibles.',
    '- Incluye manifiestos, documentacion principal y entrypoints cuando existan.',
    `- El presupuesto aproximado para lectura detallada posterior es ${maxDetailedTokens} tokens; ordena de mas importante a menos importante.`,
    '',
    'Mapa estructural del repositorio:',
    formatRepositoryMapForSelection(repositoryMap),
    '',
    'Inventario compacto de archivos candidatos:',
    JSON.stringify(buildFileSelectionMetadata(inventory), null, 2),
    '',
    'Formato esperado:',
    JSON.stringify({ selectedFiles: [{ path: 'src/example.ts', reason: 'reason' }], warnings: [] }, null, 2)
  ].join('\n');
}

export function buildFileSelectionMetadata(inventory: FileOverview[]): object[] {
  return inventory.map(toPromptOverview);
}

export function getFileSelectionJsonSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['selectedFiles', 'warnings'],
    properties: {
      selectedFiles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'reason'],
          properties: {
            path: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      warnings: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  };
}

function toPromptOverview(file: FileOverview): object {
  return {
    path: file.relativePath,
    size: file.size,
    extension: file.extension,
    modulePath: file.modulePath,
    kind: file.kind,
    isEntrypoint: file.isEntrypoint,
    initialScore: file.score,
    reasons: file.reasons,
    isTooLarge: file.isTooLarge,
    importsExports: file.importsExports,
    exportedFunctions: file.exportedFunctions,
    packageScripts: file.packageScripts
  };
}

function formatRepositoryMapForSelection(repositoryMap: RepositoryMap): string {
  return JSON.stringify({
    workspaceName: repositoryMap.workspaceName,
    technologies: repositoryMap.technologies,
    entrypoints: repositoryMap.entrypoints,
    modules: repositoryMap.modules,
    documentation: repositoryMap.documentation,
    structure: repositoryMap.structure,
    discardedSummary: repositoryMap.discardedSummary,
    stats: repositoryMap.stats
  }, null, 2);
}
