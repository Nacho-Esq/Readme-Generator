import * as path from 'path';
import * as vscode from 'vscode';

// Resolución de la CARPETA OBJETIVO del README.
//
// Históricamente el pipeline asumía la raíz del workspace. Pero un proyecto grande
// puede contener subproyectos en subcarpetas, y el usuario querer el README de SOLO una
// de ellas. Aquí se decide, según cómo se invocó el comando, para qué carpeta(s) se va
// a generar/actualizar:
//   - Menú contextual del explorador sobre una carpeta → esa carpeta, sin preguntar.
//   - Paleta de comandos / barra de estado → si solo hay una carpeta candidata, esa; si
//     hay varias (varias carpetas de workspace, o subcarpetas de primer nivel que parecen
//     subproyectos), se pregunta con un QuickPick que incluye la opción "Todas".
//
// La "carpeta objetivo" se representa como una vscode.WorkspaceFolder (real o sintética):
// tiene la forma { uri, name, index } que el resto del pipeline (scanRepository,
// analyzeRepository, resolveStorageDir…) ya consume, así que no hace falta tocar esas
// piezas. Para una subcarpeta se fabrica una WorkspaceFolder sintética con su propia URI,
// lo que además le da un espacio de datos propio (ver resolveStorageDir).
//
// La lógica pura (detección de marcadores de proyecto, selección de subcarpetas
// relevantes) se mantiene separada de la parte acoplada a VS Code para poder testearla.

// Ficheros cuyo nombre exacto delata la raíz de un proyecto (manifiestos de build o de
// dependencias de los ecosistemas más habituales). Su presencia en una subcarpeta de
// primer nivel la convierte en candidata a "subproyecto".
export const PROJECT_MARKER_FILES: ReadonlySet<string> = new Set([
  'package.json',
  'tsconfig.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'composer.json',
  'gemfile',
  'cmakelists.txt',
  'makefile',
  'pubspec.yaml',
  'build.sbt',
  'mix.exs',
  'package.swift',
  'dockerfile'
]);

// Extensiones cuyo solo sufijo delata un proyecto (proyectos .NET, principalmente).
export const PROJECT_MARKER_EXTENSIONS: readonly string[] = ['.csproj', '.fsproj', '.vbproj', '.vcxproj', '.sln'];

// Subcarpetas que nunca son subproyectos que documentar: dependencias, artefactos de
// build, metadatos de herramientas. Se ignoran al buscar candidatas.
const IGNORED_SUBFOLDERS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'out',
  'build',
  'bin',
  'obj',
  'target',
  'coverage',
  '.vscode',
  '.idea',
  '.next',
  '.nuxt',
  '.cache',
  'vendor',
  '__pycache__',
  '.venv',
  'venv'
]);

// ¿El nombre de fichero es un marcador de raíz de proyecto? Comparación insensible a
// mayúsculas (los manifiestos aparecen con capitalizaciones distintas según el SO/proyecto).
export function isProjectMarkerFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (PROJECT_MARKER_FILES.has(lower)) {
    return true;
  }
  return PROJECT_MARKER_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ¿La subcarpeta debe ignorarse (dependencias/artefactos/metadatos)?
export function isIgnoredSubfolder(name: string): boolean {
  return IGNORED_SUBFOLDERS.has(name.toLowerCase());
}

// Descripción mínima de una subcarpeta para decidir su relevancia sin tocar VS Code:
// su nombre y los nombres de sus ficheros/carpetas directos.
export interface SubfolderInfo {
  name: string;
  entries: string[];
}

// Dada la lista de subcarpetas de primer nivel con sus contenidos, devuelve (ordenados)
// los nombres de las que parecen subproyectos: no ignoradas y con algún marcador de
// proyecto entre sus ficheros directos. Puro y testeable.
export function selectRelevantSubfolders(subfolders: SubfolderInfo[]): string[] {
  return subfolders
    .filter((sub) => !isIgnoredSubfolder(sub.name))
    .filter((sub) => sub.entries.some((entry) => isProjectMarkerFile(entry)))
    .map((sub) => sub.name)
    .sort((a, b) => a.localeCompare(b));
}

