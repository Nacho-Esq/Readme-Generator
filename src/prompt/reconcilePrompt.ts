import { PanelKind } from '../template/templateSpec';

// Un cambio de información aprobado por el usuario en el panel de revisión, listo
// para aplicarse sobre el README. `value` es el valor final elegido (el propuesto
// por el modelo, o el que el usuario editó a mano).
export interface ReconcileChange {
  section: string;
  label: string;
  panelKind: PanelKind;
  value: unknown;
}

// Construye el prompt de RECONCILIACIÓN: recibe el README actual y la lista de
// actualizaciones aprobadas, y pide devolver el README completo con esa
// información actualizada PERO conservando exactamente la estructura del humano.
//
// Deliberadamente NO recibe el código fuente: el modelo solo encaja los valores ya
// decididos en la prosa existente. Extraer = mirar código (fase previa);
// reconciliar = redactar sin re-derivar hechos ni tocar estructura.
export function buildReconcilePrompt(readmeText: string, changes: ReconcileChange[]): string {
  const changeBlocks = changes.map((change, index) => {
    return `${index + 1}. Sección «${change.section}» → «${change.label}»:\n${renderChangeValue(change)}`;
  });

  return [
    'Eres un asistente experto en documentación técnica de proyectos de software.',
    'Recibes un README existente y una lista de actualizaciones de información aprobadas por el equipo.',
    'Tu tarea es devolver el README COMPLETO con esa información actualizada.',
    '',
    'Reglas estrictas e inviolables:',
    '- CONSERVA EXACTAMENTE la estructura del README: los mismos encabezados, con el mismo texto, en el mismo orden. NO añadas secciones nuevas, NO elimines secciones y NO renombres ni reordenes las existentes.',
    '- Aplica ÚNICAMENTE los cambios de la lista. Cada entrada indica en qué sección y campo debe actualizarse la información y cuál es su nuevo valor. Encájalo con naturalidad en la prosa ya existente, en español.',
    '- No modifiques ninguna parte del README que no esté cubierta por la lista de cambios. Respeta literalmente el resto del texto, incluidas las secciones propias del equipo que no aparezcan en la lista.',
    '- No inventes información nueva ni añadas datos que no estén en la lista de cambios.',
    '- Mantén el estilo, el tono y el formato existentes (viñetas, tablas, bloques de código, badges, diagramas Mermaid).',
    '- Si un valor de la lista ya coincide con lo que dice el README, déjalo como está.',
    '- Devuelve SOLO el Markdown final del README, sin comentarios, explicaciones, ni vallas de código (```) envolviéndolo.',
    '',
    'Actualizaciones aprobadas:',
    changeBlocks.length ? changeBlocks.join('\n') : '(ninguna)',
    '',
    'README actual:',
    '```markdown',
    readmeText,
    '```'
  ].join('\n');
}

function renderChangeValue(change: ReconcileChange): string {
  const value = change.value;
  if (change.panelKind === 'env' && Array.isArray(value)) {
    return value
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        return `   - ${str(record.name)}: ${str(record.description)}`;
      })
      .join('\n');
  }
  if (Array.isArray(value)) {
    return value.map((item) => `   - ${str(item)}`).join('\n');
  }
  return `   ${str(value)}`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
