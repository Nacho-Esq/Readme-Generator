import { RepositoryMap, SelectedFile } from '../scanner/types';

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
    'Tu tarea es ordenar los archivos del repositorio por importancia para que otro modelo pueda generar un README tecnico completo del proyecto.',
    '',
    'CONTEXTO CRITICO — por que el orden importa:',
    'El modelo que generara el README leera los archivos en el orden que tu indiques, de mas a menos importante.',
    'Tiene un presupuesto limitado de tokens y puede quedarse sin presupuesto antes de llegar al final de la lista.',
    'Si un archivo importante queda en una posicion baja, puede que nunca sea leido y su informacion se pierda.',
    'Pon primero lo que mas necesita el README.',
    '',
    'Un README tecnico cubre tipicamente:',
    '- Proposito del proyecto y a quien va dirigido',
    '- Arquitectura y componentes principales',
    '- Stack tecnologico y dependencias clave',
    '- Variables de entorno y configuracion necesaria',
    '- Instrucciones de instalacion y arranque',
    '- Uso, canales o interfaces del sistema',
    '- Despliegue y entornos',
    '- Integraciones con sistemas externos',
    '',
    'Reglas:',
    '- Devuelve solo JSON valido con el schema solicitado.',
    '- Ordena selectedFiles de mas a menos importante segun lo que mas aporte al README.',
    '- Son especialmente valiosos: entrypoints, ficheros de configuracion, definiciones de tipos e interfaces, variables de entorno, scripts de arranque y despliegue, ficheros que describan la arquitectura.',
    '- Descarta en discardedFiles solo los archivos que con certeza no aporten nada al README: tests unitarios, fixtures, assets binarios, lockfiles, archivos generados automaticamente. Ante la duda, incluye el archivo en selectedFiles aunque sea con prioridad baja.',
    '- Solo incluye en selectedFiles rutas que aparezcan exactamente en el contenido proporcionado.',
    '- La razon de selectedFiles debe ser muy breve (una frase) explicando por que ese archivo es relevante para el README.',
    '- Para cada archivo descartado, incluyelo en discardedFiles con una razon breve (una frase).',
    '- warnings va dirigido a la PERSONA que va a generar su README, no a ti ni al programador de la herramienta. Solo tiene sentido si la persona puede hacer algo al respecto.',
    '- Emite un warning UNICAMENTE cuando falte en el repositorio informacion que dejaria una seccion del README incompleta, y di que seccion se vera afectada. Ejemplos validos: no hay fichero de variables de entorno (.env.example) y la seccion de configuracion puede quedar coja; no se detecta fichero de licencia; no hay scripts ni documentacion de despliegue.',
    '- NUNCA uses warnings para comentar tu propio proceso de seleccion: no reportes rutas duplicadas en selectedFiles, dudas al clasificar un archivo, criterios de ordenacion, ni ficheros que no supiste ubicar. Eso no le sirve a la persona. Ante la duda al clasificar, decide en silencio y no generes warning.',
    '- Si no hay huecos de cobertura relevantes, devuelve warnings como lista vacia.',
    '- NO extraigas informacion del proyecto. Solo identifica y ordena archivos por relevancia.',
    '',
    'Mapa estructural del repositorio:',
    formatRepositoryMapForSelection(repositoryMap),
    '',
    'Contenido de los archivos candidatos:',
    fileContents,
    '',
    'Formato esperado:',
    JSON.stringify({ selectedFiles: [{ path: 'src/example.ts', reason: 'razon breve' }], discardedFiles: [{ path: 'test/example.spec.ts', reason: 'razon breve' }], warnings: ["No se encontro fichero de configuracion de entorno (.env.example o similar)"] }, null, 2)
  ].join('\n');
}


export function getFileSelectionJsonSchema(): object {
  const fileItemSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'reason'],
    properties: {
      path: { type: 'string' },
      reason: { type: 'string' }
    }
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['selectedFiles', 'discardedFiles', 'warnings'],
    properties: {
      selectedFiles: {
        type: 'array',
        items: fileItemSchema
      },
      discardedFiles: {
        type: 'array',
        items: fileItemSchema
      },
      warnings: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  };
}

function formatRepositoryMapForSelection(repositoryMap: RepositoryMap): string {
  return JSON.stringify({
    workspaceName: repositoryMap.workspaceName,
    technologies: repositoryMap.technologies,
    entrypoints: repositoryMap.entrypoints,
    modules: repositoryMap.modules,
    documentation: repositoryMap.documentation,
    discardedSummary: repositoryMap.discardedSummary,
    stats: repositoryMap.stats
  }, null, 2);
}
