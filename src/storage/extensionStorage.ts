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
//
// El README puede generarse para la raíz del workspace O para una SUBCARPETA arbitraria
// (un subproyecto dentro de un monorepo). Como la subcarpeta tiene una URI distinta a
// la de la raíz, obtiene automáticamente su propia subcarpeta de datos: la memoria de
// ranking de un subproyecto nunca se mezcla con la de otro ni con la de la raíz. Por eso
// el namespacing depende de una "carpeta objetivo" genérica (URI + nombre), no de una
// WorkspaceFolder concreta.

// Carpeta objetivo del pipeline: cualquier carpeta (raíz del workspace o subcarpeta)
// para la que se genera/actualiza el README. Una WorkspaceFolder ya cumple esta forma,
// así que sigue siendo un argumento válido.
export interface TargetFolder {
  readonly uri: vscode.Uri;
  readonly name: string;
}

// Nombre de subcarpeta estable y único por carpeta objetivo: nombre legible + hash de
// la URI. El hash (sobre la URI COMPLETA, no solo el nombre) garantiza que carpetas
// distintas nunca colisionan, incluidas dos subcarpetas con el mismo nombre en árboles
// distintos; el nombre legible ayuda a identificar la carpeta si el usuario la inspecciona.
function folderKey(folder: TargetFolder): string {
  const hash = crypto.createHash('sha1').update(folder.uri.toString()).digest('hex').slice(0, 12);
  const safeName = (folder.name || 'workspace').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  return `${safeName}-${hash}`;
}

// Carpeta de datos de la extensión para esta carpeta objetivo concreta. Devuelve
// undefined solo si no hay workspace abierto (`context.storageUri` undefined), para que
// el llamador degrade con seguridad (la generación sigue funcionando sin memoria y el
// actualizador hace una pasada completa). En la práctica, siempre que haya una carpeta
// abierta, `storageUri` está definido.
export function resolveStorageDir(
  context: vscode.ExtensionContext,
  folder: TargetFolder
): vscode.Uri | undefined {
  if (!context.storageUri) {
    return undefined;
  }
  return vscode.Uri.joinPath(context.storageUri, folderKey(folder));
}
