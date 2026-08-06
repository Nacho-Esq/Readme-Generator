import * as crypto from 'crypto';
import * as vscode from 'vscode';

// Almacenamiento privado de la extensión, FUERA del repositorio del usuario.
//
// Todos los ficheros que la extensión necesita conservar entre pasadas (memoria de
// ranking, traza de depuración) viven en `context.storageUri`, el directorio que VS
// Code reserva por-workspace para cada extensión. Ventajas frente a escribir en la
// raíz del repo: cero huella (no aparece en `git status`, imposible commitear por
// error), se limpia solo al desinstalar la extensión, y sigue siendo persistente
// entre sesiones.
//
// `context.storageUri` es específico del workspace, pero en un workspace MULTI-ROOT
// lo COMPARTEN todas las carpetas raíz. Por eso namespaciamos por carpeta con una
// subcarpeta propia: así dos proyectos del mismo workspace nunca se pisan sus datos.

// Nombre de subcarpeta estable y único por carpeta de trabajo: nombre legible +
// hash de la ruta. El hash garantiza que carpetas distintas nunca colisionan; el
// nombre legible ayuda a identificar la carpeta si el usuario la inspecciona a mano.
function folderKey(workspaceFolder: vscode.WorkspaceFolder): string {
  const hash = crypto.createHash('sha1').update(workspaceFolder.uri.toString()).digest('hex').slice(0, 12);
  const safeName = (workspaceFolder.name || 'workspace').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  return `${safeName}-${hash}`;
}

// Carpeta de datos de la extensión para este proyecto concreto. Devuelve undefined
// solo si no hay workspace abierto (`context.storageUri` undefined), para que el
// llamador degrade con seguridad (la generación sigue funcionando sin memoria y el
// actualizador hace una pasada completa). En la práctica, siempre que haya una
// WorkspaceFolder abierta, `storageUri` está definido.
export function resolveStorageDir(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Uri | undefined {
  if (!context.storageUri) {
    return undefined;
  }
  return vscode.Uri.joinPath(context.storageUri, folderKey(workspaceFolder));
}
