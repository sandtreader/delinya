// Entity IDs. Short, URL-safe, unique enough for a shared drawing.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(prefix = "e"): string {
  let s = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}
