# [[ project_name | M | Nombre real del proyecto detectado en package.json, documentación, configuración o carpeta raíz. ]]

[[ screenshot_path | H | image | Pantallazo de la interfaz del proyecto, especialmente en el caso de chatbots ]]

---

## 1. Resumen

- **Qué es**: [[ summary.what_is | M | Resumen claro (2-4 frases) de qué hace el proyecto, cuáles son sus objetivos y qué problema resuelve.]]
- **Tipo**: [[ summary.project_type | M | Clasifica el proyecto en una o más categorías, según evidencia objetiva (entry point, manifest, dependencias, forma de despliegue). Indica aquellas que coincidan: "chatbot" (interfaz conversacional que responde mensajes turno a turno; NO planifica ni ejecuta acciones externas por sí mismo); "agente IA" (además de conversar, planifica y ejecuta acciones de forma autónoma llamando herramientas/funciones/APIs para completar tareas); "extensión/plugin" (se instala dentro de una aplicación anfitriona y depende de su runtime); "API/servicio backend" (expone endpoints REST/GraphQL/gRPC/webhooks consumidos por otros programas, sin interfaz de usuario propia); "aplicación frontend/web" (interfaz visual consumida directamente por personas en navegador u otro cliente gráfico); "librería/SDK" (paquete pensado para ser importado por otro código, no se ejecuta de forma independiente); "CLI" (herramienta invocada por línea de comandos); "servicio interno/batch" (proceso automatizado sin interacción directa de usuario final, p. ej. cron, workers, pipelines de datos); u "otro: <breve descripción>" solo si ninguna categoría anterior encaja. Si el proyecto combina varias capas, explícalo y menciona todas, recalcando cuál es con la que interactúa el usuario final]]
- **Usuarios**: [[ summary.target_users | M | csv | Perfiles que usarán la solución. ]]
- **Estado**: [[ summary.status | H | Estado del proyecto si hay evidencia: prototipo, desarrollo, producción, mantenimiento, archivado u otro. ]]
- **Objetivo y éxito**: [[ summary.success_criteria | M | Criterio de éxito u objetivo medible del proyecto, solo si hay evidencia. ]]

---

## 2. Alcance y limitaciones

- **Qué incluye**: [[ scope.includes | M | list | Capacidades, módulos, responsabilidades o funcionalidades cubiertas por el proyecto. ]]
- **Qué no incluye**: [[ scope.excludes | H | list | Exclusiones explícitas, responsabilidades fuera de alcance o límites funcionales. ]]
- **Limitaciones conocidas**: [[ scope.known_limitations | H | list | Restricciones técnicas, funcionales, dependencias o limitaciones conocidas que afecten al uso. ]]

---

## 3. Usuarios y uso previsto

- **Usuarios objetivo**: [[ summary.target_users | M | csv | Perfiles que usarán la solución. ]]
- **Canales**: [[ usage.channels | M | csv | Interfaces o canales por los que se accede al proyecto (ej. web, Teams/Slack, API HTTP, extensión de IDE, CLI, backend interno). Incluye solo los que tengan evidencia clara en código o configuración. ]]
- **Idiomas**: [[ usage.languages | M | csv | Idiomas soportados. Incluye solo los que aparezcan en código, configuración o documentación. ]]
- **Contexto de uso**: [[ usage.contexts | H | list | Escenarios reales en los que se espera usar la solución. ]]

---

<!--section:ux-->
## 4. Experiencia de usuario

