import { ReadmeData } from '../types';
import { FieldSpec, getAllFields } from '../template/templateSpec';

// Segunda llamada del modelo grande en el modo actualizar (el JUEZ). Recibe el
// README actual y la información fresca extraída del repo (`newData`) y decide,
// campo por campo y SOLO para campos M/A, cuáles traen información materialmente
// nueva frente a lo que el README ya dice, y cuáles son la misma info reformulada
// (que NO se tocan). Fuerza un `motivo` por campo para obligar a la reflexión.
export function buildUpdateJudgePrompt(readmeText: string, newData: ReadmeData): string {
  const fieldBlocks: string[] = [];
  for (const field of getAllFields()) {
    if (field.role === 'H') {
      continue; // Los campos H nunca se buscan ni se tocan.
    }
    const value = getPathValue(newData, field.path);
    if (isEmptyValue(value, field)) {
      continue; // Sin dato fresco del repo → nada que comparar para este campo.
    }
    fieldBlocks.push(
      `- path: ${field.path}\n  campo: ${field.label} (sección «${field.section}»)\n  significado: ${field.instruction}\n  valor_en_repo: ${formatValue(value, field)}`
    );
  }

  return [
    'Eres un asistente experto en documentación técnica. Estás ACTUALIZANDO un README existente; NO lo reescribas ni cambies su estructura.',
    'Te doy dos cosas: (1) el README actual del proyecto y (2) información fresca extraída HOY del repositorio, campo por campo.',
    '',
    'Tu tarea: para CADA campo de la lista, reflexiona y decide si la información del repositorio es MATERIALMENTE distinta de lo que el README ya dice para ese campo, o si es esencialmente la misma información expresada de otra forma.',
    '',
    'Reglas estrictas:',
    '- Propón un cambio SOLO si se cumplen las dos condiciones: (a) el campo YA aparece cubierto en el README actual, y (b) la información del repositorio aporta algo materialmente nuevo o distinto (un dato, versión, paso, dependencia, comportamiento… que cambia el significado).',
    '- Si es la MISMA información redactada de otra manera (sinónimos, otro orden, otra frase con el mismo contenido), NO la incluyas: se mantiene lo que hay.',
    '- Si el campo NO aparece en el README actual (el equipo lo omitió o descartó a propósito), NO lo incluyas: no se añaden campos ni secciones nuevas.',
    '- No consideres nunca datos de contacto, propietarios, estado o roadmap escritos por personas: no están en esta lista y no debes tocarlos.',
    '- No inventes: básate solo en el README y en los valores del repositorio proporcionados.',
    '',
    'Para cada campo que SÍ cambie, devuelve: `path` (exacto, de la lista), `current_readme_value` (lo que el README dice hoy para ese campo, resumido y textual; cadena vacía si no lo encuentras) y `reason` (por qué es un cambio real y no una reformulación).',
    'Devuelve únicamente los campos que realmente cambian. Si ninguno cambia, devuelve una lista vacía.',
    '',
    'Campos a evaluar (con la información fresca del repositorio):',
    fieldBlocks.length ? fieldBlocks.join('\n') : '(ninguno)',
    '',
    'README actual:',
    '```markdown',
    readmeText,
    '```'
  ].join('\n');
}

export function getUpdateJudgeJsonSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['changes'],
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'current_readme_value', 'reason'],
          properties: {
            path: { type: 'string', description: 'Ruta exacta del campo, tal cual aparece en la lista.' },
            current_readme_value: { type: 'string', description: 'Lo que el README dice hoy para ese campo (resumido). Vacío si no se encuentra.' },
            reason: { type: 'string', description: 'Por qué es un cambio real y no una reformulación de la misma información.' }
          }
        }
      }
    }
  };
}

function isEmptyValue(value: unknown, field: FieldSpec): boolean {
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

function formatValue(value: unknown, field: FieldSpec): string {
  if (field.panelKind === 'env' && Array.isArray(value)) {
    return value
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        return `${str(record.name)}: ${str(record.description)}`.trim();
      })
      .filter(Boolean)
      .join(' | ');
  }
  if (Array.isArray(value)) {
    return value.map(str).filter(Boolean).join(' | ');
  }
  return str(value);
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}
