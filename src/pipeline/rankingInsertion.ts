import { CandidateFile, RepositoryMap, SelectedFile } from '../scanner/types';
import { RankingEntry } from './rankingMemory';
import { extractJsonObject, safeJsonParse } from '../utils/json';

// Inserción de ficheros nuevos en un ranking existente (Paso 0b del actualizador).
// El modelo NO reordena el ranking viejo: solo decide, por cada fichero nuevo, si
// entra y ANTES de qué fichero existente va. La fusión es mecánica, así que el orden
// previo es intocable.

export const RANKING_INSERTION_END = '__END__';

export interface Placement {
  path: string;
  decision: 'keep' | 'discard';
  insert_before: string; // ruta del ranking existente o RANKING_INSERTION_END
  reason: string;
}

export interface MergeResult {
  ranking: CandidateFile[];
  insertedPaths: string[];
  warnings: string[];
}

export function buildRankingInsertionPrompt(
  existingRanking: RankingEntry[],
  newFiles: SelectedFile[],
  repositoryMap: RepositoryMap
): string {
  const rankingList = existingRanking.length
    ? existingRanking.map((entry, index) => `${index + 1}. ${entry.path} — ${entry.reason || 'sin razón registrada'}`).join('\n')
    : '(el ranking existente está vacío)';

  const newContents = newFiles
    .map((f) => `=== ${f.relativePath} (${f.size} bytes${f.truncated ? ', truncado' : ''}) ===\n${f.content}`)
    .join('\n\n');

  return [
    'Eres un analizador de repositorios de software.',
    'Ya existe un RANKING de los archivos del repositorio, ordenado por importancia para generar un README (el más importante primero). Han aparecido archivos NUEVOS que no estaban en ese ranking. Tu tarea: decidir, para cada archivo nuevo, si debe entrar en el ranking y, si entra, EN QUÉ POSICIÓN respecto a los ya rankeados.',
    '',
    'CONTEXTO CRÍTICO — por qué la posición importa:',
    'Otro modelo leerá los archivos en el orden del ranking, de más a menos importante, con un presupuesto limitado de tokens; puede quedarse sin presupuesto antes del final. Un archivo importante en posición baja podría no leerse nunca.',
    '',
    'Reglas de POSICIÓN (críticas):',
    '- NO reordenes el ranking existente: su orden es FIJO. Solo colocas los nuevos ENTRE los que ya hay.',
    `- Para cada nuevo que entre, indica \`insert_before\`: la ruta EXACTA del archivo del ranking existente ANTES del cual debe ir (el nuevo es MÁS importante que ese). Usa "${RANKING_INSERTION_END}" si debe ir al final (menos importante que todos).`,
    `- \`insert_before\` debe ser una ruta del ranking listado abajo, o "${RANKING_INSERTION_END}". No la inventes.`,
    '',
    'Reglas de SELECCIÓN (como en la selección normal):',
    '- decision "keep" si aporta al README; "discard" si con certeza no aporta (tests, fixtures, assets binarios, lockfiles, generados). Ante la duda, "keep" en posición baja.',
    '- reason: una frase breve con la decisión y, si entra, por qué esa posición (su importancia frente a los vecinos).',
    '- Devuelve solo JSON válido con el schema. Incluye TODOS los archivos nuevos en `placements` (con keep o discard).',
    '',
    'Ranking existente (orden FIJO, del más al menos importante):',
    rankingList,
    '',
    'Mapa estructural del repositorio:',
    formatRepositoryMapForInsertion(repositoryMap),
    '',
    'Archivos NUEVOS a colocar (con su contenido):',
    newContents,
    '',
    'Formato esperado:',
    JSON.stringify(
      {
        placements: [
          { path: 'src/nuevo.ts', decision: 'keep', insert_before: 'src/config.ts', reason: 'razón breve' },
          { path: 'test/nuevo.spec.ts', decision: 'discard', insert_before: RANKING_INSERTION_END, reason: 'test unitario, no aporta al README' }
        ],
        warnings: []
      },
      null,
      2
    )
  ].join('\n');
}

export function getRankingInsertionSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['placements', 'warnings'],
    properties: {
      placements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'decision', 'insert_before', 'reason'],
          properties: {
            path: { type: 'string' },
            decision: { type: 'string', enum: ['keep', 'discard'] },
            insert_before: { type: 'string', description: `Ruta del ranking existente o "${RANKING_INSERTION_END}".` },
            reason: { type: 'string' }
          }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

export function parseRankingPlacements(text: string): Placement[] {
  const parsed = safeJsonParse(text) ?? safeJsonParse(extractJsonObject(text));
  const placements = (parsed as { placements?: unknown })?.placements;
  if (!Array.isArray(placements)) {
    throw new Error('La respuesta de inserción de ranking no es un JSON válido con `placements`.');
  }
  return placements
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.path === 'string')
    .map((item) => ({
      path: item.path as string,
      decision: item.decision === 'discard' ? 'discard' : 'keep',
      insert_before: typeof item.insert_before === 'string' ? (item.insert_before as string) : RANKING_INSERTION_END,
      reason: typeof item.reason === 'string' ? (item.reason as string) : ''
    }));
}

// Fusión mecánica: parte del ranking existente (orden intocable) e inserta cada
// fichero nuevo 'keep' antes de su `insert_before`. Rutas desconocidas o el sentinel
// → al final. Preserva el orden del modelo entre nuevos con la misma ancla.
export function mergeNewFilesIntoRanking(
  existing: CandidateFile[],
  newFiles: SelectedFile[],
  placements: Placement[]
): MergeResult {
  const newByPath = new Map(newFiles.map((f) => [f.relativePath, f]));
  const result: CandidateFile[] = [...existing];
  const insertedPaths: string[] = [];
  const warnings: string[] = [];

  for (const placement of placements) {
    if (placement.decision !== 'keep') {
      continue;
    }
    const file = newByPath.get(placement.path);
    if (!file || result.some((f) => f.relativePath === placement.path)) {
      continue; // ruta que no es un candidato nuevo, o duplicada
    }
    let index: number;
    if (placement.insert_before === RANKING_INSERTION_END) {
      index = result.length;
    } else {
      index = result.findIndex((f) => f.relativePath === placement.insert_before);
      if (index === -1) {
        index = result.length;
        warnings.push(`insert_before desconocido ("${placement.insert_before}") para ${placement.path}; se añade al final.`);
      }
    }
    result.splice(index, 0, file);
    insertedPaths.push(placement.path);
  }

  return { ranking: result, insertedPaths, warnings };
}

// Fallback seguro si la llamada/parseo de inserción falla: añade todos los nuevos al
// final del ranking (quedan con prioridad baja; el presupuesto probablemente los corte).
export function appendNewFilesFallback(existing: CandidateFile[], newFiles: SelectedFile[]): MergeResult {
  const existingPaths = new Set(existing.map((f) => f.relativePath));
  const toAppend = newFiles.filter((f) => !existingPaths.has(f.relativePath));
  return {
    ranking: [...existing, ...toAppend],
    insertedPaths: toAppend.map((f) => f.relativePath),
    warnings: []
  };
}

function formatRepositoryMapForInsertion(repositoryMap: RepositoryMap): string {
  return JSON.stringify(
    {
      workspaceName: repositoryMap.workspaceName,
      technologies: repositoryMap.technologies,
      entrypoints: repositoryMap.entrypoints,
      modules: repositoryMap.modules,
      stats: repositoryMap.stats
    },
    null,
    2
  );
}
