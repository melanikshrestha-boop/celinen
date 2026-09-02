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

export const BRIDGE_PATH = "/api/public/lightroom";

/** The live LensLabs bridge. Lightroom runs outside the browser, so the plugin can
 *  never use a preview/localhost origin — it always talks to the published domain. */
export const LIVE_ORIGIN = "https://lenslab.dev";

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
  },
  LrMetadataProvider = 'LensLabsMetadata.lua',
  VERSION = { major = 1, minor = 2, revision = 0 },
}
`;

const CONFIG_LUA = (endpoint: string, workspace: string) => `-- LensLabs bridge settings.
-- endpoint  : the live LensLabs sync URL (only change this if you self-host).
-- workspace : the studio this catalog syncs into (see Adobe tab in LensLabs).
return {
  endpoint = '${endpoint}',
  workspace = '${workspace}',
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

function M.endpoint()
  return config.endpoint
end

function M.workspace()
  return config.workspace or 'default'
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

function M.post(body)
  body.workspace = M.workspace()
  body.direction = 'to-studio'
  local payload = JSON:encode(body)
  local headers = { { field = 'Content-Type', value = 'application/json' } }
  return LrHttp.post(M.endpoint(), payload, headers)
end

function M.get()
  local body = LrHttp.get(withQuery(M.endpoint(), 'workspace=' .. M.workspace()))
  if not body then return nil end
  local ok, parsed = pcall(function() return JSON:decode(body) end)
  if ok then return parsed end
  return nil
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
  if #photos == 0 then
    LrDialogs.message('LensLabs', 'Select photos in Lightroom first.')
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

  local ok = Bridge.post({ kind = 'push', at = os.time(), frames = frames })
  LrDialogs.showBezel('LensLabs · pushed ' .. #frames .. ' frames')
  if not ok then
    LrDialogs.message('LensLabs', 'XMP written, but the LensLabs bridge did not answer at ' .. Bridge.endpoint())
  end
end)
`;

const PULL_LUA = `local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDialogs = import 'LrDialogs'
local Bridge = require 'LensLabsBridge'

LrTasks.startAsyncTask(function()
  local state = Bridge.get()
  if not state or not state.frames then
    LrDialogs.message('LensLabs', 'No LensLabs verdicts waiting at ' .. Bridge.endpoint())
    return
  end

  local byName = {}
  for _, frame in ipairs(state.frames) do
    byName[string.lower(frame.file or '')] = frame
  end

  local catalog = LrApplication.activeCatalog()
  local applied = 0
  catalog:withWriteAccessDo('LensLabs — apply verdicts', function()
    for _, photo in ipairs(catalog:getAllPhotos()) do
      local name = string.lower(photo:getFormattedMetadata('fileName') or '')
      local frame = byName[name]
      if frame then
        if frame.rating ~= nil then photo:setRawMetadata('rating', frame.rating) end
        if frame.verdict == 'keep' then photo:setRawMetadata('pickStatus', 1)
        elseif frame.verdict == 'reject' then photo:setRawMetadata('pickStatus', -1) end
        if frame.label then photo:setRawMetadata('label', frame.label) end
        if frame.iptc and frame.iptc.caption then photo:setRawMetadata('caption', frame.iptc.caption) end
        if frame.score then photo:setPropertyForPlugin(_PLUGIN, 'lensosScore', tostring(frame.score)) end
        if frame.verdict then photo:setPropertyForPlugin(_PLUGIN, 'lensosVerdict', frame.verdict) end
        if frame.package then photo:setPropertyForPlugin(_PLUGIN, 'lensosPackage', frame.package) end
        Bridge.writeSidecar(photo)
        applied = applied + 1
      end
    end
  end)

  LrDialogs.showBezel('LensLabs · applied ' .. applied .. ' frames')
end)
`;

const WATCH_LUA = `local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDialogs = import 'LrDialogs'
local Bridge = require 'LensLabsBridge'

-- Live sync: every 5 seconds push the current selection's develop state to LensLabs.
LrTasks.startAsyncTask(function()
  LrDialogs.showBezel('LensLabs · live sync on')
  local running = true
  while running do
    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    if photos and #photos > 0 then
      local frames = {}
      for _, photo in ipairs(photos) do
        frames[#frames + 1] = Bridge.readPhoto(photo)
      end
      Bridge.post({ kind = 'live', at = os.time(), frames = frames })
    end
    LrTasks.sleep(5)
  end
end)
`;

const JSON_LUA = `-- Tiny JSON encoder/decoder used by the LensLabs bridge.
local JSON = {}

local function esc(s)
  return (s:gsub('[%c"\\\\]', function(c)
    local map = { ['"'] = '\\\\"', ['\\\\'] = '\\\\\\\\', ['\\n'] = '\\\\n', ['\\r'] = '\\\\r', ['\\t'] = '\\\\t' }
    return map[c] or string.format('\\\\u%04x', c:byte())
  end))
end

local function encode(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then return string.format('%.6g', v) end
  if t == 'string' then return '"' .. esc(v) .. '"' end
  if t == 'table' then
    if #v > 0 then
      local parts = {}
      for _, item in ipairs(v) do parts[#parts + 1] = encode(item) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    local parts = {}
    for k, item in pairs(v) do parts[#parts + 1] = '"' .. esc(tostring(k)) .. '":' .. encode(item) end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end

function JSON:encode(v) return encode(v) end

-- Decoder: minimal recursive descent, enough for the LensLabs payload.
function JSON:decode(str)
  local pos = 1
  local function skip() while pos <= #str and str:sub(pos, pos):match('%s') do pos = pos + 1 end end
  local parseValue
  local function parseString()
    pos = pos + 1
    local out = {}
    while pos <= #str do
      local c = str:sub(pos, pos)
      if c == '"' then pos = pos + 1 return table.concat(out) end
      if c == '\\\\' then
        local n = str:sub(pos + 1, pos + 1)
        local map = { n = '\\n', t = '\\t', r = '\\r', ['"'] = '"', ['\\\\'] = '\\\\', ['/'] = '/' }
        out[#out + 1] = map[n] or n
        pos = pos + 2
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
    return table.concat(out)
  end
  local function parseNumber()
    local s = pos
    while pos <= #str and str:sub(pos, pos):match('[%d%.%-%+eE]') do pos = pos + 1 end
    return tonumber(str:sub(s, pos - 1))
  end
  parseValue = function()
    skip()
    local c = str:sub(pos, pos)
    if c == '{' then
      pos = pos + 1
      local obj = {}
      skip()
      if str:sub(pos, pos) == '}' then pos = pos + 1 return obj end
      while true do
        skip()
        local k = parseString()
        skip()
        pos = pos + 1 -- colon
        obj[k] = parseValue()
        skip()
        local d = str:sub(pos, pos)
        pos = pos + 1
        if d == '}' then return obj end
      end
    elseif c == '[' then
      pos = pos + 1
      local arr = {}
      skip()
      if str:sub(pos, pos) == ']' then pos = pos + 1 return arr end
      while true do
        arr[#arr + 1] = parseValue()
        skip()
        local d = str:sub(pos, pos)
        pos = pos + 1
        if d == ']' then return arr end
      end
    elseif c == '"' then
      return parseString()
    elseif str:sub(pos, pos + 3) == 'true' then pos = pos + 4 return true
    elseif str:sub(pos, pos + 4) == 'false' then pos = pos + 5 return false
    elseif str:sub(pos, pos + 3) == 'null' then pos = pos + 4 return nil
    else return parseNumber() end
  end
  return parseValue()
end

return JSON
`;

const README = (endpoint: string, workspace = "default") => `LensLabs — Lightroom Classic plugin
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

Library → Plug-in Extras → "Pull LensLabs verdicts into catalog"
  Reads keeps/rejects/ratings/labels/captions back from LensLabs, writes them
  into the catalog and re-saves XMP so both sides agree.

Library → Plug-in Extras → "Start live sync (every 5s)"
  Keeps pushing the current selection while you edit, so the studio's develop
  state updates as you work.

LensLabs never touches your .lrcat. All sync goes through XMP + this plugin.
`;

export function pluginFiles(endpoint: string, workspace = "default") {
  return [
    { path: "LensLabs.lrplugin/Info.lua", text: INFO_LUA(endpoint) },
    { path: "LensLabs.lrplugin/LensLabsConfig.lua", text: CONFIG_LUA(endpoint, workspace) },
    { path: "LensLabs.lrplugin/LensLabsBridge.lua", text: COMMON_LUA },
    { path: "LensLabs.lrplugin/LensLabsMetadata.lua", text: METADATA_LUA },
    { path: "LensLabs.lrplugin/LensLabsPush.lua", text: PUSH_LUA },
    { path: "LensLabs.lrplugin/LensLabsPull.lua", text: PULL_LUA },
    { path: "LensLabs.lrplugin/LensLabsWatch.lua", text: WATCH_LUA },
    { path: "LensLabs.lrplugin/JSON.lua", text: JSON_LUA },
    { path: "README.txt", text: README(endpoint, workspace) },
  ];
}

export function downloadLightroomPlugin(workspace = "default") {
  // Always the live domain: Lightroom runs outside the browser and cannot reach
  // a preview or localhost origin.
  const endpoint = bridgeEndpoint();
  const blob = makeZip(pluginFiles(endpoint, workspace));
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
