import * as vscode from 'vscode';
import type { ReadDepth } from './scanner/types';
import { ExtensionSettings } from './types';

// Claves del almacén seguro (SecretStorage) para las credenciales. La API key y el
// endpoint NO son ajustes de VS Code: un ajuste siempre tiene un `default` en el
// package.json, y ese default puede acabar "horneado" en el .vsix si alguien lo
// rellena para probar (fue justo el origen de la fuga que motivó este cambio).
// SecretStorage vive en el llavero del SO: no se sincroniza, no se exporta en
// perfiles y no aparece en ningún settings.json ni en el paquete.
export const SECRET_API_KEY = 'readmeGeneratorAi.apiKey';
export const SECRET_ENDPOINT = 'readmeGeneratorAi.endpoint';

export async function getSettings(context: vscode.ExtensionContext): Promise<ExtensionSettings> {
  const config = vscode.workspace.getConfiguration('readmeGeneratorAi');
  const apiKey = ((await context.secrets.get(SECRET_API_KEY)) ?? '').trim();
  const endpoint = ((await context.secrets.get(SECRET_ENDPOINT)) ?? '').trim();
  return {
    apiKey,
    endpoint,
    deployment: config.get<string>('deployment', '').trim(),
    preSelectionDeployment: config.get<string>('preSelectionDeployment', '').trim(),
    templatePath: config.get<string>('templatePath', '').trim(),
    readDepth: normalizeReadDepth(config.get<string>('readDepth', 'básico')),
    customTokenBudget: config.get<number>('readDepthCustomBudget')
  };
}

export function getPreSelectionDeployment(settings: ExtensionSettings): string {
  // Si no se configura un modelo ligero, se usa el modelo principal. Así no queda
  // ningún nombre de deployment interno escrito en el código.
  return settings.preSelectionDeployment?.trim() || settings.deployment;
}

export function getReadDepthTokenBudget(readDepth: ReadDepth, customTokenBudget?: number): number {
  switch (readDepth) {
    case 'profundo':
      return 180_000;
    case 'detallado':
      return 90_000;
    case 'personalizado':
      return Math.max(1_000, customTokenBudget ?? 30_000);
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
  if (normalized === 'personalizado' || normalized === 'custom') {
    return 'personalizado';
  }
  return 'básico';
}

// Verifica que estén las tres piezas imprescindibles (API key, endpoint y
// deployment) y, si falta alguna, guía al usuario al comando o ajuste concreto.
// La key y el endpoint se piden por comando (van a SecretStorage); el deployment
// es un ajuste normal.
export async function ensureConfigured(settings: ExtensionSettings): Promise<boolean> {
  if (!settings.apiKey) {
    const action = await vscode.window.showErrorMessage(
      'CAI Readme-Generator: falta la API key de Azure OpenAI.',
      'Introducir API key'
    );
    if (action === 'Introducir API key') {
      await vscode.commands.executeCommand('readmeGeneratorAi.setApiKey');
    }
    return false;
  }

  if (!settings.endpoint) {
    const action = await vscode.window.showErrorMessage(
      'CAI Readme-Generator: falta el endpoint de Azure OpenAI.',
      'Introducir endpoint'
    );
    if (action === 'Introducir endpoint') {
      await vscode.commands.executeCommand('readmeGeneratorAi.setEndpoint');
    }
    return false;
  }

  if (!settings.deployment) {
    const action = await vscode.window.showErrorMessage(
      'CAI Readme-Generator: falta el nombre del deployment del modelo.',
      'Abrir configuración'
    );
    if (action === 'Abrir configuración') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'readmeGeneratorAi.deployment');
    }
    return false;
  }

  return true;
}
