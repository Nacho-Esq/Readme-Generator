export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

const PRE_SELECTION_ERROR_RULES: Array<{ test: RegExp; message: (deployment: string) => string }> = [
  {
    test: /context[_ ]length|maximum context|max(?:imum)?\s+(?:number of\s+)?tokens|too many tokens|reduce the length|string too long|input is too long/i,
    message: (d) =>
      `El repositorio es demasiado grande para la ventana de contexto del modelo de pre-selección «${d}». ` +
      `Configura "readmeGeneratorAi.preSelectionDeployment" con un modelo de mayor ventana de contexto y vuelve a intentarlo.`
  },
  {
    test: /\b401\b|unauthor|invalid (?:api )?key|incorrect api key|access denied|invalid subscription key/i,
    message: (d) =>
      `Azure ha rechazado la autenticación al llamar al modelo de pre-selección «${d}». ` +
      `Revisa "readmeGeneratorAi.apiKey" y que "readmeGeneratorAi.endpoint" corresponda a ese recurso de Azure OpenAI.`
  },
  {
    test: /\b404\b|resource not found|deployment(?:notfound| does not exist| for this resource does not exist)|model not found/i,
    message: (d) =>
      `Azure no encuentra el deployment de pre-selección «${d}». ` +
      `Comprueba que el nombre en "readmeGeneratorAi.preSelectionDeployment" coincide exactamente con un deployment existente y que "readmeGeneratorAi.endpoint" apunta al recurso correcto.`
  },
  {
    test: /\b429\b|rate limit|call rate|too many requests/i,
    message: (d) =>
      `Azure ha limitado las peticiones (límite de tasa) al modelo de pre-selección «${d}». ` +
      `Espera unos segundos y vuelve a intentarlo, o revisa la cuota asignada al deployment.`
  },
  {
    test: /content[_ ]?filter|content management policy|responsible ?ai|jailbreak/i,
    message: (d) =>
      `El filtro de contenido de Azure ha bloqueado la petición al modelo de pre-selección «${d}». ` +
      `Revisa si algún archivo del repositorio dispara las políticas de contenido del recurso.`
  },
  {
    test: /fetch failed|failed to fetch|enotfound|econnrefused|getaddrinfo|etimedout|socket hang|network|timeout/i,
    message: (d) =>
      `No se ha podido contactar con el endpoint de Azure para el modelo de pre-selección «${d}». ` +
      `Comprueba "readmeGeneratorAi.endpoint" y tu conexión de red.`
  }
];

/**
 * Devuelve un mensaje de error específico según lo que reporte Azure al llamar al modelo de
 * pre-selección (nano). Si el mensaje de Azure no se reconoce, cae a un mensaje genérico.
 */
export function describePreSelectionError(error: unknown, deployment: string): string {
  const detail = asErrorMessage(error);
  const rule = PRE_SELECTION_ERROR_RULES.find((r) => r.test.test(detail));
  if (rule) {
    return `${rule.message(deployment)} Detalle: ${detail}`;
  }
  return (
    `El modelo de pre-selección «${deployment}» no ha podido ordenar los archivos del repositorio. ` +
    `Revisa la configuración de la extensión (preSelectionDeployment, apiKey y endpoint). ` +
    `Detalle: ${detail}`
  );
}
