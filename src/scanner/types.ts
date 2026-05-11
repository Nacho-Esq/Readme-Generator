import * as vscode from 'vscode';

export interface CandidateFile {
  uri: vscode.Uri;
  relativePath: string;
  size: number;
}

export interface RankedFile extends CandidateFile {
  score: number;
  reasons: string[];
}

export interface SelectedFile extends RankedFile {
  content: string;
  truncated: boolean;
}
