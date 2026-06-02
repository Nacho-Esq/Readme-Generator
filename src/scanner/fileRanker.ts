import * as path from 'path';
import * as vscode from 'vscode';
import { CandidateFile, FileInventory, FileKind, FileOverview } from './types';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const CONFIG_EXTENSIONS = new Set(['.json', '.toml', '.yaml', '.yml', '.env', '.example']);
const DOC_EXTENSIONS = new Set(['.md']);
const ENTRYPOINT_NAMES = new Set(['index', 'main', 'server', 'app', 'extension', 'cli', 'bot']);
const PRIORITY_DIRECTORIES = new Set([
  'src',
  'app',
  'server',
  'api',
  'main',
  'docs',
  '.github',
  '.azure',
  'deploy',
  'deployment',
  'infra',
  'k8s',
  'kubernetes',
  'helm',
  'templates'
]);
const PRIORITY_NAME_PARTS = [
  'agent',
  'chatbot',
  'prompt',
  'tool',
  'workflow',
  'service',
  'assistant',
  'config',
  'security',
  'privacy',
  'observability',
  'logging',
  'monitoring',
  'deployment',
  'pipeline',
  'docker',
  'kubernetes',
  'rag'
];
const MAX_OVERVIEW_BYTES = 64_000;
const TOO_LARGE_BYTES = 250_000;
const PROTECTED_FILE_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'readme.md',
  '.env.example',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'azure-pipelines.yml',
  'azure-pipelines.yaml'
]);

export async function rankFiles(files: CandidateFile[]): Promise<FileOverview[]> {
  const overviews = await Promise.all(files.map(buildOverview));
  return sortByRank(overviews);
}

export async function buildFileInventory(files: CandidateFile[]): Promise<FileInventory> {
  const ranked = await rankFiles(files);
  const fallbackRanking: FileOverview[] = [];
  const discarded = new Map<string, string[]>();

  for (const file of ranked) {
    const reason = getSafeDiscardReason(file);
    if (reason) {
      const examples = discarded.get(reason) || [];
      if (examples.length < 8) {
        examples.push(file.relativePath);
      }
      discarded.set(reason, examples);
      continue;
    }
    fallbackRanking.push(file);
  }

  return {
    selectorInventory: fallbackRanking,
    fallbackRanking,
    discardedSummary: Array.from(discarded.entries()).map(([reason, examples]) => ({
      reason,
      count: ranked.filter((file) => getSafeDiscardReason(file) === reason).length,
      examples,
      stage: 'local'
    }))
  };
}

