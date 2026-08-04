// Paso 3 del actualizador — comparación de fichas. Por cada campo, el modelo recibe lo
// que dice el README y lo que se ha extraído del código, y decide si aportan la MISMA
// información o no. Diseñado para NO estar sesgado a marcar diferencias: por defecto
// "same"; solo "differs" si hay información realmente distinta.

export interface CompareItem {
  path: string;
  label: string;
  readmeText: string;
  codeText: string;
}

export interface Comparison {
  path: string;
  status: 'same' | 'differs';
  detail: string;
}

export function buildComparePrompt(items: CompareItem[]): string {
  const blocks = items
    .map(
      (item) =>
        `── Campo: ${item.label} (${item.path}) ──\n` +
        `README dice:\n${indent(item.readmeText)}\n` +
        `Código dice:\n${indent(item.codeText)}`
    )
    .join('\n\n');

  return [
    'Eres un asistente que compara la documentación de un README con la realidad del código.',
    'Para cada CAMPO recibes dos versiones del mismo dato: lo que dice el README y lo que se ha extraído del código. Ambas son extracciones DISTINTAS del MISMO proyecto, así que es normal que estén redactadas de forma diferente. Tu tarea es decidir si, a nivel de INFORMACIÓN, dicen lo mismo o no.',
    '',
    'Cómo decidir (léelo con atención; tu sesgo debe ser FUERTE hacia "same"):',
    'Responde "differs" SOLO si se cumple una de estas dos cosas:',
    '  (1) CONTRADICCIÓN: un hecho concreto de un lado choca con el otro (p. ej. el README dice "solo español" y el código dice "español e inglés").',
    '  (2) INFORMACIÓN AUSENTE: un lado contiene un dato concreto (una capacidad, dependencia, variable, ruta, entorno, integración, paso) que el otro NO menciona de ninguna forma. No cuenta que un lado lo diga con MENOS detalle: solo si de verdad no está.',
    '',
    'En CUALQUIER otro caso responde "same". En particular, esto NO es "differs":',
    '  - Distinta redacción, sinónimos, orden, mayúsculas o formato.',
    '  - Que un lado sea más largo, más corto, más detallado o más específico que el otro.',
    '  - Ejemplos distintos de lo mismo (p. ej. citar unas rutas u otras del mismo conjunto de endpoints).',
    '  - Notas o aclaraciones añadidas por un lado que no cambian la información esencial.',
    '  - En LISTAS: elementos agrupados, partidos, reordenados o redactados distinto; o una lista más larga solo porque es más granular. Solo cuenta si un elemento aporta un dato que el otro lado no menciona en absoluto.',
    '  - En DIAGRAMAS o bloques de código: dibujados distinto, con otros nombres de participantes o distinto nivel de detalle, pero representando el MISMO flujo o estructura.',
    '',
    'Regla de oro: si dudas de si una diferencia es "suficientemente real", NO lo es → responde "same".',
    'Cuando marques "differs", en `detail` explica en una frase el hecho concreto que se contradice o el dato concreto que falta en un lado.',
    '',
    'Ejemplos:',
    '',
    '1) README: "Herramienta para generar READMEs con IA." · Código: "Extensión de VS Code que genera READMEs a partir del código usando IA."',
    '   → "same": el mismo proyecto con más o menos detalle; nada se contradice ni falta.',
    '',
    '2) README (lista): "npm install", "arrancar con run.sh" · Código (lista): "npm install", "npm start", "./run.sh (ejecuta node ./bin/www)"',
    '   → "same": son los mismos pasos; que un lado dé más detalle o añada una nota no es una diferencia.',
    '',
    '3) README (idiomas): español, inglés, chino, ruso · Código (idiomas): español, inglés',
    '   → "differs": el README afirma chino y ruso, que el código no respalda.',
    '',
    'Devuelve solo JSON válido con el schema. Incluye TODOS los campos de la lista, cada uno con su `path` exacto.',
    '',
    'Campos a comparar:',
    blocks
  ].join('\n');
}

export function getCompareSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['comparisons'],
    properties: {
      comparisons: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'status', 'detail'],
          properties: {
            path: { type: 'string', description: 'Ruta exacta del campo, tal cual aparece en la lista.' },
            status: { type: 'string', enum: ['same', 'differs'] },
            detail: { type: 'string', description: 'Si differs, qué información cambia (una frase). Si same, puede ir vacío.' }
          }
        }
      }
    }
  };
}

export function parseComparisons(text: string): Comparison[] {
  const parsed = safeJsonParse(text) ?? safeJsonParse(extractJsonObject(text));
  const comparisons = (parsed as { comparisons?: unknown })?.comparisons;
  if (!Array.isArray(comparisons)) {
    throw new Error('La respuesta de comparación no es un JSON válido con `comparisons`.');
  }
  return comparisons
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.path === 'string')
    .map((item) => ({
      path: item.path as string,
      status: item.status === 'differs' ? 'differs' : 'same',
      detail: typeof item.detail === 'string' ? (item.detail as string) : ''
    }));
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return text;
  }
  return text.slice(start, end + 1);
}
