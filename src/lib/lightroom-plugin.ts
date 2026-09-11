/**
 * LensLabs Lightroom Classic plugin (Lua source, generated in the browser).
 *
 * The plugin does two real things:
 *  1. Push: reads rating, colour label, pick flag, IPTC and develop settings for the
 *     selected photos, writes XMP to disk (photo:saveMetadata) and POSTs the same
 *     payload to the LensLabs bridge so the studio updates without a re-import.
 *  2. Pull: fetches LensLabs verdicts/ratings/labels/captions back and writes them into
 *     the catalog, then writes XMP again so the two sides agree.
 */
import { makeZip } from "@/lib/zip";
import { LIGHTROOM_JSON_LUA as JSON_LUA } from "./lightroom-json";
import { APPLICATION_ORIGIN } from "./application-origin";

export const BRIDGE_PATH = "/api/public/lightroom";

/** The live LensLabs bridge. Lightroom runs outside the browser, so the plugin can
 *  never use a preview/localhost origin — it always talks to the published domain. */
export const LIVE_ORIGIN = APPLICATION_ORIGIN;

/** Endpoint baked into the downloaded plugin. */
export function bridgeEndpoint() {
  return `${LIVE_ORIGIN}${BRIDGE_PATH}`;
}

const INFO_LUA = (endpoint: string) => `--[[ LensLabs — Lightroom Classic plugin ]]
return {
  LrSdkVersion = 13.0,
  LrSdkMinimumVersion = 10.0,
  LrToolkitIdentifier = 'photo.lens.os.bridge',
  LrPluginName = 'LensLabs',
  LrPluginInfoUrl = '${endpoint}',
  LrLibraryMenuItems = {
    { title = 'Push selection to LensLabs', file = 'LensLabsPush.lua' },
    { title = 'Pull LensLabs verdicts into catalog', file = 'LensLabsPull.lua' },
    { title = 'Start live sync (every 5s)', file = 'LensLabsWatch.lua' },
    { title = 'Stop live sync', file = 'LensLabsStop.lua' },
  },
  LrMetadataProvider = 'LensLabsMetadata.lua',
  VERSION = { major = 1, minor = 3, revision = 1 },
}
`;

const CONFIG_LUA = (
  endpoint: string,
  workspace: string,
  token: string,
) => `-- LensLabs bridge settings.
-- endpoint  : the live LensLabs sync URL (only change this if you self-host).
-- workspace : the studio this catalog syncs into (see Adobe tab in LensLabs).
-- token     : private key for this studio. Keep this file to yourself.
return {
  endpoint = '${endpoint}',
  workspace = '${workspace}',
  token = '${token}',
}
`;

const METADATA_LUA = `return {
  metadataFieldsForPhotos = {
    { id = 'lensosScore', title = 'LensLabs score', dataType = 'string', searchable = true, browsable = true },
    { id = 'lensosVerdict', title = 'LensLabs verdict', dataType = 'string', searchable = true, browsable = true },
    { id = 'lensosPackage', title = 'LensLabs package', dataType = 'string', searchable = true, browsable = true },
  },
  schemaVersion = 3,
}
`;

