-- English / Spanish page pairs.
-- The Spanish site mirrors the English one under es/ (es/shop.qmd <-> shop.qmd,
-- es/posts/Rooted/index.qmd <-> posts/Rooted/index.qmd). For every page whose
-- twin exists, this adds to <head>:
--   <link rel="alternate" hreflang="en|es|x-default" href="...">  (for search engines)
--   <meta name="salem:alternate" content="es/shop.html">           (read by the
--     language link in _partials/site-settings.html, relative to the site root)
-- Pages without a twin get nothing, and their language link goes to the other home page.

local SITE_URL = "https://iquinones2.github.io/Salem-Blog" -- keep in sync with site-url in _quarto.yml

local function exists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

local function to_html(rel)
  return (rel:gsub("%.qmd$", ".html"))
end

local function pretty(rel) -- what search engines should see: folders without index.html
  return (to_html(rel):gsub("index%.html$", ""))
end

function Meta(meta)
  local input = quarto.doc.input_file
  local root = quarto.project.directory
  if not input or not root then return meta end
  input = input:gsub("\\", "/")
  root = root:gsub("\\", "/"):gsub("/$", "")
  if input:sub(1, #root + 1) ~= root .. "/" then return meta end
  local rel = input:sub(#root + 2)

  local en_rel, es_rel, twin
  if rel:match("^es/") then
    es_rel, en_rel = rel, rel:sub(4)
    twin = en_rel
  else
    en_rel, es_rel = rel, "es/" .. rel
    twin = es_rel
  end
  if not (exists(root .. "/" .. en_rel) and exists(root .. "/" .. es_rel)) then return meta end

  quarto.doc.include_text("in-header", table.concat({
    '<link rel="alternate" hreflang="en" href="' .. SITE_URL .. "/" .. pretty(en_rel) .. '">',
    '<link rel="alternate" hreflang="es" href="' .. SITE_URL .. "/" .. pretty(es_rel) .. '">',
    '<link rel="alternate" hreflang="x-default" href="' .. SITE_URL .. "/" .. pretty(en_rel) .. '">',
    '<meta name="salem:alternate" content="' .. to_html(twin) .. '">'
  }, "\n"))
  return meta
end
