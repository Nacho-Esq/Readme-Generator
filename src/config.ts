import * as vscode from 'vscode';
import { ExtensionSettings } from './types';

export function getSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('readmeGeneratorAi');
  return {
    apiKey: config.get<string>('apiKey', '').trim(),
    endpoint: config.get<string>('endpoint', '').trim(),
    deployment: config.get<string>('deployment', 'test-plantillas-gpt-5.2-codex').trim(),
    templatePath: config.get<string>('templatePath', '').trim(),
    maxFiles: config.get<number>('maxFiles', 24),
    maxBytesPerFile: config.get<number>('maxBytesPerFile', 18_000),
    maxTotalBytes: config.get<number>('maxTotalBytes', 160_000)
  };
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