- **Cómo se inicia**: [[ ux.start_flow | M | Cómo empieza la interacción desde la perspectiva de quien lo usa o del sistema que lo invoca: primer comando, petición HTTP, apertura de la extensión, primer mensaje de chat, importación de la librería, etc., según el tipo de interfaz. ]]
- **Qué preguntas se esperan**: [[ ux.expected_questions | M | list | Ejemplos de preguntas, comandos, peticiones o casos de uso típicos que la solución debe resolver. Aplica a interfaces conversacionales, APIs, CLIs u otras interfaces con casos de uso concretos; si no hay evidencia clara, deja vacío. ]]
- **Adjuntos** (si aplica): [[ ux.attachments_support | M | Si acepta archivos, imágenes u otros adjuntos, y cómo los usa. Aplica solo si el proyecto tiene una interfaz conversacional o de agente; si no, deja vacío. ]]
- **Errores y fallback**: [[ ux.fallback_error_handling | M | Cómo responde ante errores, excepciones, entradas inválidas o casos no cubiertos. Deja vacío si no hay evidencia documentada o implementada. ]]
- **Handoff a humano**: [[ ux.human_handoff | M | Si existe escalado a una persona, equipo, canal de soporte o proceso manual. Aplica solo si el proyecto tiene una interfaz conversacional o de agente; si no, deja vacío. ]]
- **Historial/memoria**: [[ ux.history_session_memory | M | Si mantiene contexto, memoria, historial de sesión o conversaciones previas. Aplica solo si el proyecto tiene una interfaz conversacional o de agente; si no, deja vacío. ]]

---
<!--/section-->

## 5. Arquitectura

- **Diagrama lógico**: [[ architecture.logical_flow | M | raw | Genera un diagrama visual atractivo y compacto en formato Mermaid que muestre el flujo lógico del proyecto documentado: usuario/sistema que lo invoca, interfaz de entrada, componentes internos reales y servicios externos. Salida requerida: 1) Un bloque fenced de Mermaid (tres backticks, la palabra "mermaid", el diagrama y cierre con tres backticks) con un flowchart o gráfico de arquitectura (usa subgraph/flowchart, flechas claras, nombres legibles y anotaciones breves). 2) Una línea breve (1-2 frases) como leyenda que explique el objetivo del diagrama. 3) Si no es posible generar Mermaid, una alternativa textual compacta (máx. 3 líneas). Prioriza claridad visual: agrupa los componentes REALES detectados en este repositorio (usa los nombres que encuentres en el código/documentación, no una lista de ejemplo) y marca la dirección principal de datos (entrada -> procesamiento -> salida/respuesta). No añadas largos párrafos ni listas; solo el bloque Mermaid seguido de la leyenda. ]]
- **Componentes principales**: [[ architecture.components | M | list | Componentes clave del sistema y responsabilidad principal de cada uno. ]]
- **Dependencias externas**: [[ architecture.external_dependencies | M | list | Servicios, APIs, bases de datos, modelos, colas, buscadores o integraciones externas. ]]

---

<!--section:knowledge_prompts-->
## 6. Conocimiento y prompts

<!-- Aplica solo si el proyecto usa modelos de lenguaje, prompts, RAG o embeddings; si no hay evidencia de ello, deja los campos vacíos y la sección se omite. -->

- **Fuentes**: [[ knowledge_prompts.sources | M | list | Fuentes de conocimiento que usa el modelo: documentos, índices, APIs, bases de datos, ficheros o repositorios. ]]
- **Recuperación (RAG)**: [[ knowledge_prompts.rag_summary | M | Uso de RAG, embeddings, búsqueda semántica o recuperación documental. ]]
- **Prompts/guardrails**: [[ knowledge_prompts.prompt_guardrails_location | M | Dónde están los prompts, instrucciones de agente, políticas o guardrails en el repositorio. ]]
- **Contenido no permitido**: [[ knowledge_prompts.forbidden_content_handling | M | Cómo se gestionan restricciones, moderación o respuestas no permitidas. ]]

---
<!--/section-->

## 7. Seguridad, privacidad y cumplimiento

- **Datos tratados**: [[ security_privacy.processed_data | M | list | Tipos de datos procesados, especialmente datos personales, sensibles o corporativos. ]]
- **Retención/almacenamiento**: [[ security_privacy.retention_storage | M | Si los datos se almacenan, dónde y durante cuánto tiempo, solo con evidencia. ]]
- **Acceso**: [[ security_privacy.access_auth | M | Autenticación, autorización, roles o controles de acceso detectados. ]]
- **Redacción/anonimización** y **gestión de secretos** : [[ security_privacy.anonymization_secrets | M | Masking, anonimización, gestión de secretos o protección de credenciales. ]]
- **Cumplimiento**: [[ security_privacy.compliance_notes | M | Notas de cumplimiento, privacidad o normativa mencionadas en el proyecto. ]]

---

## 8. Desarrollo local

