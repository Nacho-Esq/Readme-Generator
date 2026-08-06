import { ReadmeData } from '../types';
import { FieldSpec, fieldKey, getAllFields } from '../template/templateSpec';
import { getValueAtPath } from '../utils/objectPath';

export const FILL_PLACEHOLDER = 'RELLENAR POR USUARIO';

export interface RenderOptions {
  omitFields: Record<string, boolean>;
  omitSections: Record<string, boolean>;
}

export interface MissingField {
  path: string;
  key: string;
  label: string;
  templateSection: string;
}

export interface ReviewModel {
  // Campos sin valor que el usuario debe completar (M/A vacíos y campos H).
  missing: MissingField[];
  // Campos A que el modelo SÍ rellenó: requieren verificación humana antes de
  // guardar. Los A que quedaron vacíos no van aquí, sino en `missing`.
  reviewNeeded: MissingField[];
}

export function createDefaultRenderOptions(): RenderOptions {
  return { omitFields: {}, omitSections: {} };
}

export function analyzeReadmeData(data: ReadmeData): ReviewModel {
  const describe = (field: FieldSpec): MissingField => ({
    path: field.path,
    key: fieldKey(field.path),
    label: field.label,
    templateSection: field.section
  });

  const missing = getAllFields()
    .filter((field) => isMissingValue(getValueAtPath(data, field.path), field))
    .map(describe);

  const reviewNeeded = getAllFields()
    .filter((field) => field.role === 'A' && !isMissingValue(getValueAtPath(data, field.path), field))
    .map(describe);

  return { missing, reviewNeeded };
}

export function prepareDataForReview(data: ReadmeData, renderOptions: RenderOptions): ReadmeData {
  const next = JSON.parse(JSON.stringify(data)) as ReadmeData;
  for (const field of getAllFields()) {
    const key = fieldKey(field.path);
    if (renderOptions.omitFields[key]) {
      continue;
    }
    if (isMissingValue(getValueAtPath(next, field.path), field)) {
      setPathValue(next, field.path, placeholderValue(field));
    }
  }
  return next;
}

export function completeRenderOptions(data: ReadmeData, renderOptions: RenderOptions): RenderOptions {
  const omitSections: Record<string, boolean> = {};
  const allFields = getAllFields();
  // Solo las secciones con marcador <!--section:KEY--> son omitibles; se agrupan
  // por esa clave para que coincida con lo que consume el render.
  const sectionKeys = new Set(
    allFields.map((field) => field.sectionKey).filter((key): key is string => Boolean(key))
  );

  for (const sectionKey of sectionKeys) {
    const sectionFields = allFields.filter((field) => field.sectionKey === sectionKey);

    const hasVisibleData = sectionFields.some((field) => {
      const key = fieldKey(field.path);
      return !renderOptions.omitFields[key] && !isMissingValue(getValueAtPath(data, field.path), field);
    });
    const allMissingAreOmitted = sectionFields.every((field) => {
      const key = fieldKey(field.path);
      return renderOptions.omitFields[key] || !isMissingValue(getValueAtPath(data, field.path), field);
    });

    omitSections[sectionKey] = !hasVisibleData && allMissingAreOmitted;
  }

  return {
    omitFields: { ...renderOptions.omitFields },
    omitSections
  };
}

export function isPlaceholderValue(value: string): boolean {
  return value.trim() === FILL_PLACEHOLDER || value.trim() === `**${FILL_PLACEHOLDER}**`;
}

function placeholderValue(field: FieldSpec): unknown {
  if (field.panelKind === 'list') {
    return [FILL_PLACEHOLDER];
  }
  if (field.panelKind === 'env') {
    return [{ name: FILL_PLACEHOLDER, description: FILL_PLACEHOLDER }];
  }
  return FILL_PLACEHOLDER;
}

function isMissingValue(value: unknown, field: FieldSpec): boolean {
  if (field.panelKind === 'env') {
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

function setPathValue(target: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    current[part] = current[part] || {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
