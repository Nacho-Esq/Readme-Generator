import * as vscode from 'vscode';

export interface CandidateFile {
  uri: vscode.Uri;
  relativePath: string;
  size: number;
}

export interface SelectedFile extends CandidateFile {
  content: string;
  truncated: boolean;
}

export type ReadDepth = 'básico' | 'detallado' | 'profundo' | 'personalizado';

export interface DiscardedFileSummary {
  reason: string;
  count: number;
  examples: string[];
  stage?: 'local' | 'llm';
}

export interface FileSelectionItem {
  path: string;
  reason: string;
}

export interface FileSelectionResult {
  selectedFiles: FileSelectionItem[];
  discardedFiles: FileSelectionItem[];
  warnings: string[];
}

export interface FileInventory {
  selectorInventory: CandidateFile[];
  discardedSummary: DiscardedFileSummary[];
}

export interface DetectedTechnology {
  name: string;
  evidence: string[];
}

export interface DetectedModule {
  name: string;
  path: string;
  fileCount: number;
  kind: 'source' | 'docs' | 'infra' | 'config' | 'templates' | 'other';
}

export interface ProjectStats {
  candidateFiles: number;
  sourceFiles: number;
  documentationFiles: number;
  totalBytes: number;
}

export interface RepositoryStructureEntry {
  path: string;
  kind: 'directory' | 'file';
  depth: number;
  fileCount?: number;
  size?: number;
}

export interface RepositoryMap {
  workspaceName: string;
  technologies: DetectedTechnology[];
  entrypoints: string[];
  modules: DetectedModule[];
  documentation: string[];
  structure: RepositoryStructureEntry[];
  discardedSummary: DiscardedFileSummary[];
  stats: ProjectStats;
}