// Fabrica una WorkspaceFolder sintética a partir de una URI de carpeta arbitraria. El
// resto del pipeline solo usa `uri` y `name`, así que `index: 0` es un valor inocuo.
export function makeTargetFolder(uri: vscode.Uri): vscode.WorkspaceFolder {
  return { uri, name: path.basename(uri.fsPath) || uri.fsPath, index: 0 };
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

// Lee las subcarpetas de primer nivel relevantes de `folderUri` (I/O real). Para cada
// subcarpeta no ignorada lee sus ficheros directos y aplica selectRelevantSubfolders.
async function listRelevantSubfolders(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folderUri);
  } catch {
    return [];
  }
  const subdirNames = entries
    .filter(([name, type]) => (type & vscode.FileType.Directory) !== 0 && !isIgnoredSubfolder(name))
    .map(([name]) => name);

  const infos: SubfolderInfo[] = [];
  for (const name of subdirNames) {
    const childUri = vscode.Uri.joinPath(folderUri, name);
    let childEntries: [string, vscode.FileType][];
    try {
      childEntries = await vscode.workspace.fs.readDirectory(childUri);
    } catch {
      childEntries = [];
    }
    infos.push({ name, entries: childEntries.map(([childName]) => childName) });
  }

  return selectRelevantSubfolders(infos).map((name) => vscode.Uri.joinPath(folderUri, name));
}

function pushUnique(target: vscode.WorkspaceFolder[], seen: Set<string>, folder: vscode.WorkspaceFolder): void {
  const key = folder.uri.toString();
  if (!seen.has(key)) {
    seen.add(key);
    target.push(folder);
  }
}

// Reúne las carpetas candidatas: cada carpeta de workspace y, dentro de ella, las
// subcarpetas de primer nivel que parecen subproyectos.
async function gatherCandidateFolders(): Promise<vscode.WorkspaceFolder[]> {
  const wsFolders = vscode.workspace.workspaceFolders ?? [];
  const candidates: vscode.WorkspaceFolder[] = [];
  const seen = new Set<string>();
  for (const ws of wsFolders) {
    pushUnique(candidates, seen, ws);
    const subUris = await listRelevantSubfolders(ws.uri);
    for (const subUri of subUris) {
      pushUnique(candidates, seen, makeTargetFolder(subUri));
    }
  }
  return candidates;
}

// QuickPick de selección cuando hay varias candidatas, con la opción "Todas" arriba.
// Devuelve las carpetas elegidas, o undefined si el usuario cancela.
async function pickFromCandidates(candidates: vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder[] | undefined> {
  type Item = vscode.QuickPickItem & { folder?: vscode.WorkspaceFolder; all?: boolean };
  const items: Item[] = [
    { label: '$(checklist) Todas', detail: 'Generar/actualizar el README de todas las carpetas candidatas', all: true },
    ...candidates.map((folder) => ({
      label: `$(folder) ${folder.name}`,
      detail: folder.uri.fsPath,
      folder
    }))
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: '¿De qué carpeta quieres el README?',
    matchOnDetail: true
  });
  if (!pick) {
    return undefined;
  }
  if (pick.all) {
    return candidates;
  }
  return pick.folder ? [pick.folder] : undefined;
}

// Punto de entrada: resuelve la(s) carpeta(s) objetivo según la invocación.
//   - `resource` definido (menú contextual sobre una carpeta) → esa carpeta, sin preguntar.
//   - `resource` indefinido (paleta / barra de estado) → una candidata sin preguntar, o
//     QuickPick con "Todas" si hay varias.
// Devuelve undefined cuando no hay que continuar (sin workspace, selección no válida o
// cancelación), y el llamador simplemente aborta sin ruido adicional.
export async function resolveTargetFolders(resource?: vscode.Uri): Promise<vscode.WorkspaceFolder[] | undefined> {
  if (resource) {
    if (await isDirectory(resource)) {
      return [makeTargetFolder(resource)];
    }
    vscode.window.showErrorMessage('Selecciona una carpeta (no un archivo) para generar su README.');
    return undefined;
  }

  const candidates = await gatherCandidateFolders();
  if (candidates.length === 0) {
    vscode.window.showErrorMessage('Abre un repositorio local en VS Code antes de generar el README.');
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates;
  }
  return pickFromCandidates(candidates);
}