const COMMON_LUA = `local LrHttp = import 'LrHttp'
local LrPathUtils = import 'LrPathUtils'
local LrFileUtils = import 'LrFileUtils'
local JSON = require 'JSON'
local config = require 'LensLabsConfig'

local M = {}

function M.startWatch()
  if M.liveRun then return nil end
  local run = { active = true }
  M.liveRun = run
  return run
end

function M.stopWatch(run)
  if M.liveRun and (run == nil or run == M.liveRun) then
    M.liveRun.active = false
    M.liveRun = nil
  end
end

function M.endpoint()
  return config.endpoint
end

function M.workspace()
  return config.workspace or ''
end

local function withQuery(url, query)
  local sep = string.find(url, '?') and '&' or '?'
  return url .. sep .. query
end

-- Collect everything LensLabs cares about for one photo.
function M.readPhoto(photo)
  local dev = photo:getDevelopSettings() or {}
  return {
    file = photo:getFormattedMetadata('fileName'),
    path = photo:getRawMetadata('path'),
    uuid = photo:getRawMetadata('uuid'),
    rating = photo:getRawMetadata('rating') or 0,
    label = photo:getRawMetadata('colorNameForLabel'),
    pick = photo:getRawMetadata('pickStatus') or 0,
    iptc = {
      caption = photo:getFormattedMetadata('caption'),
      headline = photo:getFormattedMetadata('headline'),
      keywords = photo:getFormattedMetadata('keywordTags'),
      creator = photo:getFormattedMetadata('creator'),
      copyright = photo:getFormattedMetadata('copyright'),
    },
    develop = {
      exposure = dev.Exposure2012 or 0,
      contrast = dev.Contrast2012 or 0,
      highlights = dev.Highlights2012 or 0,
      shadows = dev.Shadows2012 or 0,
      saturation = dev.Saturation or 0,
      temperature = dev.Temperature or 5500,
      cropped = dev.CropTop ~= nil,
      processVersion = dev.ProcessVersion,
    },
  }
end

function M.token()
  return config.token or ''
end

function M.headers(json)
  local h = { { field = 'Authorization', value = 'Bearer ' .. M.token() } }
  if json then table.insert(h, { field = 'Content-Type', value = 'application/json' }) end
  return h
end

function M.post(body)
  if type(body.frames) ~= 'table' or #body.frames == 0 or #body.frames > 5000 then
    return false, 'Select between 1 and 5,000 photos before syncing.'
  end
  body.workspace = M.workspace()
  body.direction = 'to-studio'
  local encoded, payload = pcall(function() return JSON:encode(body) end)
  if not encoded then return false, 'This selection could not be encoded safely. Send a smaller selection and check its metadata.' end
  local response = LrHttp.post(M.endpoint(), payload, M.headers(true))
  local parsed, receipt = pcall(function() return JSON:decode(response) end)
  if not parsed or type(receipt) ~= 'table' or receipt.ok ~= true or receipt.workspace ~= M.workspace()
    or receipt.received ~= #body.frames or type(receipt.at) ~= 'number' or receipt.at <= 0 then
    return false, 'Sync was not confirmed. Check the bridge connection before trying again.'
  end
  return true
end

function M.get()
  local body = LrHttp.get(withQuery(M.endpoint(), 'workspace=' .. M.workspace() .. '&matching=relative-path-v1'), M.headers(false))
  if not body then return nil, 'The bridge did not respond. Check the connection.' end
  local ok, parsed = pcall(function() return JSON:decode(body) end)
  if not ok or type(parsed) ~= 'table' or JSON:isArray(parsed) or parsed.error ~= nil then
    return nil, 'The bridge response was not valid. Check the connection and plug-in version.'
  end
  if parsed.workspace ~= M.workspace() or parsed.direction ~= 'to-lightroom'
    or (parsed.kind ~= 'empty' and parsed.kind ~= 'verdicts-relative-path-v1')
    or type(parsed.at) ~= 'number' or not JSON:isArray(parsed.frames) then
    return nil, 'The bridge returned an incompatible queue. Update the plug-in and publish again.'
  end
  return parsed
end


-- XMP on disk keeps Lightroom and LensLabs honest with each other.
function M.writeSidecar(photo)
  photo:saveMetadata()
end

return M
`;

const PUSH_LUA = `local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDialogs = import 'LrDialogs'
local Bridge = require 'LensLabsBridge'

LrTasks.startAsyncTask(function()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  if #photos == 0 or #photos > 5000 then
    LrDialogs.message('LensLabs', 'Select between 1 and 5,000 photos in Lightroom first.')
    return
  end

  local frames = {}
  for _, photo in ipairs(photos) do
    frames[#frames + 1] = Bridge.readPhoto(photo)
  end

  -- Write XMP sidecars so the files on disk carry the same truth.
  catalog:withWriteAccessDo('LensLabs — write XMP', function()
    for _, photo in ipairs(photos) do
      Bridge.writeSidecar(photo)
    end
  end)

  local ok, message = Bridge.post({ kind = 'push', at = os.time(), frames = frames })
  if not ok then
    LrDialogs.message('LensLabs', 'The local metadata write was requested, but cloud sync is not confirmed. ' .. (message or 'Check the bridge connection.'))
    return
  end
  LrDialogs.showBezel('LensLabs · bridge received ' .. #frames .. ' frames; open Studio to review')
end)
`;

