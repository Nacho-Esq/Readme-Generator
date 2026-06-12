export type FieldKind = 'text' | 'list' | 'env';

export interface FieldDefinition {
  path: string;
  label: string;
  kind: FieldKind;
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
      { path: 'project_name', label: 'Nombre del proyecto', kind: 'text', templateSection: 'base' },
      { path: 'screenshot_path', label: 'Ruta de captura/GIF', kind: 'text', templateSection: 'base' }
    ]
  },
  {
    title: 'Resumen',
    fields: [
      { path: 'summary.what_is', label: 'Qué es', kind: 'text', templateSection: 'summary' },
      { path: 'summary.project_type', label: 'Tipo de proyecto', kind: 'text', templateSection: 'summary' },
      { path: 'summary.purpose', label: 'Propósito', kind: 'text', templateSection: 'summary' },
      { path: 'summary.target_users', label: 'Usuarios objetivo', kind: 'list', templateSection: 'summary' },
      { path: 'summary.status', label: 'Estado', kind: 'text', templateSection: 'summary' },
      { path: 'summary.success_criteria', label: 'Objetivo y éxito', kind: 'text', templateSection: 'summary' }
    ]
  },
  {
    title: 'Alcance y Uso',
    fields: [
      { path: 'scope.includes', label: 'Qué incluye', kind: 'list', templateSection: 'scope' },
      { path: 'scope.excludes', label: 'Qué no incluye', kind: 'list', templateSection: 'scope' },
      { path: 'scope.known_limitations', label: 'Limitaciones conocidas', kind: 'list', templateSection: 'scope' },
      { path: 'usage.channels', label: 'Canales', kind: 'list', templateSection: 'usage' },
      { path: 'usage.languages', label: 'Idiomas', kind: 'list', templateSection: 'usage' },
      { path: 'usage.contexts', label: 'Contextos de uso', kind: 'list', templateSection: 'usage' }
    ]
  },
  {
    title: 'Experiencia de Usuario',
    fields: [
      { path: 'ux.start_flow', label: 'Cómo se inicia', kind: 'text', templateSection: 'ux' },
      { path: 'ux.expected_questions', label: 'Preguntas esperadas', kind: 'list', templateSection: 'ux' },
      { path: 'ux.attachments_support', label: 'Adjuntos', kind: 'text', templateSection: 'ux' },
      { path: 'ux.fallback_error_handling', label: 'Errores y fallback', kind: 'text', templateSection: 'ux' },
      { path: 'ux.human_handoff', label: 'Handoff a humano', kind: 'text', templateSection: 'ux' },
      { path: 'ux.history_session_memory', label: 'Historial/memoria', kind: 'text', templateSection: 'ux' }
    ]
  },
  {
    title: 'Arquitectura y Conocimiento',
    fields: [
      { path: 'architecture.logical_flow', label: 'Diagrama/flujo lógico', kind: 'text', templateSection: 'architecture' },
      { path: 'architecture.components', label: 'Componentes principales', kind: 'list', templateSection: 'architecture' },
      { path: 'architecture.external_dependencies', label: 'Dependencias externas', kind: 'list', templateSection: 'architecture' },
      { path: 'knowledge_prompts.sources', label: 'Fuentes de conocimiento', kind: 'list', templateSection: 'knowledge' },
      { path: 'knowledge_prompts.rag_summary', label: 'Recuperación/RAG', kind: 'text', templateSection: 'knowledge' },
      { path: 'knowledge_prompts.prompt_guardrails_location', label: 'Prompts/guardrails', kind: 'text', templateSection: 'knowledge' },
      { path: 'knowledge_prompts.forbidden_content_handling', label: 'Contenido no permitido', kind: 'text', templateSection: 'knowledge' }
    ]
  },
  {
    title: 'Seguridad y Privacidad',
    fields: [
      { path: 'security_privacy.processed_data', label: 'Datos tratados', kind: 'list', templateSection: 'security' },
      { path: 'security_privacy.retention_storage', label: 'Retención/almacenamiento', kind: 'text', templateSection: 'security' },
      { path: 'security_privacy.access_auth', label: 'Acceso/autenticación', kind: 'text', templateSection: 'security' },
      { path: 'security_privacy.anonymization_secrets', label: 'Anonimización/secretos', kind: 'text', templateSection: 'security' },
      { path: 'security_privacy.compliance_notes', label: 'Cumplimiento', kind: 'text', templateSection: 'security' }
    ]
  },
  {
    title: 'Desarrollo Local',
    fields: [
      { path: 'local_development.requirements', label: 'Requisitos', kind: 'list', templateSection: 'local_development' },
      { path: 'local_development.env_variables', label: 'Variables de entorno', kind: 'env', templateSection: 'local_development', hint: 'Una variable por línea: NOMBRE: descripción' },
      { path: 'local_development.resources', label: 'Recursos/datos', kind: 'list', templateSection: 'local_development' },
      { path: 'local_development.install_run_commands', label: 'Comandos de instalación/arranque', kind: 'list', templateSection: 'local_development' },
      { path: 'local_development.validation_checks', label: 'Validación rápida', kind: 'list', templateSection: 'local_development' },
      { path: 'local_development.testing_strategy', label: 'Pruebas', kind: 'text', templateSection: 'local_development' }
    ]
  },
  {
    title: 'Despliegue y Operación',
    fields: [
      { path: 'deployment.environments', label: 'Entornos', kind: 'list', templateSection: 'deployment' },
      { path: 'deployment.process', label: 'Proceso de despliegue', kind: 'text', templateSection: 'deployment' },
      { path: 'deployment.environment_differences', label: 'Diferencias por entorno', kind: 'text', templateSection: 'deployment' },
      { path: 'operations.logs', label: 'Logs', kind: 'text', templateSection: 'operations' },
      { path: 'operations.traces', label: 'Trazas', kind: 'text', templateSection: 'operations' },
      { path: 'operations.metrics', label: 'Métricas', kind: 'text', templateSection: 'operations' },
      { path: 'operations.alerts_runbooks', label: 'Alertas/runbooks', kind: 'text', templateSection: 'operations' },
      { path: 'operations.incident_process', label: 'Proceso de incidencias', kind: 'text', templateSection: 'operations' }
    ]
  },
  {
    title: 'Documentación y Ownership',
    fields: [
      { path: 'documentation_links.coordination_tools', label: 'Gestión y coordinación', kind: 'list', templateSection: 'documentation' },
      { path: 'documentation_links.repos_pipelines', label: 'Repositorios y CI/CD', kind: 'list', templateSection: 'documentation' },
      { path: 'documentation_links.environments_resources', label: 'Entornos y recursos', kind: 'list', templateSection: 'documentation' },
      { path: 'documentation_links.manuals_docs', label: 'Manuales/docs', kind: 'list', templateSection: 'documentation' },
      { path: 'roadmap', label: 'Roadmap/mejoras', kind: 'list', templateSection: 'roadmap' },
      { path: 'contacts.product_owner', label: 'Product owner', kind: 'text', templateSection: 'contacts' },
      { path: 'contacts.technical_owner', label: 'Responsable técnico', kind: 'text', templateSection: 'contacts' },
      { path: 'contacts.responsible_team', label: 'Equipo responsable', kind: 'text', templateSection: 'contacts' },
      { path: 'contacts.support_operations', label: 'Soporte/Operación', kind: 'text', templateSection: 'contacts' },
      { path: 'related_projects', label: 'Proyectos relacionados', kind: 'list', templateSection: 'related_projects' }
    ]
  }
];

export const ALL_FIELDS = FORM_SECTIONS.flatMap((section) => section.fields);

export function fieldKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_');
}
