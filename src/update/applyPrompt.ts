// Paso 6 del actualizador — prompt de aplicación. Recibe el README y la lista de cambios
// aprobados (sección, nombre, valor actual, valor nuevo o "quitar") y hace un reemplazo
// PUNTUAL en su sitio, sin tocar nada más. No re-deriva ni reescribe: localiza y sustituye.

export interface ApplyChange {
  section: string;
  label: string;
  action: 'update' | 'remove';
  currentText: string; // valor actual en el README (para localizar el sitio)
  newText: string;     // valor nuevo (formato del campo) — vacío si remove
}

export function buildApplyPrompt(readmeText: string, changes: ApplyChange[]): string {
  const blocks = changes
    .map((change, index) => {
      const head = `${index + 1}. Sección «${change.section}» → «${change.label}» — ${change.action === 'remove' ? 'QUITAR' : 'ACTUALIZAR'}`;
      if (change.action === 'remove') {
        return `${head}\nValor actual (a eliminar):\n${indent(change.currentText)}`;
      }
      return `${head}\nValor actual:\n${indent(change.currentText)}\nValor nuevo:\n${indent(change.newText)}`;
    })
    .join('\n\n');

  return [
    'Eres un asistente experto en documentación técnica de proyectos de software.',
    'Recibes un README existente y una lista de CAMBIOS aprobados por el equipo. Devuelve el README COMPLETO con esos cambios aplicados y NADA MÁS.',
    '',
    'Reglas inviolables:',
    '- Sustituye EN SU SITIO el valor actual de cada campo por el nuevo. Localiza cada campo por su sección y su nombre; usa el "valor actual" para encontrar el sitio exacto, aunque el formato no calce carácter a carácter.',
    '- Para un cambio de tipo QUITAR, elimina ese dato dejando el texto coherente (sin frases a medias ni listas vacías); no borres la sección si tiene más contenido.',
    '- CONSERVA EXACTAMENTE el resto del README: los mismos encabezados (mismo texto y orden) y toda la prosa, secciones y datos que no estén en la lista. NO añadas, elimines ni renombres secciones.',
    '- Mantén el estilo y el formato existentes (viñetas, tablas, bloques de código, badges, diagramas Mermaid).',
    '- Devuelve SOLO el Markdown final del README, sin comentarios ni vallas de código (```) envolviéndolo.',
    '',
    'Cambios aprobados:',
    blocks,
    '',
    'README actual:',
    '```markdown',
    readmeText,
    '```'
  ].join('\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
