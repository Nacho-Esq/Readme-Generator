const ENV_FILE_PATTERN = /(?:^|[\\/])(?:\.env(?:\.[^.\\/]+)?|[^.\\/]+\.env)$/i;
const ENV_EXAMPLE_PATTERN = /(?:^|[\\/])\.env\.(?:example|sample|template|dist)$/i;
export const REDACTADO = '[REDACTADO]';

// Ficheros cuyo formato es "una asignación por línea": en ellos cualquier valor
// es potencialmente un secreto, así que se redacta el valor completo sin mirar la clave.
const ENV_STYLE_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.properties', '.ini', '.cfg', '.conf', '.env', '.toml']);

// Asignación estilo entorno/shell: opcional `export`, indentación, comillas, `=` o `:`.
const ASSIGNMENT_LINE = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*[:=]\s*)(.+)$/;

// Par clave-valor estructurado (JSON/YAML/TOML/código): captura la clave para decidir si es sensible.
const KEY_VALUE_LINE = /^(\s*["']?)([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(.+)$/;

// Nombres de clave que delatan un secreto.
const SECRET_KEY_PATTERN = /(?:secret|token|password|passwd|pwd|credential|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth|bearer|sas|dsn|conn(?:ection)?[_-]?string|account[_-]?key|signing|cert|salt|seed|mnemonic|passphrase|\bkey\b)/i;

interface SecretPattern {
  regex: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

// Pasada 3 — escáner de tokens: enmascara subcadenas que "parecen" un secreto sin importar el contexto.
const TOKEN_PATTERNS: SecretPattern[] = [
  // JSON Web Tokens (header.payload.signature)
  { regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => REDACTADO },
  // Claves de acceso AWS
  { regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => REDACTADO },
  // GitHub / OpenAI / Slack y similares con prefijo reconocible
  { regex: /\b(?:gh[pousr]|github_pat|sk|pk|xox[baprs]|AIza)[-_][A-Za-z0-9_-]{10,}/g, replace: () => REDACTADO },
  // Credenciales embebidas en URL: esquema://usuario:contraseña@host  → se oculta solo la contraseña
  { regex: /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s:@/]+)(@)/gi, replace: (_m, p1, _p2, p3) => `${p1}${REDACTADO}${p3}` },
  // Pares clave-valor dentro de connection strings: AccountKey=...;  Pwd=...;
  { regex: /\b(AccountKey|SharedAccessKey|SharedAccessSignature|Password|Pwd|Key|Secret|Token)(\s*=\s*)([^;\s"']+)/gi, replace: (_m, p1, p2) => `${p1}${p2}${REDACTADO}` },
  // Cadena larga de alta entropía (base64/hex con mezcla de letras y dígitos) — la red de seguridad final.
  { regex: /\b(?=[A-Za-z0-9+/_=-]*[A-Za-z])(?=[A-Za-z0-9+/_=-]*[0-9])[A-Za-z0-9+/_=-]{24,}={0,2}\b/g, replace: () => REDACTADO }
];

export function isEnvFile(relativePath: string): boolean {
  return ENV_FILE_PATTERN.test(relativePath) && !ENV_EXAMPLE_PATTERN.test(relativePath);
}

/**
 * Redacta de forma agresiva los valores que parezcan secretos en el contenido de un archivo.
 * Combina detección por tipo de archivo, por nombre de clave y un escáner de tokens libre.
 * Trabaja sobre una copia en RAM; nunca toca el archivo en disco.
 */
export function redactSecrets(content: string, relativePath: string): string {
  const envStyle = isEnvFile(relativePath) || ENV_STYLE_EXTENSIONS.has(extname(relativePath));
  // Se normalizan CRLF/CR sueltos antes de partir en líneas: un `\r` colgante rompe el
  // ancla `$` de ASSIGNMENT_LINE y hace que la línea caiga silenciosamente al escáner
  // de tokens (mucho más débil), dejando sin redactar valores que deberían serlo siempre.
  return content
    .split(/\r\n|\r|\n/)
    .map((line) => redactLine(line, envStyle))
    .join('\n');
}

export function countRedactions(content: string): number {
  const matches = content.match(/\[REDACTADO\]/g);
  return matches ? matches.length : 0;
}

function redactLine(line: string, envStyle: boolean): string {
  if (envStyle) {
    const assignment = ASSIGNMENT_LINE.exec(line);
    if (assignment && assignment[2].trim().length > 0) {
      return assignment[1] + REDACTADO;
    }
  } else {
    const kv = KEY_VALUE_LINE.exec(line);
    if (kv && SECRET_KEY_PATTERN.test(kv[2]) && kv[4].trim().length > 0) {
      return kv[1] + kv[2] + kv[3] + REDACTADO;
    }
  }
  return redactTokens(line);
}

function redactTokens(line: string): string {
  let result = line;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replace as (substring: string, ...args: unknown[]) => string);
  }
  return result;
}

function extname(relativePath: string): string {
  const base = relativePath.toLowerCase().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}
