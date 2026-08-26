import { buildEmptyData, buildFieldInstructionText } from '../template/templateSpec';

// Paso 1 del actualizador — prompt de EXTRACCIÓN del README. Es extracción pura:
// el modelo copia fielmente lo que el README ya dice en cada campo de la plantilla,
// NO redacta ni infiere. Reutiliza el schema de datos de la plantilla (que excluye
// los campos H) vía getExtractionJsonSchema en la llamada.
export function buildReadmeFichasPrompt(readmeText: string, workspaceName: string): string {
  return [
    'Eres un asistente experto en documentación técnica de proyectos de software.',
    'A continuación tienes un README ya redactado por el equipo de un proyecto.',
    'Tu tarea es EXTRAER, para cada campo de la plantilla, qué dice ACTUALMENTE este README (su valor actual).',
    '',
    'Reglas estrictas:',
    '- Devuelve solo JSON válido, con todos los textos en español.',
    '- Mapea por SIGNIFICADO, no por el título de las secciones: el equipo pudo renombrar, reordenar o fusionar secciones. Reconoce el contenido de cada campo aunque el encabezado no coincida con el nombre del campo.',
    '- Copia FIELMENTE lo que el README dice. NO uses conocimiento externo, NO infieras a partir de código (no lo tienes aquí) y NO inventes nada.',
    '- Si el campo NO aparece en el README, déjalo VACÍO (string vacío o array vacío). Es importante: un campo ausente debe quedar vacío, no lo rellenes.',
    '- Para diagramas u otros bloques (Mermaid, código), copia el bloque tal cual aparece, sin reescribirlo.',
    '- Para variables de entorno, listas u otros campos enumerados, extrae exactamente los elementos que el README lista.',
    '',
    'Instrucciones por campo (describen qué representa cada campo de la plantilla):',
    buildFieldInstructionText(),
    '',
    `Nombre del workspace: ${workspaceName}`,
    '',
    'Formato exacto de salida:',
    JSON.stringify({ data: buildEmptyData({ excludeHuman: true }), warnings: [] }, null, 2),
    '',
    'README actual a analizar:',
    '```markdown',
    readmeText,
    '```'
  ].join('\n');
}
