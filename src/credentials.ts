import * as vscode from 'vscode';
import { SECRET_API_KEY, SECRET_ENDPOINT } from './config';

// Gestión de credenciales en SecretStorage (llavero del SO).
//
// Por qué aquí y no en los ajustes: un ajuste de VS Code siempre tiene un `default`
// en package.json. Si alguien rellena ese default con una key real para probar y
// empaqueta el .vsix, la key viaja dentro del paquete y aparece "rellenada" en la
// máquina de quien lo instale. SecretStorage elimina esa clase de fuga: no hay
// campo de ajuste, no se sincroniza, no se exporta en perfiles y no se empaqueta.

// Pide la API key con un input oculto y la guarda en SecretStorage. Un valor vacío
// borra la key guardada (para poder revocarla sin dejar rastro).
export async function setApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  const existing = await context.secrets.get(SECRET_API_KEY);
  const value = await vscode.window.showInputBox({
    title: 'CAI Readme-Generator — API key de Azure OpenAI',
    prompt: existing
      ? 'Ya hay una API key guardada. Introduce una nueva para reemplazarla, o deja el campo vacío para borrarla.'
      : 'Introduce tu API key de Azure OpenAI. Se guarda en el almacén seguro del sistema, nunca en settings.json.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: existing ? '•••••••• (ya configurada)' : 'Pega aquí tu API key'
  });

  if (value === undefined) {
    return; // cancelado
  }
  const trimmed = value.trim();
  if (!trimmed) {
    await context.secrets.delete(SECRET_API_KEY);
    vscode.window.showInformationMessage('CAI Readme-Generator: API key borrada del almacén seguro.');
    return;
  }
  await context.secrets.store(SECRET_API_KEY, trimmed);
  vscode.window.showInformationMessage('CAI Readme-Generator: API key guardada en el almacén seguro.');
}

// Pide el endpoint y lo guarda en SecretStorage. El endpoint revela el recurso
// interno de Azure, así que recibe el mismo trato que la key.
export async function setEndpointCommand(context: vscode.ExtensionContext): Promise<void> {
  const existing = await context.secrets.get(SECRET_ENDPOINT);
  const value = await vscode.window.showInputBox({
    title: 'CAI Readme-Generator — Endpoint de Azure OpenAI',
    prompt: 'Endpoint del recurso (por ejemplo https://mi-recurso.openai.azure.com) o la URL completa de la Responses API. Deja el campo vacío para borrarlo.',
    ignoreFocusOut: true,
    value: existing ?? '',
    placeHolder: 'https://mi-recurso.openai.azure.com'
  });

  if (value === undefined) {
    return; // cancelado
  }
  const trimmed = value.trim();
  if (!trimmed) {
    await context.secrets.delete(SECRET_ENDPOINT);
    vscode.window.showInformationMessage('CAI Readme-Generator: endpoint borrado del almacén seguro.');
    return;
  }
  await context.secrets.store(SECRET_ENDPOINT, trimmed);
  vscode.window.showInformationMessage('CAI Readme-Generator: endpoint guardado en el almacén seguro.');
}

// Borra ambas credenciales del almacén seguro.
export async function clearCredentialsCommand(context: vscode.ExtensionContext): Promise<void> {
  await Promise.all([
    context.secrets.delete(SECRET_API_KEY),
    context.secrets.delete(SECRET_ENDPOINT)
  ]);
  vscode.window.showInformationMessage('CAI Readme-Generator: API key y endpoint borrados del almacén seguro.');
}

// Migración única: versiones anteriores guardaban la key y el endpoint como ajustes
// (`readmeGeneratorAi.apiKey` / `.endpoint`) en settings.json, en texto plano y
// sincronizables. Al activar, si aún existen ahí, se mueven a SecretStorage y se
// BORRAN de todos los ámbitos de settings.json para no dejar el texto plano. Es
// idempotente: si no hay nada que migrar, no hace nada ni molesta al usuario.
export async function migrateCredentialsFromSettings(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('readmeGeneratorAi');
  const movedApiKey = await migrateOne(context, config, 'apiKey', SECRET_API_KEY);
  const movedEndpoint = await migrateOne(context, config, 'endpoint', SECRET_ENDPOINT);

  if (movedApiKey || movedEndpoint) {
    const what = [movedApiKey ? 'API key' : null, movedEndpoint ? 'endpoint' : null]
      .filter(Boolean)
      .join(' y ');
    vscode.window.showInformationMessage(
      `CAI Readme-Generator: tu ${what} se ha movido al almacén seguro y se ha borrado de settings.json.`
    );
  }
}

async function migrateOne(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration,
  settingKey: string,
  secretKey: string
): Promise<boolean> {
  const info = config.inspect<string>(settingKey);
  const raw = (info?.globalValue ?? info?.workspaceValue ?? info?.workspaceFolderValue ?? '') as string;
  const trimmed = (raw || '').trim();

  let moved = false;
  if (trimmed && !(await context.secrets.get(secretKey))) {
    await context.secrets.store(secretKey, trimmed);
    moved = true;
  }

  // Purga el valor en texto plano de todos los ámbitos donde pudiera estar escrito.
  for (const target of [
    vscode.ConfigurationTarget.Global,
    vscode.ConfigurationTarget.Workspace,
    vscode.ConfigurationTarget.WorkspaceFolder
  ]) {
    try {
      await config.update(settingKey, undefined, target);
    } catch {
      // Ese ámbito no tenía el valor (o no aplica sin workspace): se ignora.
    }
  }

  return moved;
}
