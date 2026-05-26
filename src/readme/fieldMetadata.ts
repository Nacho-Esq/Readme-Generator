export type FieldKind = 'text' | 'list' | 'env';
export type FieldImportance = 'essential' | 'optional';

export interface FieldDefinition {
  path: string;
  label: string;
  kind: FieldKind;
  importance: FieldImportance;
  templateSection: string;
  hint?: string;
}

export interface FormSection {
  title: string;
  fields: FieldDefinition[];
}

export const FORM_SECTIONS: FormSection[] = [
  {
    title: 'Base',
    fields: [
      { path: 'project_name', label: 'Nombre del proyecto', kind: 'text', importance: 'essential', templateSection: 'base' },
      { path: 'screenshot_path', label: 'Ruta de captura/GIF', kind: 'text', importance: 'optional', templateSection: 'base' }
    ]
  },
  {
    title: 'Resumen',
    fields: [
      { path: 'summary.what_is', label: 'Qué es', kind: 'text', importance: 'essential', templateSection: 'summary' },
      { path: 'summary.project_type', label: 'Tipo de proyecto', kind: 'text', importance: 'essential', templateSection: 'summary' },
      { path: 'summary.purpose', label: 'Propósito', kind: 'text', importance: 'essential', templateSection: 'summary' },
      { path: 'summary.target_users', label: 'Usuarios objetivo', kind: 'list', importance: 'essential', templateSection: 'summary' },
      { path: 'summary.status', label: 'Estado', kind: 'text', importance: 'optional', templateSection: 'summary' },
      { path: 'summary.success_criteria', label: 'Objetivo y éxito', kind: 'text', importance: 'optional', templateSection: 'summary' }
    ]
  },
  {
    title: 'Alcance y Uso',
    fields: [
      { path: 'scope.includes', label: 'Qué incluye', kind: 'list', importance: 'essential', templateSection: 'scope' },
      { path: 'scope.excludes', label: 'Qué no incluye', kind: 'list', importance: 'optional', templateSection: 'scope' },
      { path: 'scope.known_limitations', label: 'Limitaciones conocidas', kind: 'list', importance: 'optional', templateSection: 'scope' },
      { path: 'usage.channels', label: 'Canales', kind: 'list', importance: 'essential', templateSection: 'usage' },
      { path: 'usage.languages', label: 'Idiomas', kind: 'list', importance: 'optional', templateSection: 'usage' },
      { path: 'usage.contexts', label: 'Contextos de uso', kind: 'list', importance: 'essential', templateSection: 'usage' }
    ]
  },
  {
    title: 'Experiencia de Usuario',
    fields: [
      { path: 'ux.start_flow', label: 'Cómo se inicia', kind: 'text', importance: 'essential', templateSection: 'ux' },
      { path: 'ux.expected_questions', label: 'Preguntas esperadas', kind: 'list', importance: 'essential', templateSection: 'ux' },
      { path: 'ux.attachments_support', label: 'Adjuntos', kind: 'text', importance: 'optional', templateSection: 'ux' },
      { path: 'ux.fallback_error_handling', label: 'Errores y fallback', kind: 'text', importance: 'essential', templateSection: 'ux' },
      { path: 'ux.human_handoff', label: 'Handoff a humano', kind: 'text', importance: 'optional', templateSection: 'ux' },
      { path: 'ux.history_session_memory', label: 'Historial/memoria', kind: 'text', importance: 'optional', templateSection: 'ux' }
    ]
  },
  {
    title: 'Arquitectura y Conocimiento',
    fields: [
      { path: 'architecture.logical_flow', label: 'Diagrama/flujo lógico', kind: 'text', importance: 'essential', templateSection: 'architecture' },
      { path: 'architecture.components', label: 'Componentes principales', kind: 'list', importance: 'essential', templateSection: 'architecture' },
      { path: 'architecture.external_dependencies', label: 'Dependencias externas', kind: 'list', importance: 'essential', templateSection: 'architecture' },
      { path: 'knowledge_prompts.sources', label: 'Fuentes de conocimiento', kind: 'list', importance: 'essential', templateSection: 'knowledge' },
      { path: 'knowledge_prompts.rag_summary', label: 'Recuperación/RAG', kind: 'text', importance: 'essential', templateSection: 'knowledge' },
      { path: 'knowledge_prompts.prompt_guardrails_location', label: 'Prompts/guardrails', kind: 'text', importance: 'essential', templateSection: 'knowledge' },
      { path: 'knowledge_prompts.forbidden_content_handling', label: 'Contenido no permitido', kind: 'text', importance: 'optional', templateSection: 'knowledge' }
    ]
  },
  {
    title: 'Seguridad y Privacidad',
    fields: [
      { path: 'security_privacy.processed_data', label: 'Datos tratados', kind: 'list', importance: 'essential', templateSection: 'security' },
      { path: 'security_privacy.retention_storage', label: 'Retención/almacenamiento', kind: 'text', importance: 'optional', templateSection: 'security' },
      { path: 'security_privacy.access_auth', label: 'Acceso/autenticación', kind: 'text', importance: 'essential', templateSection: 'security' },
      { path: 'security_privacy.anonymization_secrets', label: 'Anonimización/secretos', kind: 'text', importance: 'essential', templateSection: 'security' },
      { path: 'security_privacy.compliance_notes', label: 'Cumplimiento', kind: 'text', importance: 'optional', templateSection: 'security' }
    ]
  },
  {
    title: 'Desarrollo Local',
    fields: [
      { path: 'local_development.requirements', label: 'Requisitos', kind: 'list', importance: 'essential', templateSection: 'local_development' },
      { path: 'local_development.env_variables', label: 'Variables de entorno', kind: 'env', importance: 'essential', templateSection: 'local_development', hint: 'Una variable por línea: NOMBRE: descripción' },
      { path: 'local_development.resources', label: 'Recursos/datos', kind: 'list', importance: 'optional', templateSection: 'local_development' },
      { path: 'local_development.install_run_commands', label: 'Comandos de instalación/arranque', kind: 'list', importance: 'essential', templateSection: 'local_development' },
      { path: 'local_development.validation_checks', label: 'Validación rápida', kind: 'list', importance: 'essential', templateSection: 'local_development' },
      { path: 'local_development.testing_strategy', label: 'Pruebas', kind: 'text', importance: 'essential', templateSection: 'local_development' }
    ]
  },
  {
    title: 'Despliegue y Operación',
    fields: [
      { path: 'deployment.environments', label: 'Entornos', kind: 'list', importance: 'optional', templateSection: 'deployment' },
      { path: 'deployment.process', label: 'Proceso de despliegue', kind: 'text', importance: 'essential', templateSection: 'deployment' },
      { path: 'deployment.environment_differences', label: 'Diferencias por entorno', kind: 'text', importance: 'optional', templateSection: 'deployment' },
      { path: 'operations.logs', label: 'Logs', kind: 'text', importance: 'optional', templateSection: 'operations' },
      { path: 'operations.traces', label: 'Trazas', kind: 'text', importance: 'optional', templateSection: 'operations' },
      { path: 'operations.metrics', label: 'Métricas', kind: 'text', importance: 'optional', templateSection: 'operations' },
      { path: 'operations.alerts_runbooks', label: 'Alertas/runbooks', kind: 'text', importance: 'optional', templateSection: 'operations' },
      { path: 'operations.incident_process', label: 'Proceso de incidencias', kind: 'text', importance: 'optional', templateSection: 'operations' }
    ]
  },
  {
    title: 'Documentación y Ownership',
    fields: [
      { path: 'documentation_links.coordination_tools', label: 'Gestión y coordinación', kind: 'list', importance: 'optional', templateSection: 'documentation' },
      { path: 'documentation_links.repos_pipelines', label: 'Repositorios y CI/CD', kind: 'list', importance: 'optional', templateSection: 'documentation' },
      { path: 'documentation_links.environments_resources', label: 'Entornos y recursos', kind: 'list', importance: 'optional', templateSection: 'documentation' },
      { path: 'documentation_links.manuals_docs', label: 'Manuales/docs', kind: 'list', importance: 'optional', templateSection: 'documentation' },
      { path: 'roadmap', label: 'Roadmap/mejoras', kind: 'list', importance: 'optional', templateSection: 'roadmap' },
      { path: 'contacts.product_owner', label: 'Product owner', kind: 'text', importance: 'optional', templateSection: 'contacts' },
      { path: 'contacts.technical_owner', label: 'Responsable técnico', kind: 'text', importance: 'optional', templateSection: 'contacts' },
      { path: 'contacts.responsible_team', label: 'Equipo responsable', kind: 'text', importance: 'optional', templateSection: 'contacts' },
      { path: 'contacts.support_operations', label: 'Soporte/Operación', kind: 'text', importance: 'optional', templateSection: 'contacts' },
      { path: 'related_projects', label: 'Proyectos relacionados', kind: 'list', importance: 'optional', templateSection: 'related_projects' }
    ]
  }
];

export const ALL_FIELDS = FORM_SECTIONS.flatMap((section) => section.fields);

export function fieldKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_');
}
