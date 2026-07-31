import { PanelKind } from '../template/templateSpec';

// Utilidades sobre "fichas" (valores por campo de la plantilla). Compartidas por los
// pasos del actualizador (extraer, comparar). Se leen valores por ruta (p. ej.
// "usage.languages") y se decide si un valor está vacío según el tipo de panel.

export function getFichaValue(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, data);
}

export function isFichaEmpty(value: unknown, panelKind: PanelKind): boolean {
  if (panelKind === 'env') {
    return (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.every((item) => {
        if (!item || typeof item !== 'object') {
          return true;
        }
        const record = item as Record<string, unknown>;
        return isBlank(record.name) && isBlank(record.description);
      })
    );
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => isBlank(item));
  }
  return isBlank(value);
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}
