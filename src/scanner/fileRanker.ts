import * as path from 'path';
import { CandidateFile, RankedFile } from './types';

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
  'helm'
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

const ENTRYPOINT_NAMES = new Set([
  'index',
  'main',
  'server',
  'app',
  'extension',
  'cli',
  'bot'
]);

export async function rankFiles(files: CandidateFile[]): Promise<RankedFile[]> {
  const ranked = files.map(scoreFile);
  return ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function scoreFile(file: CandidateFile): RankedFile {
  const reasons: string[] = [];
  const lower = file.relativePath.toLowerCase();
  const basename = path.basename(lower);
  const ext = path.extname(lower);
  const stem = basename.slice(0, basename.length - ext.length);
  const pathParts = lower.split('/');
  let score = 0;

  if (basename === 'package.json') {
    score += 100;
    reasons.push('package metadata');
  }
  if (basename === 'requirements.txt' || basename === 'pyproject.toml') {
    score += 95;
    reasons.push('python dependency metadata');
  }
  if (basename === '.env.example' || basename.includes('env.example')) {
    score += 75;
    reasons.push('environment variable example');
  }
  if (basename === 'dockerfile' || basename.startsWith('docker-compose')) {
    score += 65;
    reasons.push('deployment metadata');
  }
  if (basename.includes('pipeline') || lower.includes('/.github/workflows/')) {
    score += 60;
    reasons.push('ci/cd metadata');
  }
  if (['.tf', '.bicep'].includes(ext) || lower.includes('/k8s/') || lower.includes('/kubernetes/') || lower.includes('/helm/')) {
    score += 55;
    reasons.push('infrastructure metadata');
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
  if (ENTRYPOINT_NAMES.has(stem)) {
    score += 28;
    reasons.push('likely entrypoint');
  }
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'].includes(ext)) {
    score += 15;
    reasons.push('source file');
  }
  if (['.json', '.toml', '.yaml', '.yml'].includes(ext)) {
    score += 10;
    reasons.push('configuration file');
  }

  const importExportHint = estimateImportExportDensity(lower);
  if (importExportHint > 0) {
    score += importExportHint;
    reasons.push('import/export dense path');
  }

  score += Math.max(0, 10 - lower.split('/').length);
  score -= Math.min(20, Math.floor(file.size / 80_000));

  return { ...file, score, reasons };
}

function estimateImportExportDensity(lowerPath: string): number {
  const basename = path.basename(lowerPath);
  if (basename.includes('routes') || basename.includes('controller') || basename.includes('provider')) {
    return 10;
  }
  if (basename.includes('index') || basename.includes('module')) {
    return 8;
  }
  return 0;
}
