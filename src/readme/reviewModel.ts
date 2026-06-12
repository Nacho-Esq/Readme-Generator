import { ReadmeData } from '../types';
import { ALL_FIELDS, FieldDefinition, fieldKey } from './fieldMetadata';

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
  missing: MissingField[];
}

export function createDefaultRenderOptions(): RenderOptions {
  return { omitFields: {}, omitSections: {} };
}

export function analyzeReadmeData(data: ReadmeData): ReviewModel {
  const missing = ALL_FIELDS
    .filter((field) => isMissingValue(getPathValue(data, field.path), field))
    .map((field) => ({
      path: field.path,
      key: fieldKey(field.path),
      label: field.label,
      templateSection: field.templateSection
    }));

  return { missing };
}

export function prepareDataForReview(data: ReadmeData, renderOptions: RenderOptions): ReadmeData {
  const next = JSON.parse(JSON.stringify(data)) as ReadmeData;
  for (const field of ALL_FIELDS) {
    const key = fieldKey(field.path);
    if (renderOptions.omitFields[key]) {
      continue;
    }
    if (isMissingValue(getPathValue(next, field.path), field)) {
      setPathValue(next, field.path, placeholderValue(field));
    }
  }
  return next;
}

export function completeRenderOptions(data: ReadmeData, renderOptions: RenderOptions): RenderOptions {
  const omitSections: Record<string, boolean> = {};
  const sections = new Set(ALL_FIELDS.map((field) => field.templateSection));

  for (const section of sections) {
    const sectionFields = ALL_FIELDS.filter((field) => field.templateSection === section);

    const hasVisibleData = sectionFields.some((field) => {
      const key = fieldKey(field.path);
      return !renderOptions.omitFields[key] && !isMissingValue(getPathValue(data, field.path), field);
    });
    const allMissingAreOmitted = sectionFields.every((field) => {
      const key = fieldKey(field.path);
      return renderOptions.omitFields[key] || !isMissingValue(getPathValue(data, field.path), field);
    });

    omitSections[section] = !hasVisibleData && allMissingAreOmitted;
  }

  return {
    omitFields: { ...renderOptions.omitFields },
    omitSections
  };
}

export function isPlaceholderValue(value: string): boolean {
  return value.trim() === FILL_PLACEHOLDER || value.trim() === `**${FILL_PLACEHOLDER}**`;
}

function placeholderValue(field: FieldDefinition): unknown {
  if (field.kind === 'list') {
    return [FILL_PLACEHOLDER];
  }
  if (field.kind === 'env') {
    return [{ name: FILL_PLACEHOLDER, description: FILL_PLACEHOLDER }];
  }
  return FILL_PLACEHOLDER;
}

function isMissingValue(value: unknown, field: FieldDefinition): boolean {
  if (field.kind === 'env') {
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
