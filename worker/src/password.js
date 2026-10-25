// Cloudflare workerd currently caps a single PBKDF2 invocation at 100,000
// iterations. This hash is only suitable for the RD Care demo with long,
// unique passwords. Production authentication must be redesigned and
// security-reviewed before importing real student data.
export const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: encoder.encode(salt),
    iterations: PBKDF2_ITERATIONS,
    hash: 'SHA-256'
  }, key, 256);
  return hex(bits);
}
