import * as vscode from 'vscode';

// Memoria de ranking del repositorio. A DIFERENCIA de la traza de depuración
// (`.readme-generator-ai/last-run.json`, condicionada a `debugTrace`), este fichero
// se escribe SIEMPRE, tanto al generar como al actualizar. Es la memoria funcional
// que permite al actualizador reutilizar el ranking previo y detectar, por simple
// diferencia de conjuntos, qué ficheros son nuevos desde la última lectura.

export interface RankingEntry {
  path: string;
  reason: string;
}

export interface RankingMemory {
  version: number;
  workspaceName: string;
  updatedAt: string;
  mode: 'generate' | 'update';
  // Ficheros seleccionados por el nano, en orden de importancia, con su razón.
  ranking: RankingEntry[];
  // TODOS los ficheros que el nano ha considerado alguna vez (seleccionados +
  // descartados). Acumula entre pasadas: nuevos = inventario actual − seenPaths.
  seenPaths: string[];
}

const RANKING_VERSION = 1;
const MEMORY_DIR = '.readme-generator-ai';
const MEMORY_FILE = 'ranking.json';

function memoryUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(workspaceFolder.uri, MEMORY_DIR, MEMORY_FILE);
}

// Lee la memoria de ranking. Devuelve undefined si no existe, está corrupta o no
// tiene forma válida (para que el llamador haga una pasada completa como fallback).
export async function loadRankingMemory(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<RankingMemory | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(memoryUri(workspaceFolder));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RankingMemory>;
    if (!parsed || !Array.isArray(parsed.ranking) || !Array.isArray(parsed.seenPaths)) {
      return undefined;
    }
    return {
      version: typeof parsed.version === 'number' ? parsed.version : RANKING_VERSION,
      workspaceName: typeof parsed.workspaceName === 'string' ? parsed.workspaceName : workspaceFolder.name,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      mode: parsed.mode === 'update' ? 'update' : 'generate',
      ranking: parsed.ranking
        .filter((entry): entry is RankingEntry => Boolean(entry) && typeof entry.path === 'string')
        .map((entry) => ({ path: entry.path, reason: typeof entry.reason === 'string' ? entry.reason : '' })),
      seenPaths: parsed.seenPaths.filter((path): path is string => typeof path === 'string')
    };
  } catch {
    return undefined;
  }
}

// Escribe la memoria de ranking de forma ATÓMICA (fichero temporal + rename), para
// que un fallo a media escritura no deje la memoria corrupta. `version` y
// `updatedAt` los pone esta función.
export async function saveRankingMemory(
  workspaceFolder: vscode.WorkspaceFolder,
  memory: Omit<RankingMemory, 'version' | 'updatedAt'>
): Promise<void> {
  const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, MEMORY_DIR);
  const fileUri = vscode.Uri.joinPath(dirUri, MEMORY_FILE);
  const tmpUri = vscode.Uri.joinPath(dirUri, `${MEMORY_FILE}.tmp`);

  const full: RankingMemory = {
    version: RANKING_VERSION,
    updatedAt: new Date().toISOString(),
    ...memory
  };
  const bytes = new TextEncoder().encode(JSON.stringify(full, null, 2));

  await vscode.workspace.fs.createDirectory(dirUri);
  await vscode.workspace.fs.writeFile(tmpUri, bytes);
  await vscode.workspace.fs.rename(tmpUri, fileUri, { overwrite: true });
}