const MATCHING_LUA = String.raw`-- Exact folder-path matching; no basename fallback or locale folding. Preflight before writes.
local M = {}
local JSON = require 'JSON'
local function parts(value, absolute)
  if type(value) ~= 'string' or #value == 0 or #value > 4096 or value:find('[%c]') then return nil end
  local path = value:gsub('\\', '/')
  local isAbsolute = path:sub(1, 1) == '/' or path:match('^%a:/') ~= nil
  if isAbsolute ~= absolute then return nil end
  path = path:gsub('^/+', '')
  if path:find('//', 1, true) or path:sub(-1) == '/' then return nil end
  local out = {}
  for part in path:gmatch('[^/]+') do
    if part == '.' or part == '..' then return nil end
    out[#out + 1] = part
  end
  if #out > 64 then return nil end
  return out
end

local function finite(value)
  return type(value) == 'number' and value == value and value ~= math.huge and value ~= -math.huge
end

function M.plan(frames, photos)
  if type(frames) ~= 'table' or #frames == 0 or #frames > 5000 then return nil, 'No valid LensLabs verdict batch. Publish again from the updated Studio.' end
  local requests, wanted, names, depths = {}, {}, {}, {}
  for _, frame in ipairs(frames) do
    if type(frame) ~= 'table' or type(frame.file) ~= 'string' then return nil, 'Invalid photo metadata. Nothing was applied.' end
    -- A null label means no label update; null array entries must still fail preflight.
    if frame.label == JSON.null then frame.label = nil end
    local relative = parts(frame.relativePath, false)
    if not relative or #relative < 2 or relative[#relative] ~= frame.file then return nil, 'Import the matching source folder in LensLabs and publish again. Nothing was applied.' end
    if frame.verdict ~= 'keep' and frame.verdict ~= 'reject' and frame.verdict ~= 'undecided' then return nil, 'Invalid pick. Nothing was applied.' end
    if frame.rating ~= nil and (not finite(frame.rating) or frame.rating < 0 or frame.rating > 5 or frame.rating % 1 ~= 0) then return nil, 'Invalid stars. Nothing was applied.' end
    if frame.score ~= nil and not finite(frame.score) then return nil, 'Invalid score. Nothing was applied.' end
    if frame.label ~= nil and (type(frame.label) ~= 'string' or #frame.label > 4000) then return nil, 'Invalid label. Nothing was applied.' end
    if frame.package ~= nil and type(frame.package) ~= 'string' then return nil, 'Invalid package. Nothing was applied.' end
    if frame.iptc ~= nil and (type(frame.iptc) ~= 'table' or (frame.iptc.caption ~= nil and (type(frame.iptc.caption) ~= 'string' or #frame.iptc.caption > 40000))) then return nil, 'Invalid caption. Nothing was applied.' end
    local key = table.concat(relative, '/')
    if wanted[key] then return nil, 'Duplicate source paths. Nothing was applied.' end
    wanted[key], names[frame.file], depths[#relative] = true, true, true
    requests[#requests + 1] = { key = key, frame = frame }
  end
  -- Read each catalog path once, even when thousands of camera cards use IMG_0001.
  local index = {}
  for _, photo in ipairs(photos) do
    local name = photo:getFormattedMetadata('fileName')
    if names[name] then
      local source = parts(photo:getRawMetadata('path'), true)
      if source and source[#source] == name then
        for depth in pairs(depths) do
          if #source >= depth then
            local key = table.concat(source, '/', #source - depth + 1)
            if wanted[key] then
              if index[key] then index[key].count = index[key].count + 1
              else index[key] = { photo = photo, count = 1 } end
            end
          end
        end
      end
    end
  end
  local plan, used = {}, {}
  for _, request in ipairs(requests) do
    local match = index[request.key]
    if not match or match.count ~= 1 or used[match.photo] then return nil, 'A source path is missing or ambiguous (including virtual copies). Nothing was applied. Reconnect or disambiguate those originals first.' end
    used[match.photo] = true
    plan[#plan + 1] = { photo = match.photo, frame = request.frame }
  end
  return plan
end
return M
`;

