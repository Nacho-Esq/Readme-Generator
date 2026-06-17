import * as path from 'path';
import * as vscode from 'vscode';
import {
  CandidateFile,
  DetectedModule,
  DetectedTechnology,
  DiscardedFileSummary,
  RepositoryMap,
  RepositoryStructureEntry
} from './types';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const DOC_EXTENSIONS = new Set(['.md']);
const ENTRYPOINT_NAMES = new Set([
  'extension.ts',
  'index.ts',
  'index.tsx',
  'index.js',
  'main.ts',
  'main.js',
  'main.py',
  'app.py',
  'server.ts',
  'server.js',
  'cli.ts',
  'cli.js'
]);
const IMPORTANT_ROOT_DIRS = new Set([
  'src',
  'app',
  'api',
  'server',
  'docs',
  'templates',
  'infra',
  'deploy',
  'deployment',
  'k8s',
  'kubernetes',
  'helm',
  '.github',
  '.azure'
]);

export async function analyzeRepository(
  candidates: CandidateFile[],
  workspaceFolder: vscode.WorkspaceFolder,
  discardedSummary: DiscardedFileSummary[] = []
): Promise<RepositoryMap> {
  const sorted = [...candidates].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const pathSet = new Set(sorted.map((file) => file.relativePath.toLowerCase()));
  const technologies = await detectTechnologies(sorted, workspaceFolder);
  const entrypoints = detectEntrypoints(sorted);
  const modules = detectModules(sorted);
  const documentation = detectDocumentation(sorted);
  const structure = buildRepositoryStructure(sorted);

  return {
    workspaceName: workspaceFolder.name,
    technologies,
    entrypoints,
    modules,
    documentation,
    structure,
    discardedSummary,
    stats: {
      candidateFiles: sorted.length,
      sourceFiles: sorted.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase())).length,
      documentationFiles: sorted.filter((file) => DOC_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase())).length,
      totalBytes: sorted.reduce((total, file) => total + file.size, 0)
    }
  };

  function has(relativePath: string): boolean {
    return pathSet.has(relativePath.toLowerCase());
  }

  async function detectTechnologies(
    files: CandidateFile[],
    folder: vscode.WorkspaceFolder
  ): Promise<DetectedTechnology[]> {
    const detected = new Map<string, Set<string>>();
    const add = (name: string, evidence: string): void => {
      if (!detected.has(name)) {
        detected.set(name, new Set());
      }
      detected.get(name)?.add(evidence);
    };

    if (has('package.json')) {
      add('Node.js', 'package.json');
      const packageJson = await readJsonFile<Record<string, unknown>>(folder, 'package.json');
      const deps = packageJson ? collectPackageDependencies(packageJson) : new Set<string>();
      if (has('tsconfig.json') || deps.has('typescript')) {
        add('TypeScript', has('tsconfig.json') ? 'tsconfig.json' : 'package.json');
      }
      if (deps.has('react')) {
        add('React', 'package.json');
      }
      if (deps.has('next')) {
        add('Next.js', 'package.json');
      }
      if (deps.has('vue')) {
        add('Vue', 'package.json');
      }
      if (deps.has('nunjucks')) {
        add('Nunjucks', 'package.json');
      }
      if (deps.has('@types/vscode') || deps.has('vscode')) {
        add('VS Code extension', 'package.json');
      }
    }

    if (has('requirements.txt') || has('pyproject.toml')) {
      add('Python', has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt');
    }
    if (has('dockerfile') || has('docker-compose.yml') || has('docker-compose.yaml')) {
      add('Docker', 'Dockerfile/docker-compose');
    }
    if (files.some((file) => file.relativePath.startsWith('.github/workflows/'))) {
      add('GitHub Actions', '.github/workflows');
    }
    if (files.some((file) => file.relativePath.toLowerCase().startsWith('docs/'))) {
      add('Markdown documentation', 'docs/');
    }

    return Array.from(detected.entries())
      .map(([name, evidence]) => ({ name, evidence: Array.from(evidence).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function buildRepositoryStructure(files: CandidateFile[]): RepositoryStructureEntry[] {
  const directories = new Map<string, RepositoryStructureEntry>();
  const entries: RepositoryStructureEntry[] = [
    {
      path: '.',
      kind: 'directory',
      depth: 0,
      fileCount: files.length
    }
  ];

  for (const file of files) {
    const parts = file.relativePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const directoryPath = parts.slice(0, index).join('/');
      const current = directories.get(directoryPath);
      if (current) {
        current.fileCount = (current.fileCount || 0) + 1;
        continue;
      }
      directories.set(directoryPath, {
        path: directoryPath,
        kind: 'directory',
        depth: index,
        fileCount: 1
      });
    }

    entries.push({
      path: file.relativePath,
      kind: 'file',
      depth: parts.length - 1,
      size: file.size
    });
  }

  return entries
    .concat(Array.from(directories.values()))
    .sort((a, b) => {
      if (a.path === '.') {
        return -1;
      }
      if (b.path === '.') {
        return 1;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return a.path.localeCompare(b.path);
    });
}

function detectEntrypoints(files: CandidateFile[]): string[] {
  return files
    .filter((file) => {
      const lower = file.relativePath.toLowerCase();
      const basename = path.basename(lower);
      return ENTRYPOINT_NAMES.has(basename) || lower === 'src/extension.ts' || lower === 'app/page.tsx';
    })
    .map((file) => file.relativePath)
    .sort()
    .slice(0, 12);
}

function detectModules(files: CandidateFile[]): DetectedModule[] {
  const modules = new Map<string, DetectedModule>();

  for (const file of files) {
    const parts = file.relativePath.split('/');
    const modulePath = chooseModulePath(parts);
    if (!modulePath) {
      continue;
    }

    const current = modules.get(modulePath);
    if (current) {
      current.fileCount += 1;
      continue;
    }

    const name = modulePath.split('/').pop() || modulePath;
    modules.set(modulePath, {
      name,
      path: modulePath,
      fileCount: 1,
      kind: classifyModule(modulePath)
    });
  }

  return Array.from(modules.values())
    .sort((a, b) => {
      if (b.fileCount !== a.fileCount) {
        return b.fileCount - a.fileCount;
      }
      return a.path.localeCompare(b.path);
    })
    .slice(0, 16);
}

function detectDocumentation(files: CandidateFile[]): string[] {
  return files
    .filter((file) => {
      const lower = file.relativePath.toLowerCase();
      return lower.endsWith('.md') && (lower === 'readme.md' || lower.includes('architecture') || lower.startsWith('docs/'));
    })
    .map((file) => file.relativePath)
    .sort()
    .slice(0, 16);
}

function chooseModulePath(parts: string[]): string | undefined {
  if (parts.length === 0) {
    return undefined;
  }

  const first = parts[0];
  if (!IMPORTANT_ROOT_DIRS.has(first)) {
    return undefined;
  }

  if (['src', 'app', 'api', 'server'].includes(first) && parts.length > 2) {
    return `${first}/${parts[1]}`;
  }

  return first;
}

function classifyModule(modulePath: string): DetectedModule['kind'] {
  const lower = modulePath.toLowerCase();
  if (lower.startsWith('docs')) {
    return 'docs';
  }
  if (lower.startsWith('templates')) {
    return 'templates';
  }
  if (
    lower.startsWith('infra') ||
    lower.startsWith('deploy') ||
    lower.startsWith('deployment') ||
    lower.startsWith('k8s') ||
    lower.startsWith('kubernetes') ||
    lower.startsWith('helm') ||
    lower.startsWith('.github') ||
    lower.startsWith('.azure')
  ) {
    return 'infra';
  }
  if (lower.includes('config')) {
    return 'config';
  }
  if (lower.startsWith('src') || lower.startsWith('app') || lower.startsWith('api') || lower.startsWith('server')) {
    return 'source';
  }
  return 'other';
}

async function readJsonFile<T>(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): Promise<T | undefined> {
  try {
    const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, relativePath));
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes)) as T;
  } catch {
    return undefined;
  }
}

function collectPackageDependencies(packageJson: Record<string, unknown>): Set<string> {
  const deps = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const value = packageJson[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const dep of Object.keys(value)) {
        deps.add(dep);
      }
    }
  }
  return deps;
}
