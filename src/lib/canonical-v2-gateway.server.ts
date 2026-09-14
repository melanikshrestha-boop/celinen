// Independent experimental route. Never writes photos, V1 decisions or sidecars.
import {createClient} from '@supabase/supabase-js';
const DOMAIN = 'sports-canonical-rgba256-v2';
const uuid = (s:string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
type Binding = {fetch(request:Request):Promise<Response>};
export type V2GatewayEnv = {
  SUPABASE_URL?:string; SUPABASE_PUBLISHABLE_KEY?:string;
  LENSLABS_CANONICAL_V2_ENABLED?:string; LENSLABS_V2_OWNER_IDS?:string;
  LENSLABS_V2_BRIDGE_TOKEN?:string; CANONICAL_V2?:Binding;
};
const error = (code:string,status:number) => Response.json({status:'error',code,decoder_domain:DOMAIN,customer_authority:false},
  {status,headers:{'Cache-Control':'no-store'}});
export type V2Auth = (token:string,env:V2GatewayEnv,shoot:string|null)=>Promise<{user:string;owns:boolean}|null>;
const verify:V2Auth = async(token,env,shoot)=>{
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const client = createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token},
      fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})},
  });
  // Server validation (not client/JWT contents) supplies the identity.
  const {data,error:failure} = await client.auth.getUser(token);
  const user = data?.user?.id;
  if (failure || typeof user !== 'string' || !uuid(user)) return null;
  if (!shoot) return {user,owns:false};
  const result = await client.from('shoots').select('id,user_id').eq('id',shoot).eq('user_id',user).maybeSingle();
  if (result.error) throw Error('ownership_check_failed');
  return {user,owns:result.data?.id===shoot && result.data?.user_id===user};
};
export async function handleV2Gateway(request:Request,env:V2GatewayEnv,auth:V2Auth=verify):Promise<Response> {
  const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')??'')?.[1];
  if (!token || token.split('.').length!==3) return error('unauthorized',401);
  const query = new URL(request.url).searchParams;
  const job = query.get('job');
  const health = request.method==='GET' && !job;
  const shoot = request.headers.get('X-Shoot-Id') ?? '';
  if (!health && !uuid(shoot)) return error('invalid_shoot',400);
  if (job && !/^[a-f0-9]{32}$/.test(job)) return error('invalid_job',400);
  let identity;
  try { identity = await auth(token,env,health?null:shoot); }
  catch { return error('authorization_unavailable',503); }
  if (!identity) return error('unauthorized',401);
  if (!health && !identity.owns) return error('shoot_not_found',404);
  if (!env.LENSLABS_V2_OWNER_IDS?.split(',').includes(identity.user)) return error('not_enabled_for_user',403);
  // Cancellation and receipt access remain available after emergency shutdown.
  if (request.method==='POST' && env.LENSLABS_CANONICAL_V2_ENABLED!=='true') return error('disabled',503);
  if (!env.CANONICAL_V2 || !/^[a-f0-9]{64}$/.test(env.LENSLABS_V2_BRIDGE_TOKEN??'')) return error('native_not_configured',503);
  const headers = new Headers({Authorization:'Bearer '+env.LENSLABS_V2_BRIDGE_TOKEN,'X-User-Id':identity.user,'X-Shoot-Id':shoot});
  let path = health?'/health':job?'/jobs/'+job:'/v2/decode';
  if (request.method==='POST') {
    if (job) return error('invalid_request',400);
    const size = request.headers.get('Content-Length')??'',sha=request.headers.get('X-Source-Sha256')??'';
    if (!/^[1-9][0-9]{0,8}$/.test(size) || !/^[a-f0-9]{64}$/.test(sha) ||
      request.headers.get('Content-Type')!=='application/octet-stream' || request.headers.has('Content-Encoding')) return error('invalid_request',400);
    if (Number(size)>64*1024*1024) return error('file_too_large',413);
    headers.set('Content-Type','application/octet-stream');headers.set('Content-Length',size);
    headers.set('X-Source-Sha256',sha); headers.set('X-Job-Id',crypto.randomUUID().replaceAll('-',''));
  } else if (!(request.method==='GET'||request.method==='DELETE'&&job)) return error('invalid_request',400);
  try {
    // Only allowlisted headers cross the binding. No filenames, paths, credentials
    // supplied by the caller, original authorization token, or arbitrary URL.
    const upstream = await env.CANONICAL_V2.fetch(new Request('https://private'+path,{
      method:request.method,headers,...(request.method==='POST'?{body:request.body,duplex:'half'}:{}),signal:request.signal,
    } as RequestInit));
    const responseHeaders = new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
    for (const name of ['X-Job-Id','X-Processing-Ms','X-Peak-Memory-KiB']) {
      const value = upstream.headers.get(name); if (value) responseHeaders.set(name,value);
    }
    return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
  } catch { return error(request.signal.aborted?'cancelled':'native_unavailable',request.signal.aborted?499:503); }
}
