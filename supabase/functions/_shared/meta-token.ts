function tokenSecret() {
  return String(Deno.env.get('META_TOKEN_SECRET') || Deno.env.get('AUTOMATION_SECRET') || Deno.env.get('JWT_SECRET') || '');
}

async function cryptoKey() {
  const secret = tokenSecret();
  if (secret.length < 16) throw new Error('META_TOKEN_SECRET não configurado.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encryptMetaToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cryptoKey();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(token),
  ));
  return `${toBase64(iv)}.${toBase64(encrypted)}`;
}

export async function decryptMetaToken(value: string) {
  const [ivRaw, encryptedRaw] = String(value || '').split('.');
  if (!ivRaw || !encryptedRaw) throw new Error('Token Meta inválido.');
  const key = await cryptoKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivRaw) }, key, fromBase64(encryptedRaw),
  );
  return new TextDecoder().decode(decrypted);
}
