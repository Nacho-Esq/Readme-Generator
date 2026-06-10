import { FileOverview, RepositoryMap, SelectedFile } from '../scanner/types';

export function buildContentSelectionPrompt(
  repositoryMap: RepositoryMap,
  files: SelectedFile[]
): string {
  const fileContents = files
    .map((f) => {
      const header = `=== ${f.relativePath} (${f.size} bytes${f.truncated ? ', truncado' : ''}) ===`;
      return `${header}\n${f.content}`;
    })
    .join('\n\n');

  return [
    'Eres un analizador de repositorios de software.',
    'Tu tarea es ordenar los archivos del repositorio por importancia para generar un README tecnico.',
    'Debes identificar donde esta la logica central del proyecto.',
    '',
    'Reglas:',
    '- Devuelve solo JSON valido con el schema solicitado.',
    '- Ordena selectedFiles de mas a menos importante.',
    '- Descarta los archivos que no aporten informacion util para el README: tests, fixtures, assets, configuracion menor, archivos generados.',
    '- Solo incluye en selectedFiles rutas que aparezcan exactamente en el contenido proporcionado.',
    '- La razon debe ser muy breve (una frase) explicando por que ese archivo es relevante.',
    '- NO extraigas informacion del proyecto. Solo identifica y ordena archivos por relevancia.',
    '',
    'Mapa estructural del repositorio:',
    formatRepositoryMapForSelection(repositoryMap),
    '',
    'Contenido de los archivos candidatos:',
    fileContents,
    '',
    'Formato esperado:',
    JSON.stringify({ selectedFiles: [{ path: 'src/example.ts', reason: 'razon breve' }], warnings: [] }, null, 2)
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
