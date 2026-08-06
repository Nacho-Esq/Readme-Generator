// Utilidades de parseo JSON tolerante, compartidas por el cliente de Azure y por los
// pasos que parsean respuestas del modelo (comparación, reconciliación, inserción de
// ranking). `safeJsonParse` nunca lanza; `extractJsonObject` recorta el primer objeto
// `{...}` de un texto por si el modelo lo envuelve en prosa o vallas de código.

export function safeJsonParse<T = unknown>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return text;
  }
  return text.slice(start, end + 1);
}
