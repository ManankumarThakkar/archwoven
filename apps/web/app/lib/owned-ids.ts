import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hosted job and diagram ids carry an HMAC of the visitor's signed session, so a request for an id
 * this session did not create is refused without a Redis command, and nobody else can claim an id
 * whose 24-hour server copy has expired. Ids stay UUID-shaped: 48 random bits and an 80-bit tag.
 */
const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const secretOf = () => process.env.ARCHWOVEN_SESSION_SECRET?.trim() ?? '';
const tag = (nonce: string, sessionId: string, secret: string) => createHmac('sha256', secret).update(`aw-id:${sessionId}:${nonce}`).digest('hex').slice(0, 20);

export function ownedId(sessionId: string, secret = secretOf()): string {
  const nonce = randomBytes(6).toString('hex');
  const hex = nonce + tag(nonce, sessionId, secret);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isOwnedId(id: string, sessionId: string, secret = secretOf()): boolean {
  if (!secret || !SHAPE.test(id)) return false;
  const hex = id.replaceAll('-', '');
  const expected = Buffer.from(tag(hex.slice(0, 12), sessionId, secret)), received = Buffer.from(hex.slice(12));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
