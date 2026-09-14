import {createFileRoute} from '@tanstack/react-router';
import {handleV2Gateway,type V2GatewayEnv} from '@/lib/canonical-v2-gateway.server';
async function handle({request}:{request:Request}) {
  const runtime = (request as Request & {runtime?:{cloudflare?:{env:V2GatewayEnv}}}).runtime?.cloudflare?.env;
  let env = runtime;
  if (!env) {
    try { env = (await import('cloudflare:workers')).env as V2GatewayEnv; }
    catch { env = process.env as V2GatewayEnv; } // Local app has no native binding.
  }
  return handleV2Gateway(request,env);
}
export const Route = createFileRoute('/api/native/v2')({server:{handlers:{GET:handle,POST:handle,DELETE:handle}}});