const PULL_LUA = `local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDialogs = import 'LrDialogs'
local Bridge = require 'LensLabsBridge'
local Matching = require 'LensLabsMatch'

LrTasks.startAsyncTask(function()
  local state, readError = Bridge.get()
  if readError then LrDialogs.message('LensLabs', readError) return end
  if state and state.kind == 'empty' then
    LrDialogs.message('LensLabs', 'No verdicts are queued. Publish your selections from LensLabs Studio first.')
    return
  end
  if not state or state.kind ~= 'verdicts-relative-path-v1' or not state.frames then
    LrDialogs.message('LensLabs', 'No folder-matched verdicts waiting. Update the LensLabs plug-in, import the matching source folder in Studio, and publish again.')
    return
  end
  local catalog = LrApplication.activeCatalog()
  local applied, failure = 0, nil
  catalog:withWriteAccessDo('LensLabs — apply verdicts', function()
    -- Preflight every target under the write lock, before touching any metadata.
    local plan, message = Matching.plan(state.frames, catalog:getAllPhotos())
    if not plan then failure = message return end
    for _, item in ipairs(plan) do
        local photo, frame = item.photo, item.frame
        if frame.rating ~= nil then photo:setRawMetadata('rating', frame.rating) end
        if frame.verdict == 'keep' then photo:setRawMetadata('pickStatus', 1)
        elseif frame.verdict == 'reject' then photo:setRawMetadata('pickStatus', -1)
        elseif frame.verdict == 'undecided' then photo:setRawMetadata('pickStatus', 0) end
        if frame.label then photo:setRawMetadata('label', frame.label) end
        if frame.iptc and frame.iptc.caption then photo:setRawMetadata('caption', frame.iptc.caption) end
        if frame.score then photo:setPropertyForPlugin(_PLUGIN, 'lensosScore', tostring(frame.score)) end
        if frame.verdict then photo:setPropertyForPlugin(_PLUGIN, 'lensosVerdict', frame.verdict) end
        if frame.package then photo:setPropertyForPlugin(_PLUGIN, 'lensosPackage', frame.package) end
        Bridge.writeSidecar(photo)
        applied = applied + 1
    end
  end)
  if failure then LrDialogs.message('LensLabs', failure) return end
  LrDialogs.showBezel('LensLabs · applied ' .. applied .. ' frames')
end)
`;

const WATCH_LUA = `local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDialogs = import 'LrDialogs'
local Bridge = require 'LensLabsBridge'

-- Live sync: every 5 seconds push the current selection's develop state to LensLabs.
LrTasks.startAsyncTask(function()
  local run = Bridge.startWatch()
  if not run then LrDialogs.showBezel('LensLabs · live sync is already running') return end
  LrDialogs.showBezel('LensLabs · live sync on')
  while run.active do
    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    if photos and #photos > 5000 then
      Bridge.stopWatch(run)
      LrDialogs.message('LensLabs', 'Live sync paused. Select at most 5,000 photos, then restart live sync.')
      return
    end
    if photos and #photos > 0 then
      local frames = {}
      for _, photo in ipairs(photos) do
        frames[#frames + 1] = Bridge.readPhoto(photo)
      end
      local ok, message = Bridge.post({ kind = 'live', at = os.time(), frames = frames })
      if not run.active then return end
      if not ok then
        Bridge.stopWatch(run)
        LrDialogs.message('LensLabs', 'Live sync paused. ' .. (message or 'The bridge did not confirm this selection.') .. ' Restart live sync after checking the connection.')
        return
      end
    end
    LrTasks.sleep(5)
  end
end)
`;

const STOP_LUA = `local Bridge = require 'LensLabsBridge'
local LrDialogs = import 'LrDialogs'
Bridge.stopWatch()
LrDialogs.showBezel('LensLabs · live sync stopped; an in-flight request may still finish')
`;