- **Requisitos**: [[ local_development.requirements | M | list | Runtimes, versiones, dependencias, herramientas y servicios necesarios para desarrollo local. ]]
- **Variables de entorno**: [[ local_development.env_variables | M | env | Variables de entorno detectadas en .env.example, config o código, y finalidad de cada una si es evidente. ]]
- **Recursos/datos**: [[ local_development.resources | M | list | Datos, ficheros, índices, recursos cloud o dependencias externas necesarias. ]]
- **Ejecutar**: [[ local_development.install_run_commands | M | code | Comandos de instalación, arranque y uso local encontrados en scripts o documentación. ]]
- **Validación rápida**: [[ local_development.validation_checks | M | list | Comandos o pasos breves para comprobar que el proyecto funciona. ]]
- **Pruebas**: [[ local_development.testing_strategy | M | Estrategia, framework o comandos de pruebas documentados. ]]

---

## 9. Despliegue

- **Entornos**: [[ deployment.environments | M | list | Entornos detectados: local, desarrollo, preproducción, producción, cloud u otros. ]]
- **Proceso**: [[ deployment.process | M | Cómo se despliega según pipelines, Docker, IaC, scripts o documentación. ]]
- **Diferencias por entorno**: [[ deployment.environment_differences | M | Diferencias de configuración, recursos o comportamiento entre entornos. ]]

---

<!--section:operations-->
## 10. Operación y observabilidad

- **Logs**: [[ operations.logs | M | Dónde consultar logs o cómo se generan, si hay evidencia. ]]
- **Trazas**: [[ operations.traces | M | Dónde consultar trazas o cómo se instrumentan, si hay evidencia. ]]
- **Métricas**: [[ operations.metrics | M | Métricas disponibles o herramientas de monitorización detectadas. ]]
- **Señales clave**: [[ operations.key_signals | M | list | Métricas clave a vigilar según el tipo de proyecto (ej. error rate y latencia para APIs; tokens/coste y ratio de fallback para sistemas basados en LLM; ratio de escalado a humano para agentes; throughput para pipelines batch). Incluye solo las relevantes para este proyecto y con evidencia; si no hay evidencia de ninguna, deja vacío. ]]
- **Alertas/runbooks** (si aplica): [[ operations.alerts_runbooks | M | Alertas, runbooks o procedimientos operativos detectados. ]]
- **Incidencias**: [[ operations.incident_process | M | Cómo se gestionan incidencias o soporte operativo si está documentado. ]]

---
<!--/section-->

<!--section:documentation-->
## 11. Documentación y enlaces

- **Gestión y coordinación**: [[ documentation_links.coordination_tools | M | list | Herramientas de gestión, tickets, coordinación o seguimiento mencionadas. ]]
- **Repositorios y CI/CD**: [[ documentation_links.repos_pipelines | M | list | Repositorios, pipelines, workflows o recursos de CI/CD mencionados. ]]
- **Entornos y recursos**: [[ documentation_links.environments_resources | M | list | Referencias a entornos, recursos cloud, dashboards o servicios. ]]
- **Documentación**: [[ documentation_links.manuals_docs | M | list | Manuales, documentación técnica, guías o archivos relevantes del repositorio. ]]

---
<!--/section-->

<!--section:roadmap-->
## 12. Roadmap / mejoras

[[ roadmap | M | list | Mejoras futuras, TODOs o elementos de roadmap mencionados explícitamente. ]]

---
<!--/section-->

<!--section:contacts-->
## 13. Contactos y ownership

- **Product owner**: [[ contacts.product_owner | M | Product owner. Rellena solo si aparece explícitamente. ]]
- **Responsable técnico**: [[ contacts.technical_owner | M | Responsable técnico. Rellena solo si hay evidencia clara. ]]
- **Equipo responsable**: [[ contacts.responsible_team | M | Equipo propietario o responsable si aparece en documentación o metadatos. ]]
- **Soporte/Operación (si aplica)**: [[ contacts.support_operations | M | Canal o equipo de soporte/operación solo si está documentado. ]]

---
<!--/section-->

<!--section:related_projects-->
## 14. Proyectos relacionados

[[ related_projects | M | list | Proyectos relacionados mencionados explícitamente en el repositorio. ]]
<!--/section-->
