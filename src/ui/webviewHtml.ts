// Helpers compartidos por los paneles webview. `getNonce` genera el nonce que exige
// la Content-Security-Policy para permitir el <script> inline de cada panel.

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function getNonce(): string {
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  }
  return nonce;
}
