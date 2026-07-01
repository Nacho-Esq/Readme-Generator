import type { ReadDepth } from './scanner/types';

// La estructura de ReadmeData ya NO se define aquí: se deriva de la plantilla
// (templates/readme.template.md) en tiempo de ejecución. Este alias laxo permite
// seguir tipando los datos sin duplicar la estructura. El acceso a campos es
// dinámico (por ruta), así que añadir un campo a la plantilla no requiere tocar
// este fichero.
export type ReadmeData = Record<string, unknown>;

export interface ExtractionResult {
  data: ReadmeData;
  warnings: string[];
}

export interface ExtensionSettings {
  apiKey: string;
  endpoint: string;
  deployment: string;
  preSelectionDeployment?: string;
  templatePath: string;
  readDepth: ReadDepth;
  customTokenBudget?: number;
  debugTrace: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