const README = (endpoint: string, workspace: string) => `LensLabs — Lightroom Classic plugin
==================================

Install
-------
1. Unzip. You get a folder named LensLabs.lrplugin.
2. Lightroom Classic → File → Plug-in Manager → Add → choose LensLabs.lrplugin → Done.
3. If LensLabs is not running on this machine, open LensLabsConfig.lua and change
   the endpoint. Current endpoint: ${endpoint}
   Workspace: ${workspace}  (must match the workspace shown in LensLabs → Adobe)

Use
---
Library → Plug-in Extras → "Push selection to LensLabs"
  Writes XMP sidecars (rating, colour label, pick flag, IPTC caption/headline/
  keywords/creator/copyright) and sends develop settings to the LensLabs studio.
  Bridge receipt is confirmed only for this workspace and entire selection; Studio still needs to read it.
  If confirmation fails, the local metadata write may still have happened; inspect before retrying.

Library → Plug-in Extras → "Pull LensLabs verdicts into catalog"
  Reads keeps/rejects/ratings/labels/captions back from LensLabs, writes them
  into the catalog and re-saves XMP so both sides agree.
  Version 1.3 requires the matching source folder (not loose files) in Studio.
  Folder paths and extensions must match exactly. Duplicate paths, virtual copies,
  missing targets or invalid metadata stop the entire batch before any writes.
  Older filename-only plug-ins must be replaced; old queued batches must be published again.

Library → Plug-in Extras → "Start live sync (every 5s)"
  Keeps pushing the current selection while you edit, so the studio's develop
  state updates as you work. Only one watcher runs. An unconfirmed response pauses it.
  Use "Stop live sync" to stop future requests; an in-flight request may still finish.
  Send at most 5,000 photos and 8 MiB of metadata per request.

The plug-in updates catalog metadata through Lightroom's SDK and requests XMP saves.
It does not write catalog database bytes directly. Keep normal catalog and XMP backups.
`;

export function pluginFiles(endpoint: string, workspace: string, token: string) {
  return [
    { path: "LensLabs.lrplugin/Info.lua", text: INFO_LUA(endpoint) },
    { path: "LensLabs.lrplugin/LensLabsConfig.lua", text: CONFIG_LUA(endpoint, workspace, token) },
    { path: "LensLabs.lrplugin/LensLabsBridge.lua", text: COMMON_LUA },
    { path: "LensLabs.lrplugin/LensLabsMatch.lua", text: MATCHING_LUA },
    { path: "LensLabs.lrplugin/LensLabsMetadata.lua", text: METADATA_LUA },
    { path: "LensLabs.lrplugin/LensLabsPush.lua", text: PUSH_LUA },
    { path: "LensLabs.lrplugin/LensLabsPull.lua", text: PULL_LUA },
    { path: "LensLabs.lrplugin/LensLabsWatch.lua", text: WATCH_LUA },
    { path: "LensLabs.lrplugin/LensLabsStop.lua", text: STOP_LUA },
    { path: "LensLabs.lrplugin/JSON.lua", text: JSON_LUA },
    { path: "README.txt", text: README(endpoint, workspace) },
  ];
}

export function downloadLightroomPlugin(credentials: { workspace: string; token: string }) {
  // Always the live domain: Lightroom runs outside the browser and cannot reach
  // a preview or localhost origin.
  const endpoint = bridgeEndpoint();
  const blob = makeZip(pluginFiles(endpoint, credentials.workspace, credentials.token));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "LensLabs.lrplugin.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return endpoint;
}

/* ---------------- bridge payload types ---------------- */

export interface BridgeFrame {
  file: string;
  path?: string;
  relativePath?: string;
  uuid?: string;
  rating?: number;
  label?: string | null;
  pick?: number;
  verdict?: "keep" | "reject" | "undecided";
  score?: number;
  package?: string;
  iptc?: {
    caption?: string;
    headline?: string;
    keywords?: string;
    creator?: string;
    copyright?: string;
  };
  develop?: {
    exposure?: number;
    contrast?: number;
    highlights?: number;
    shadows?: number;
    saturation?: number;
    temperature?: number;
    cropped?: boolean;
    processVersion?: string;
  };
}

export interface BridgeState {
  kind: string;
  at: number;
  frames: BridgeFrame[];
}
