type BuildInfo = { git_sha: string; build_time: string; app_version: string };
declare const __LENSLAB_BUILD_INFO__: BuildInfo;

const NO_STORE = { "cache-control": "no-store" };

function compiledBuildInfo(): BuildInfo | undefined {
  return typeof __LENSLAB_BUILD_INFO__ === "undefined" ? undefined : __LENSLAB_BUILD_INFO__;
}

function isBuildInfo(info: BuildInfo | undefined): info is BuildInfo {
  return Boolean(
    info &&
    /^[a-f0-9]{40}$/.test(info.git_sha) &&
    /^\d+\.\d+\.\d+\.\d+$/.test(info.app_version) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(info.build_time) &&
    Number.isFinite(Date.parse(info.build_time)),
  );
}

export function versionResponse(info: BuildInfo | undefined = compiledBuildInfo()) {
  if (!isBuildInfo(info)) return new Response(null, { status: 503, headers: NO_STORE });
  return Response.json(
    { git_sha: info.git_sha, build_time: info.build_time, app_version: info.app_version },
    { headers: NO_STORE },
  );
}

/** Liveness for monitors and the live smoke script; a build without provenance is not healthy. */
export function healthResponse(info: BuildInfo | undefined = compiledBuildInfo()) {
  if (!isBuildInfo(info)) return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  return Response.json(
    { ok: true, git_sha: info.git_sha, build_time: info.build_time },
    { headers: NO_STORE },
  );
}
