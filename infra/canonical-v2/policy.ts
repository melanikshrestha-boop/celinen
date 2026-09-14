export const DOMAIN = 'sports-canonical-rgba256-v2';
export const MAX_BYTES = 64 * 1024 * 1024;
export const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export const hex = (s: string, length: number) => s.length === length && /^[0-9a-f]+$/.test(s);
/** Empty/whitespace OWNER_IDS means all authenticated owners; non-empty is emergency restrict. */
export function ownerAllowed(user: string, ownerIds?: string) {
  const raw = (ownerIds ?? '').trim();
  if (!raw) return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(user);
}
export function error(code: string, status: number, jobId?: string) {
  return Response.json({ status: 'error', code, decoder_domain: DOMAIN, customer_authority: false,
    ...(jobId ? {job_id: jobId} : {}) }, {status, headers: {'Cache-Control': 'no-store'}});
}
export async function bridgeAuthorized(request: Request, secret?: string) {
  if (!secret || !hex(secret, 64)) return false;
  const candidate = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!candidate) return false;
  const enc = new TextEncoder();
  const [a,b] = await Promise.all([secret,candidate].map(v => crypto.subtle.digest('SHA-256',enc.encode(v))));
  const x = new Uint8Array(a), y = new Uint8Array(b); let difference = 0;
  for (let i=0;i<x.length;i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export function validate(request: Request) {
  const user = request.headers.get('X-User-Id') ?? '', shoot = request.headers.get('X-Shoot-Id') ?? '';
  const job = request.headers.get('X-Job-Id') ?? '', sha = request.headers.get('X-Source-Sha256') ?? '';
  const length = request.headers.get('Content-Length') ?? '';
  if (!uuid(user) || !uuid(shoot) || !hex(job,32) || !hex(sha,64) || !/^[1-9][0-9]{0,8}$/.test(length) ||
      request.headers.get('Content-Type') !== 'application/octet-stream' || request.headers.has('Content-Encoding'))
    return {failure: error('invalid_request',400)} as const;
  if (Number(length) > MAX_BYTES) return {failure: error('file_too_large',413)} as const;
  return {user,shoot,job,sha,length:Number(length)} as const;
}
