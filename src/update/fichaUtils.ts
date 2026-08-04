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

// Convierte el valor de una ficha a texto legible para el prompt de comparación:
// listas → un elemento por línea; env → "NOMBRE: descripción" por línea; texto → tal cual.
export function formatFichaValue(value: unknown, panelKind: PanelKind): string {
  if (panelKind === 'env' && Array.isArray(value)) {
    return value
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        return `${str(record.name)}: ${str(record.description)}`.trim();
      })
      .filter(Boolean)
      .join('\n');
  }
  if (Array.isArray(value)) {
    return value.map(str).filter(Boolean).join('\n');
  }
  return str(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

// Inverso de formatFichaValue: convierte el texto que devuelve el modelo (o edita el
// usuario) al valor estructurado según el tipo de panel del campo.
export function parseFichaText(raw: string, panelKind: PanelKind): unknown {
  const text = raw.replace(/\r/g, '');
  if (panelKind === 'list') {
    return text.split('\n').map((line) => line.trim()).filter(Boolean);
  }
  if (panelKind === 'env') {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(':');
        if (index === -1) {
          return { name: line, description: '' };
        }
        return { name: line.slice(0, index).trim(), description: line.slice(index + 1).trim() };
      })
      .filter((item) => item.name);
  }
  return text.trim();
}
