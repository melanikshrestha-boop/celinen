type BuildInfo = { git_sha: string; build_time: string; app_version: string };
declare const __LENSLAB_BUILD_INFO__: BuildInfo;

export function versionResponse(info: BuildInfo | undefined =
  typeof __LENSLAB_BUILD_INFO__ === "undefined" ? undefined : __LENSLAB_BUILD_INFO__) {
  if (!info || !/^[a-f0-9]{40}$/.test(info.git_sha) ||
      !/^\d+\.\d+\.\d+\.\d+$/.test(info.app_version) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(info.build_time) ||
      !Number.isFinite(Date.parse(info.build_time)))
    return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  return Response.json({ git_sha: info.git_sha, build_time: info.build_time, app_version: info.app_version },
    { headers: { "cache-control": "no-store" } });
}
