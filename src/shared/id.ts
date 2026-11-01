/** Unique row ids. Not a secret, so `Math.random` is enough here. */
export function generateId(): string {
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  return `${Date.now().toString(36)}-${random}`;
}
