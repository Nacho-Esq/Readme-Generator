import * as vscode from 'vscode';
import type { ReadDepth } from './scanner/types';
import { ExtensionSettings } from './types';

export function getSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('readmeGeneratorAi');
  return {
    apiKey: config.get<string>('apiKey', '').trim(),
    endpoint: config.get<string>('endpoint', '').trim(),
    deployment: config.get<string>('deployment', 'test-plantillas-gpt-5.2-codex').trim(),
    templatePath: config.get<string>('templatePath', '').trim(),
    readDepth: normalizeReadDepth(config.get<string>('readDepth', 'básico')),
    maxBytesPerFile: config.get<number>('maxBytesPerFile', 18_000),
    debugTrace: config.get<boolean>('debugTrace', true)
  };
}

export function getReadDepthTokenBudget(readDepth: ReadDepth): number {
  switch (readDepth) {
    case 'profundo':
      return 180_000;
    case 'detallado':
      return 90_000;
    case 'básico':
    default:
      return 30_000;
  }
}

function normalizeReadDepth(value: string | undefined): ReadDepth {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'deep' || normalized === 'profundo') {
    return 'profundo';
  }
  if (normalized === 'detailed' || normalized === 'detallado') {
    return 'detallado';
  }
  return 'básico';
}

export async function ensureConfigured(settings: ExtensionSettings): Promise<boolean> {
  const missing = [];
  if (!settings.apiKey) {
    missing.push('apiKey');
  }
  if (!settings.endpoint) {
    missing.push('endpoint');
  }
  if (!settings.deployment) {
    missing.push('deployment');
  }

  if (missing.length === 0) {
    return true;
  }

  const action = await vscode.window.showErrorMessage(
    `README Generator AI necesita configurar: ${missing.join(', ')}.`,
    'Abrir configuración'
  );
  if (action === 'Abrir configuración') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'readmeGeneratorAi');
  }
  return false;
}
