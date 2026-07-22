import { getAllFields, fieldKey, PanelKind } from '../template/templateSpec';
import { JudgeChange } from '../azure/azureResponsesClient';
import { ReadmeData } from '../types';

// Un cambio que llega al panel de revisión del actualizador. `oldValue` es lo que
// el README dice hoy (según el juez), `newValue` es el valor fresco del repo y
// `reason` la justificación del modelo de por qué es un cambio real.
export interface FieldChange {
  path: string;
  key: string;
  label: string;
  section: string;
  panelKind: PanelKind;
  oldValue: string;
  newValue: unknown;
  reason: string;
}

export interface UpdatePlan {
  changes: FieldChange[];
}

// Construye el plan a partir del veredicto del juez. El juez ya decidió qué campos
// tienen información materialmente nueva; aquí solo validamos y enriquecemos:
//  - descartamos rutas desconocidas o de rol H (nunca se tocan),
//  - descartamos campos cuyo valor fresco del repo esté vacío (nada que aplicar),
//  - tomamos el valor propuesto de `newData` (los datos estructurados del repo).
export function buildPlanFromJudge(judgeChanges: JudgeChange[], newData: ReadmeData): UpdatePlan {
  const byPath = new Map(getAllFields().map((field) => [field.path, field]));
  const changes: FieldChange[] = [];
  const seen = new Set<string>();

  for (const judged of judgeChanges) {
    const field = byPath.get(judged.path);
    if (!field || field.role === 'H' || seen.has(field.path)) {
      continue;
    }
    // Si el juez no encontró qué dice hoy el README para este campo, lo tratamos
    // como ausente: el actualizador solo modifica lo que ya existe, no añade campos.
    if (isBlank(judged.current_readme_value)) {
      continue;
    }
    const newValue = getPathValue(newData, field.path);
    if (isEmpty(newValue, field.panelKind)) {
      continue;
    }
    seen.add(field.path);
    changes.push({
      path: field.path,
      key: fieldKey(field.path),
      label: field.label,
      section: field.section,
      panelKind: field.panelKind,
      oldValue: judged.current_readme_value ?? '',
      newValue,
      reason: judged.reason ?? ''
    });
  }

  return { changes };
}

export function isEmpty(value: unknown, panelKind: PanelKind): boolean {
  if (panelKind === 'env') {
    return !Array.isArray(value) || value.length === 0 || value.every((item) => {
      if (!item || typeof item !== 'object') {
        return true;
      }
      const record = item as Record<string, unknown>;
      return isBlank(record.name) && isBlank(record.description);
    });
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => isBlank(item));
  }
  return isBlank(value);
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}
