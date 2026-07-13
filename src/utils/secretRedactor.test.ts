import { describe, expect, it } from 'vitest';
import { countRedactions, isEnvFile, redactSecrets } from './secretRedactor';

describe('isEnvFile', () => {
  it('reconoce archivos .env y variantes con sufijo', () => {
    expect(isEnvFile('.env')).toBe(true);
    expect(isEnvFile('.env.local')).toBe(true);
    expect(isEnvFile('.env.production')).toBe(true);
    expect(isEnvFile('config/.env')).toBe(true);
    expect(isEnvFile('backend.env')).toBe(true);
  });

  it('excluye los archivos de ejemplo/plantilla de .env', () => {
    expect(isEnvFile('.env.example')).toBe(false);
    expect(isEnvFile('.env.sample')).toBe(false);
    expect(isEnvFile('.env.template')).toBe(false);
    expect(isEnvFile('.env.dist')).toBe(false);
  });

  it('no confunde archivos normales que contienen "env" en el nombre', () => {
    expect(isEnvFile('environment.ts')).toBe(false);
    expect(isEnvFile('src/env.ts')).toBe(false);
  });
});

describe('redactSecrets en archivos .env (formato "asignación por línea")', () => {
  it('redacta el valor completo de cualquier asignación, tenga o no pinta de secreto', () => {
    const content = ['API_KEY=sk-abc123456789', 'PORT=3000', 'export DEBUG=true'].join('\n');
    const result = redactSecrets(content, '.env');
    expect(result).toBe(['API_KEY=[REDACTADO]', 'PORT=[REDACTADO]', 'export DEBUG=[REDACTADO]'].join('\n'));
  });

  it('no toca líneas que no son asignaciones (comentarios, vacías)', () => {
    const content = ['# comentario', '', 'FOO=bar'].join('\n');
    const result = redactSecrets(content, '.env');
    expect(result).toBe(['# comentario', '', 'FOO=[REDACTADO]'].join('\n'));
  });
});

describe('redactSecrets en archivos "clave-valor" normales (json/código/etc.)', () => {
  it('redacta el valor solo si el nombre de la clave parece sensible', () => {
    const content = ['apiKey: "sk-abc123456789"', 'port: 3000'].join('\n');
    const result = redactSecrets(content, 'config.yaml');
    expect(result).toContain('apiKey: [REDACTADO]');
    expect(result).toContain('port: 3000');
  });

  it('en un .env.example, una clave con nombre sensible SÍ se redacta igualmente', () => {
    // El filtro por nombre de archivo solo exime a .env.example del modo "toda línea es secreto",
    // pero el escaneo por nombre de clave sensible se aplica a cualquier archivo por igual.
    const result = redactSecrets('API_KEY=tu_clave_aqui', '.env.example');
    expect(result).toBe('API_KEY=[REDACTADO]');
  });

  it('en un .env.example, una clave NO sensible se deja intacta', () => {
    const result = redactSecrets('PORT=3000', '.env.example');
    expect(result).toBe('PORT=3000');
  });
});

describe('redactSecrets: escáner de tokens sueltos en texto libre', () => {
  it('detecta un JSON Web Token dentro de una frase', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYVwn3pGmB1E';
    const result = redactSecrets(`token de ejemplo: ${jwt}`, 'notas.md');
    expect(result).not.toContain(jwt);
    expect(result).toContain('[REDACTADO]');
  });

  it('detecta una clave de acceso de AWS', () => {
    const result = redactSecrets('key = AKIAIOSFODNN7EXAMPLE', 'notas.md');
    expect(result).toContain('[REDACTADO]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('oculta solo la contraseña en una URL de conexión con credenciales embebidas', () => {
    const result = redactSecrets('postgres://user:supersecreto@host:5432/db', 'readme_snippet.md');
    expect(result).toBe('postgres://user:[REDACTADO]@host:5432/db');
  });

  it('redacta pares AccountKey=/Password= típicos de connection strings', () => {
    const result = redactSecrets('Server=tcp:x;Password=abc123;AccountKey=xyz789;', 'notes.txt');
    expect(result).toContain('Password=[REDACTADO]');
    expect(result).toContain('AccountKey=[REDACTADO]');
  });

  it('no toca texto normal sin pinta de secreto', () => {
    const result = redactSecrets('Este es un texto normal sin secretos.', 'readme.md');
    expect(result).toBe('Este es un texto normal sin secretos.');
  });
});

describe('redactSecrets: finales de línea no-Unix', () => {
  it('redacta correctamente un .env con CRLF (Windows), no solo con LF', () => {
    const content = ['API_KEY=sk-abc123456789', 'DATA_SERVICE_MODE=LOCAL', 'PORT=3000'].join('\r\n');
    const result = redactSecrets(content, '.env');
    expect(result).toBe(['API_KEY=[REDACTADO]', 'DATA_SERVICE_MODE=[REDACTADO]', 'PORT=[REDACTADO]'].join('\n'));
  });

  it('no deja un `\\r` colgante que rompa la redacción y desemboque en el escáner de tokens', () => {
    // Antes del fix, esta línea con CRLF caía al escáner de tokens y perdía el nombre
    // de la clave: "EVA_AUTH_REQUEST_CLIENT_SECRET=a1b2c3d4e5f6g7h8i9j0\r" -> "[REDACTADO]\r"
    const content = 'EVA_AUTH_REQUEST_CLIENT_SECRET=a1b2c3d4e5f6g7h8i9j0\r\nEVA_AUTH_REQUEST_CLIENT_ID=iberia-qa\r\n';
    const result = redactSecrets(content, '.env');
    expect(result).toContain('EVA_AUTH_REQUEST_CLIENT_SECRET=[REDACTADO]');
    expect(result).toContain('EVA_AUTH_REQUEST_CLIENT_ID=[REDACTADO]');
    expect(result).not.toContain('\r');
  });

  it('redacta un .env con finales de línea clásicos de Mac (CR suelto, sin LF)', () => {
    const content = 'API_KEY=sk-abc123456789\rPORT=3000\r';
    const result = redactSecrets(content, '.env');
    expect(result).toBe('API_KEY=[REDACTADO]\nPORT=[REDACTADO]\n');
  });
});

describe('countRedactions', () => {
  it('cuenta cuántos marcadores [REDACTADO] hay en el contenido', () => {
    expect(countRedactions('a=[REDACTADO]\nb=[REDACTADO]\nc=1')).toBe(2);
    expect(countRedactions('sin redacciones aquí')).toBe(0);
  });
});
