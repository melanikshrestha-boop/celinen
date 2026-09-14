import {Container} from '@cloudflare/containers';
import {DOMAIN, bridgeAuthorized, error, hex, uuid, validate} from './policy';

interface Env {
  NATIVE: DurableObjectNamespace<NativeV2>;
  LENSLABS_V2_BRIDGE_TOKEN: string;
  LENSLABS_CANONICAL_V2_ENABLED: string;
  LENSLABS_V2_OWNER_IDS: string;
  RELEASE_SHA: string;
}
type Saved = {user:string;shoot:string;job:string;status:string;expires:number;receipt?:unknown};
export class NativeV2 extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '60s';
  enableInternet = false;
  pingEndpoint = 'localhost/health';
  private active?: {job:string;user:string;shoot:string};
  private token = '';
  private cancelled = false;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.token = await ctx.storage.get<string>('native-token') ??
        Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      await ctx.storage.put('native-token',this.token);
      const interrupted = await ctx.storage.get<Saved>('active');
      if (interrupted) {
        await this.destroy();
        await ctx.storage.put('result:'+interrupted.job,{...interrupted,status:'interrupted'});
        await ctx.storage.delete('active');
      }
    });
  }
  async fetch(request: Request): Promise<Response> {
    if (!await bridgeAuthorized(request,this.env.LENSLABS_V2_BRIDGE_TOKEN)) return error('unauthorized',401);
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/kill') {
      this.cancelled = true;
      await this.ctx.storage.put('killed',true);
      await this.destroy(); return Response.json({disabled:true,decoder_domain:DOMAIN});
    }
    // Operator recovery only while the independent switch is OFF. This cannot
    // activate processing, and no public app route forwards this operation.
    if (request.method === 'POST' && path === '/reset-kill') {
      if (this.env.LENSLABS_CANONICAL_V2_ENABLED !== 'false') return error('disable_before_reset',409);
      this.cancelled = true;
      await this.destroy(); await this.ctx.storage.delete('killed');
      return Response.json({disabled:true,decoder_domain:DOMAIN});
    }
    const killed = await this.ctx.storage.get<boolean>('killed') ?? false;
    const enabled = this.env.LENSLABS_CANONICAL_V2_ENABLED === 'true' && !killed;
    this.envVars = {LENSLABS_NATIVE_TOKEN:this.token, LENSLABS_CANONICAL_V2_ENABLED:String(enabled)};
    if (request.method === 'GET' && (path === '/health' || path === '/ready')) {
      try {
        const upstream = await this.containerFetch('http://container'+path,{signal:AbortSignal.timeout(30000)});
        const native = await upstream.json();
        return Response.json({service:'lenslab-canonical-v2-private',release_sha:this.env.RELEASE_SHA,
          enabled,killed,decoder_domain:DOMAIN,customer_authority:false,native},{status:upstream.status,headers:{'Cache-Control':'no-store'}});
      } catch { return error('native_unavailable',503); }
    }
    const user = request.headers.get('X-User-Id') ?? '', shoot = request.headers.get('X-Shoot-Id') ?? '';
    const jobMatch = /^\/jobs\/([a-f0-9]{32})$/.exec(path);
    if (jobMatch && uuid(user) && uuid(shoot)) {
      const job = jobMatch[1], saved = await this.ctx.storage.get<Saved>('result:'+job) ??
        (this.active?.job === job ? await this.ctx.storage.get<Saved>('active') : undefined);
      if (!saved || saved.user !== user || saved.shoot !== shoot || saved.expires < Date.now()) return error('not_found',404);
      if (request.method === 'DELETE' && this.active?.job === job) {
        this.cancelled = true;
        await this.destroy();
        return Response.json({job_id:job,status:'cancelling',decoder_domain:DOMAIN,customer_authority:false},
          {status:202,headers:{'Cache-Control':'no-store'}});
      }
      if (request.method === 'GET') return Response.json(saved,{headers:{'Cache-Control':'no-store'}});
      return error('invalid_request',400);
    }
    if (path !== '/v2/decode' || request.method !== 'POST') return error('not_found',404);
    if (!enabled) return error('disabled',503);
    // This gate is independent of PostHog and the edge switch. No public rollout.
    if (!this.env.LENSLABS_V2_OWNER_IDS?.split(',').includes(user)) return error('not_enabled_for_user',403);
    const value = validate(request); if ('failure' in value) return value.failure;
    if (this.active) return error('busy',429,value.job);
    this.cancelled = false;
    this.active = {job:value.job,user:value.user,shoot:value.shoot};
    const started = Date.now();
    const record:Saved = {...this.active,status:'running',expires:started+86400000};
    let timedOut = false;
    let result:Response;
    try {
      const existing = await this.ctx.storage.get<Saved>('result:'+value.job);
      if (existing) return error('job_id_conflict',409,value.job);
      const rateKey = 'rate:'+value.user;
      let rate = await this.ctx.storage.get<{window:number;count:number}>(rateKey);
      if (!rate || started-rate.window >= 60000) rate = {window:started,count:0};
      if (rate.count >= 30) return error('rate_limited',429,value.job);
      await this.ctx.storage.put(rateKey,{...rate,count:rate.count+1});
      await this.ctx.storage.put('active',record);
      const abort = new AbortController();
      const stop = () => { abort.abort(); };
      request.signal.addEventListener('abort',stop,{once:true});
      const timer = setTimeout(() => { timedOut = true; stop(); },75000);
      try {
        const upstream = await this.containerFetch('http://container/v2/decode',{
          method:'POST',body:request.body,signal:abort.signal,headers:{
            'Content-Type':'application/octet-stream','Content-Length':String(value.length),
            'X-Native-Authorization':this.token,'X-Job-Id':value.job,'X-Source-Sha256':value.sha,
          },
        });
        const body = await upstream.text();
        if (this.cancelled) throw Error('cancelled');
        if (body.length > 1024*1024) throw Error('invalid_native_output');
        const receipt = JSON.parse(body);
        if (receipt.decoder_domain !== DOMAIN || receipt.customer_authority !== false ||
            (upstream.ok && (receipt.source !== value.sha || !hex(receipt.canonical,64) || receipt.architecture !== 'linux-amd64')))
          throw Error('invalid_native_output');
        const {image: _pixels,...durableReceipt} = receipt;
        await this.ctx.storage.put('result:'+value.job,{...record,status:upstream.ok?'complete':'failed',receipt:durableReceipt});
        result = new Response(body,{status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
          'X-Job-Id':value.job,'X-Processing-Ms':upstream.headers.get('X-Processing-Ms')??'',
          'X-Peak-Memory-KiB':upstream.headers.get('X-Peak-Memory-KiB')??''}});
      } finally {
        clearTimeout(timer); request.signal.removeEventListener('abort',stop);
        if (abort.signal.aborted) await this.destroy();
      }
    } catch {
      await this.destroy();
      const cancelled = request.signal.aborted || this.cancelled;
      await this.ctx.storage.put('result:'+value.job,{...record,status:cancelled?'cancelled':timedOut?'timeout':'failed'});
      result = error(cancelled?'cancelled':timedOut?'processing_timeout':'native_failed',cancelled?499:timedOut?504:502,value.job);
    } finally {
      await this.ctx.storage.delete('active'); this.active = undefined;
      // Separate V2 hash receipts only. No original bytes, V1 decisions or filenames.
      const records = await this.ctx.storage.list<Saved>({prefix:'result:',limit:100});
      for (const [key,saved] of records) if (saved.expires < Date.now()) await this.ctx.storage.delete(key);
    }
    console.log(JSON.stringify({event:'v2_job',job_id:value.job,decoder_domain:DOMAIN,status:result.status,processing_ms:Date.now()-started}));
    return result;
  }
  onError(_error:unknown):unknown {
    console.error(JSON.stringify({event:'v2_container_error',decoder_domain:DOMAIN}));
    throw Error('native_unavailable');
  }
  onStart() { console.log(JSON.stringify({event:'v2_container_started',decoder_domain:DOMAIN})); }
  onStop({exitCode}:{exitCode:number}) { console.log(JSON.stringify({event:'v2_container_stopped',exit_code:exitCode,decoder_domain:DOMAIN})); }
}
export default {
  async fetch(request:Request,env:Env) {
    if (!await bridgeAuthorized(request,env.LENSLABS_V2_BRIDGE_TOKEN)) return error('unauthorized',401);
    return env.NATIVE.get(env.NATIVE.idFromName('private-single-instance')).fetch(request);
  },
};