function sortByRank(files: FileOverview[]): FileOverview[] {
  return files.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

async function buildOverview(file: CandidateFile): Promise<FileOverview> {
  const lower = file.relativePath.toLowerCase();
  const basename = path.basename(lower);
  const extension = path.extname(lower);
  const stem = basename.slice(0, basename.length - extension.length);
  const pathParts = lower.split('/');
  const kind = inferKind(lower, extension);
  const isEntrypoint = ENTRYPOINT_NAMES.has(stem) || lower === 'src/extension.ts' || lower === 'app/page.tsx';
  const reasons: string[] = [];
  let score = 0;

  if (basename === 'package.json') {
    score += 120;
    reasons.push('package metadata');
  }
  if (basename === 'requirements.txt' || basename === 'pyproject.toml') {
    score += 105;
    reasons.push('python dependency metadata');
  }
  if (basename === '.env.example' || basename.includes('env.example')) {
    score += 85;
    reasons.push('environment variable example');
  }
  if (basename === 'dockerfile' || basename.startsWith('docker-compose')) {
    score += 75;
    reasons.push('deployment metadata');
  }
  if (basename.includes('pipeline') || lower.includes('/.github/workflows/')) {
    score += 70;
    reasons.push('ci/cd metadata');
  }
  if (['.tf', '.bicep'].includes(extension) || lower.includes('/k8s/') || lower.includes('/kubernetes/') || lower.includes('/helm/')) {
    score += 65;
    reasons.push('infrastructure metadata');
  }
  if (lower === 'readme.md' || lower.includes('architecture') || lower.startsWith('docs/')) {
    score += 60;
    reasons.push('existing documentation');
  }
  if (pathParts.some((part) => PRIORITY_DIRECTORIES.has(part))) {
    score += 35;
    reasons.push('priority source directory');
  }
  for (const part of PRIORITY_NAME_PARTS) {
    if (basename.includes(part)) {
      score += 30;
      reasons.push(`filename contains ${part}`);
    }
  }
  if (isEntrypoint) {
    score += 40;
    reasons.push('likely entrypoint');
  }
  if (kind === 'source') {
    score += 15;
    reasons.push('source file');
  }
  if (kind === 'config') {
    score += 12;
    reasons.push('configuration file');
  }
  if (kind === 'test') {
    score -= 30;
    reasons.push('test file');
  }
  if (kind === 'generated') {
    score -= 100;
    reasons.push('likely generated file');
  }
  if (file.size > TOO_LARGE_BYTES) {
    score -= 25;
    reasons.push('large file');
  }

  const content = await readOverviewContent(file.uri);
  const importsExports = extractImportsExports(content, extension);
  const exportedFunctions = extractExportedFunctions(content, extension);
  const packageScripts = basename === 'package.json' ? extractPackageScripts(content) : [];
  if (importsExports.length > 0) {
    score += Math.min(20, importsExports.length * 2);
    reasons.push('has import/export signals');
  }
  if (exportedFunctions.length > 0) {
    score += Math.min(20, exportedFunctions.length * 2);
    reasons.push('exports functions');
  }

  score += Math.max(0, 10 - lower.split('/').length);
  score -= Math.min(20, Math.floor(file.size / 80_000));

  return {
    ...file,
    score,
    reasons: dedupe(reasons),
    extension,
    modulePath: inferModulePath(file.relativePath),
    kind,
    isEntrypoint,
    isTooLarge: file.size > TOO_LARGE_BYTES,
    importsExports,
    exportedFunctions,
    packageScripts
  };
}

function getSafeDiscardReason(file: FileOverview): string | undefined {
  const lower = file.relativePath.toLowerCase();
  const basename = path.basename(lower);
  if (isProtected(file) || file.isEntrypoint) {
    return undefined;
  }
  if (basename === 'package-lock.json' || basename === 'npm-shrinkwrap.json') {
    return 'lockfile';
  }
  if (file.kind === 'generated') {
    return 'generated artifact';
  }
  if (lower.includes('/__snapshots__/') || lower.includes('/fixtures/') || lower.includes('/fixture/')) {
    return 'test fixture or snapshot';
  }
  if (basename.endsWith('.min.js') || basename.endsWith('.bundle.js')) {
    return 'minified or bundled asset';
  }
  if (file.size > 1_000_000) {
    return 'oversized non-critical file';
  }
  return undefined;
}

function isProtected(file: FileOverview): boolean {
  const lower = file.relativePath.toLowerCase();
  const basename = path.basename(lower);
  return (
    PROTECTED_FILE_NAMES.has(basename) ||
    lower.startsWith('docs/') ||
    lower.includes('/.github/workflows/') ||
    lower.includes('/k8s/') ||
    lower.includes('/kubernetes/') ||
    lower.includes('/helm/')
  );
}

function inferKind(lowerPath: string, extension: string): FileKind {
  const basename = path.basename(lowerPath);
  if (lowerPath.includes('/test/') || lowerPath.includes('/tests/') || lowerPath.includes('__tests__') || /\.(test|spec)\./.test(lowerPath)) {
    return 'test';
  }
  if (lowerPath.includes('/dist/') || lowerPath.includes('/build/') || basename.includes('.generated.') || lowerPath.endsWith('readme.generated.md')) {
    return 'generated';
  }
  if (DOC_EXTENSIONS.has(extension)) {
    return 'docs';
  }
  if (basename === 'dockerfile' || basename.startsWith('docker-compose') || ['.tf', '.bicep'].includes(extension) || lowerPath.includes('/k8s/') || lowerPath.includes('/helm/')) {
    return 'infra';
  }
  if (lowerPath.startsWith('templates/') || extension.includes('template')) {
    return 'template';
  }
  if (CONFIG_EXTENSIONS.has(extension) || basename.includes('config') || basename.includes('pipeline')) {
    return 'config';
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }
  return 'other';
}

function inferModulePath(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length <= 1) {
    return '.';
  }
  if (['src', 'app', 'api', 'server'].includes(parts[0]) && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

async function readOverviewContent(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const slice = bytes.slice(0, MAX_OVERVIEW_BYTES);
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    return '';
  }
}

function extractImportsExports(content: string, extension: string): string[] {
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return [];
  }
  const lines = content.split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter((line) => /^(import\s|export\s|from\s+\S+\s+import\s)/.test(line))
    .slice(0, 3);
}

function extractExportedFunctions(content: string, extension: string): string[] {
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return [];
  }
  const names = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+interface\s+([A-Za-z_$][\w$]*)/g,
    /export\s+type\s+([A-Za-z_$][\w$]*)/g,
    /def\s+([A-Za-z_][\w]*)\s*\(/g
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return Array.from(names).slice(0, 3);
}

function extractPackageScripts(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    return Object.entries(parsed.scripts || {})
      .map(([name, command]) => `${name}: ${command}`)
      .slice(0, 24);
  } catch {
    return [];
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
