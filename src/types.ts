import type { ReadDepth } from './scanner/types';

export interface EnvVariableInfo {
  name: string;
  description: string;
}

export interface ContactInfo {
  product_owner: string;
  technical_owner: string;
  responsible_team: string;
  support_operations: string;
}

export interface SummaryInfo {
  what_is: string;
  project_type: string;
  purpose: string;
  target_users: string[];
  status: string;
  success_criteria: string;
}

export interface ScopeInfo {
  includes: string[];
  excludes: string[];
  known_limitations: string[];
}

export interface UsageInfo {
  channels: string[];
  languages: string[];
  contexts: string[];
}

export interface UxInfo {
  start_flow: string;
  expected_questions: string[];
  attachments_support: string;
  fallback_error_handling: string;
  human_handoff: string;
  history_session_memory: string;
}

export interface ArchitectureInfo {
  logical_flow: string;
  components: string[];
  external_dependencies: string[];
}

export interface KnowledgePromptsInfo {
  sources: string[];
  rag_summary: string;
  prompt_guardrails_location: string;
  forbidden_content_handling: string;
}

export interface SecurityPrivacyInfo {
  processed_data: string[];
  retention_storage: string;
  access_auth: string;
  anonymization_secrets: string;
  compliance_notes: string;
}

export interface LocalDevelopmentInfo {
  requirements: string[];
  env_variables: EnvVariableInfo[];
  resources: string[];
  install_run_commands: string[];
  validation_checks: string[];
  testing_strategy: string;
}

export interface DeploymentInfo {
  environments: string[];
  process: string;
  environment_differences: string;
}

export interface OperationsInfo {
  logs: string;
  traces: string;
  metrics: string;
  alerts_runbooks: string;
  incident_process: string;
}

export interface DocumentationLinksInfo {
  coordination_tools: string[];
  repos_pipelines: string[];
  environments_resources: string[];
  manuals_docs: string[];
}

export interface ReadmeData {
  project_name: string;
  screenshot_path: string;
  summary: SummaryInfo;
  scope: ScopeInfo;
  usage: UsageInfo;
  ux: UxInfo;
  architecture: ArchitectureInfo;
  knowledge_prompts: KnowledgePromptsInfo;
  security_privacy: SecurityPrivacyInfo;
  local_development: LocalDevelopmentInfo;
  deployment: DeploymentInfo;
  operations: OperationsInfo;
  documentation_links: DocumentationLinksInfo;
  roadmap: string[];
  contacts: ContactInfo;
  related_projects: string[];
}

export interface ExtractionResult {
  data: ReadmeData;
  warnings: string[];
}

export interface ExtensionSettings {
  apiKey: string;
  endpoint: string;
  deployment: string;
  templatePath: string;
  readDepth: ReadDepth;
  maxBytesPerFile: number;
  debugTrace: boolean;
}
