import { describe, expect, it } from 'vitest';
import { asErrorMessage, describePreSelectionError } from './errors';

describe('asErrorMessage', () => {
  it('extrae el mensaje de un Error real', () => {
    expect(asErrorMessage(new Error('algo falló'))).toBe('algo falló');
  });

  it('devuelve el string tal cual si el error ya es un string', () => {
    expect(asErrorMessage('boom')).toBe('boom');
  });

  it('convierte un objeto plano a JSON', () => {
    expect(asErrorMessage({ code: 401 })).toBe('{"code":401}');
  });

  it('no revienta con un valor no serializable, devuelve un mensaje genérico', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(asErrorMessage(circular)).toBe('Unknown error');
  });
});

describe('describePreSelectionError: clasifica los errores típicos de Azure', () => {
  it('reconoce error de contexto/tokens superado', () => {
    const msg = describePreSelectionError(new Error('maximum context length exceeded'), 'nano-deploy');
    expect(msg).toContain('demasiado grande para la ventana de contexto');
    expect(msg).toContain('nano-deploy');
  });

  it('reconoce un error de autenticación (401 / invalid api key)', () => {
    const msg = describePreSelectionError(new Error('401 Unauthorized: Incorrect API key provided'), 'nano-deploy');
    expect(msg).toContain('rechazado la autenticación');
    expect(msg).toContain('readmeGeneratorAi.apiKey');
  });

  it('reconoce un deployment no encontrado (404)', () => {
    const msg = describePreSelectionError(new Error('DeploymentNotFound: the model deployment for this resource does not exist'), 'nano-deploy');
    expect(msg).toContain('no encuentra el deployment');
  });

  it('reconoce un límite de tasa (429)', () => {
    const msg = describePreSelectionError(new Error('429 Too Many Requests: rate limit exceeded'), 'nano-deploy');
    expect(msg).toContain('límite de tasa');
  });

  it('reconoce un bloqueo del filtro de contenido', () => {
    const msg = describePreSelectionError(new Error('The response was filtered due to the content management policy'), 'nano-deploy');
    expect(msg).toContain('filtro de contenido');
  });

  it('reconoce un fallo de red/conectividad', () => {
    const msg = describePreSelectionError(new Error('fetch failed: ENOTFOUND my-resource.openai.azure.com'), 'nano-deploy');
    expect(msg).toContain('No se ha podido contactar');
  });

  it('cae a un mensaje genérico si no reconoce el error, pero conserva el detalle original', () => {
    const msg = describePreSelectionError(new Error('algo totalmente inesperado'), 'nano-deploy');
    expect(msg).toContain("El modelo de pre-selección «nano-deploy» no ha podido ordenar");
    expect(msg).toContain('algo totalmente inesperado');
  });
});
