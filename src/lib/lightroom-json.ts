/** Lua 5.1 codec for the generated bridge. No SDK, network, filesystem or code evaluation. */
export const LIGHTROOM_JSON_LUA = String.raw`-- LensLabs bounded JSON codec. RFC 8259 syntax; rejects ambiguous duplicate keys.
local JSON = { null = {} }
local arrayType = {}
local MAX_BYTES, MAX_DEPTH, MAX_VALUES = 8388608, 64, 250000
local function fail() error('Invalid or oversized JSON response', 0) end
local function finite(n) return type(n) == 'number' and n == n and n ~= math.huge and n ~= -math.huge end

local function validUtf8(s)
  local i = 1
  while i <= #s do
    local a, b = s:byte(i), s:byte(i + 1)
    local n = 0
    if a < 128 then n = 1
    elseif a >= 194 and a <= 223 then n = 2
    elseif a >= 224 and a <= 239 then n = 3
    elseif a >= 240 and a <= 244 then n = 4
    else fail() end
    if i + n - 1 > #s then fail() end
    if (a == 224 and b < 160) or (a == 237 and b > 159) or (a == 240 and b < 144) or (a == 244 and b > 143) then fail() end
    for j = 1, n - 1 do local c = s:byte(i + j) if c < 128 or c > 191 then fail() end end
    i = i + n
  end
  return s
end

local function utf8(n)
  if n < 128 then return string.char(n) end
  if n < 2048 then return string.char(192 + math.floor(n / 64), 128 + n % 64) end
  if n < 65536 then return string.char(224 + math.floor(n / 4096), 128 + math.floor(n / 64) % 64, 128 + n % 64) end
  return string.char(240 + math.floor(n / 262144), 128 + math.floor(n / 4096) % 64, 128 + math.floor(n / 64) % 64, 128 + n % 64)
end

function JSON:isArray(value) return type(value) == 'table' and getmetatable(value) == arrayType end

function JSON:decode(str)
  if type(str) ~= 'string' or #str == 0 or #str > MAX_BYTES then fail() end
  local pos, count = 1, 0
  local function skip()
    while true do
      local c = str:byte(pos)
      if c ~= 32 and c ~= 9 and c ~= 10 and c ~= 13 then return end
      pos = pos + 1
    end
  end
  local function hex4()
    local text = str:sub(pos, pos + 3)
    if #text ~= 4 or text:find('[^0-9a-fA-F]') then fail() end
    pos = pos + 4
    return tonumber(text, 16)
  end
  local function parseString()
    if str:sub(pos, pos) ~= '"' then fail() end
    pos = pos + 1
    local start, out = pos, {}
    while pos <= #str do
      local c = str:byte(pos)
      if c == 34 then
        out[#out + 1] = str:sub(start, pos - 1)
        pos = pos + 1
        return validUtf8(table.concat(out))
      elseif c == 92 then
        out[#out + 1] = str:sub(start, pos - 1)
        pos = pos + 1
        local code = str:sub(pos, pos)
        pos = pos + 1
        local escapes = { ['"']='"', ['\\']='\\', ['/']='/', b='\b', f='\f', n='\n', r='\r', t='\t' }
        if code == 'u' then
          local cp = hex4()
          if cp >= 55296 and cp <= 56319 then
            if str:sub(pos, pos + 1) ~= '\\u' then fail() end
            pos = pos + 2
            local low = hex4()
            if low < 56320 or low > 57343 then fail() end
            cp = 65536 + (cp - 55296) * 1024 + low - 56320
          elseif cp >= 56320 and cp <= 57343 then fail() end
          out[#out + 1] = utf8(cp)
        elseif escapes[code] then out[#out + 1] = escapes[code]
        else fail() end
        start = pos
      elseif c < 32 then fail()
      else pos = pos + 1 end
    end
    fail()
  end
  local function digits()
    local start = pos
    while str:sub(pos, pos):match('%d') do pos = pos + 1 end
    if pos == start then fail() end
  end
  local function number()
    local start = pos
    if str:sub(pos, pos) == '-' then pos = pos + 1 end
    if str:sub(pos, pos) == '0' then pos = pos + 1 else digits() end
    if str:sub(pos, pos) == '.' then pos = pos + 1 digits() end
    local c = str:sub(pos, pos)
    if c == 'e' or c == 'E' then
      pos = pos + 1 c = str:sub(pos, pos)
      if c == '+' or c == '-' then pos = pos + 1 end
      digits()
    end
    local value = tonumber(str:sub(start, pos - 1))
    if not finite(value) then fail() end
    return value
  end
  local parseValue
  parseValue = function(depth)
    count = count + 1
    if depth > MAX_DEPTH or count > MAX_VALUES then fail() end
    skip()
    local c = str:sub(pos, pos)
    if c == '"' then return parseString() end
    if c == '{' or c == '[' then
      local array, close = c == '[', c == '[' and ']' or '}'
      local out, seen = {}, {}
      if array then setmetatable(out, arrayType) end
      pos = pos + 1 skip()
      if str:sub(pos, pos) == close then pos = pos + 1 return out end
      while true do
        skip()
        local key
        if array then key = #out + 1
        else
          key = parseString()
          if seen[key] then fail() end
          seen[key] = true
          skip()
          if str:sub(pos, pos) ~= ':' then fail() end
          pos = pos + 1
        end
        out[key] = parseValue(depth + 1)
        skip()
        local separator = str:sub(pos, pos)
        pos = pos + 1
        if separator == close then return out end
        if separator ~= ',' then fail() end
      end
    end
    for text, value in pairs({ ['true']=true, ['false']=false, ['null']=JSON.null }) do
      if str:sub(pos, pos + #text - 1) == text then pos = pos + #text return value end
    end
    if c == '-' or c:match('%d') then return number() end
    fail()
  end
  local value = parseValue(0)
  skip()
  if pos <= #str then fail() end
  return value
end

function JSON:encode(value)
  local out, seen = {}, {}
  local size, count = 0, 0
  local function emit(s)
    size = size + #s
    if size > MAX_BYTES then fail() end
    out[#out + 1] = s
  end
  local function quote(s)
    validUtf8(s)
    emit('"')
    emit((s:gsub('[%z\1-\31"\\]', function(c)
      if c == '"' then return '\\"' end
      if c == '\\' then return '\\\\' end
      return string.format('\\u%04x', c:byte())
    end)))
    emit('"')
  end
  local encode
  encode = function(v, depth)
    count = count + 1
    if count > MAX_VALUES or depth > MAX_DEPTH then fail() end
    if v == JSON.null or v == nil then emit('null') return end
    local kind = type(v)
    if kind == 'string' then quote(v)
    elseif kind == 'boolean' then emit(tostring(v))
    elseif kind == 'number' then
      if not finite(v) then fail() end
      emit((string.format('%.17g', v):gsub(',', '.')))
    elseif kind == 'table' then
      if seen[v] then fail() end
      seen[v] = true
      local array = JSON:isArray(v) or #v > 0
      local n = 0
      for key in pairs(v) do
        n = n + 1
        if array then
          if type(key) ~= 'number' or key < 1 or key > #v or key % 1 ~= 0 then fail() end
        elseif type(key) ~= 'string' then fail() end
      end
      if array and n ~= #v then fail() end
      emit(array and '[' or '{')
      local first = true
      if array then
        for _, item in ipairs(v) do
          if not first then emit(',') end first = false encode(item, depth + 1)
        end
      else
        for key, item in pairs(v) do
          if not first then emit(',') end first = false quote(key) emit(':') encode(item, depth + 1)
        end
      end
      emit(array and ']' or '}')
      seen[v] = nil
    else fail() end
  end
  encode(value, 0)
  return table.concat(out)
end
return JSON
`;
