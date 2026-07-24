// ─────────────────────────────────────────────────────────────────────────────
// Actualizador de README — REDISEÑO v4 (en construcción, fase a fase)
// ─────────────────────────────────────────────────────────────────────────────
//
// OBJETIVOS (recordatorio permanente):
//  1. EDITAR el README existente, nunca regenerarlo. Solo se parchean los campos
//     que el humano apruebe; el resto del documento queda idéntico (garantizado
//     por un diff mecánico en el paso 6).
//  2. Comparar FICHAS (valor estructurado por campo de la plantilla) del README
//     contra las del código — NO prosa contra código, NO regenerar el README.
//  3. Dos direcciones: (A) el README afirma algo que el código no respalda;
//     (B) el código dice algo distinto/nuevo respecto al README.
//  4. Barato y fiable: 1 llamada cara (extracción del código) + varias nano;
//     evidencia obligatoria antes de molestar al humano.
//  5. El GENERADOR no se toca. Esta carpeta (src/update/) aísla el actualizador.
//
// Estos son STUBS: definen la estructura y los tipos para revisión. Cada paso se
// implementa en su fase. La orquestación (ranking, contexto del repo, panel,
// guardado) vive en extension.ts::updateReadme; aquí viven los PASOS puros.

import { AzureResponsesClient } from '../azure/azureResponsesClient';
import { SelectedFile } from '../scanner/types';
import { PanelKind } from '../template/templateSpec';
import { ReadmeData } from '../types';

// Resultado de comparar una ficha del README con la del código (paso 3).
//  - 'same'                → dicen esencialmente lo mismo → NO se toca; se conserva
//                            verbatim el texto del README. El humano no lo ve.
//  - 'readme_unsupported'  → el README afirma algo que el código no respalda.
//                            (Caso 1 del panel: normalmente "quitar/corregir".)
//  - 'code_differs'        → el código dice algo distinto o nuevo respecto al
//                            README. (Caso 2 del panel: "añadir/cambiar".)
export type ComparisonKind = 'same' | 'readme_unsupported' | 'code_differs';

export interface FieldComparison {
  path: string;         // ruta del campo en la plantilla (p. ej. usage.languages)
  label: string;        // etiqueta legible para el panel
  section: string;      // sección de la plantilla
  panelKind: PanelKind; // text | list | env
  readmeValue: unknown; // ficha extraída del README
  codeValue: unknown;   // ficha extraída del código
  kind: ComparisonKind;
}

// Un "sospechoso" (todo lo que NO es 'same') ya verificado contra el código con
// evidencia (paso 4). Es lo que llega al panel para que el humano decida.
export type Recommendation = 'remove' | 'update' | 'add' | 'keep';

export interface VerifiedSuspect extends FieldComparison {
  recommendation: Recommendation;
  proposedValue: unknown; // valor sugerido (vacío si recommendation === 'remove')
  evidence: string;       // fichero(s) + cita que respalda el veredicto
  confidence: number;     // 0..1
}

function notImplemented(step: string): Error {
  return new Error(`updatePipeline: ${step} aún no implementado (rediseño v4 en curso).`);
}

// Paso 1 — README → fichas (nano). Extrae, por campo de la plantilla, qué dice HOY
// el README. La presencia (ficha no vacía) define el alcance.
export async function extractReadmeFichas(
  _client: AzureResponsesClient,
  _readmeText: string,
  _workspaceName: string
): Promise<ReadmeData> {
  throw notImplemented('paso 1 (extractReadmeFichas)');
}

// Paso 2 — Código → fichas (modelo grande, única llamada cara). Reutiliza la
// extracción del generador sobre los ficheros ya seleccionados.
export async function extractCodeFichas(
  _client: AzureResponsesClient,
  _files: SelectedFile[],
  _workspaceName: string
): Promise<ReadmeData> {
  throw notImplemented('paso 2 (extractCodeFichas)');
}

// Paso 3 — Comparar ficha a ficha (nano, en lote). Empareja por significado
// (es = español) y en listas a nivel de elemento (coinciden / nuevo / falta).
export async function compareFichas(
  _client: AzureResponsesClient,
  _readmeFichas: ReadmeData,
  _codeFichas: ReadmeData
): Promise<FieldComparison[]> {
  throw notImplemented('paso 3 (compareFichas)');
}

// Paso 4 — Verificar sospechosos con evidencia (nano). Mira SOLO esos campos y sus
// pocos ficheros; distingue error real de pifia del extractor; cita evidencia.
export async function verifySuspects(
  _client: AzureResponsesClient,
  _suspects: FieldComparison[],
  _files: SelectedFile[]
): Promise<VerifiedSuspect[]> {
  throw notImplemented('paso 4 (verifySuspects)');
}

// Paso 6 — Aplicar los campos aprobados + guardarraíl de diff. Un modelo encaja los
// valores en la prosa existente y luego se verifica mecánicamente que SOLO han
// cambiado los trozos aprobados; si tocó algo ajeno, se rechaza/avisa.
export async function applyApprovedChanges(
  _client: AzureResponsesClient,
  _readmeText: string,
  _approved: VerifiedSuspect[]
): Promise<string> {
  throw notImplemented('paso 6 (applyApprovedChanges)');
}
