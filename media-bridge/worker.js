// media-bridge v2.4.0 - secure MCP server for The Hidden Why media retrieval.
// v2.4.0 hardens resolve_pinterest: redirect-chain tracing, descriptive unsupported_url errors (board / profile / login wall),
// login-wall ?next= unwrapping, and a pin-id fallback from the page's own canonical / og:url / app-link tags.
// v2.3.0 adds generate_image: calls the Hugging Face Space mcp-tools/Z-Image-Turbo through its Gradio API
// (host restricted to GEN_HOSTS) and, when the GitHub relay is configured, relays the result so the sandbox can download it.
// v2.2.0 adds resolve_pinterest: follows pin.it / pinterest.com pin URLs (validated at every hop, page hosts
// restricted to RESOLVER_HOSTS) and returns a direct video URL on an approved media host (v1.pinimg.com).
// v2.1.0 adds relay_media / relay_cleanup: copy an approved media URL to a temporary GitHub Release
// asset so a sandbox that can reach github.com (but not the media CDNs) can download it.
// Runs on Cloudflare Workers FREE plan. No storage, no paid services.
// Secrets (Worker "Variables and Secrets" -> Secret): ACCESS_TOKEN (required),
// PEXELS_API_KEY and PIXABAY_API_KEY (optional), GITHUB_TOKEN and GITHUB_REPO (for relay only),
// PINTEREST_USER_AGENT (optional override of the User-Agent used for Pinterest page requests),
// HF_TOKEN (optional, Hugging Face read token: gives generate_image your own ZeroGPU quota).
// Never put secrets in this file.

const VERSION = "2.4.0";
const CHUNK_DEFAULT = 65536;
const CHUNK_MAX = 98304;
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const RELAY_MAX_BYTES = 100 * 1024 * 1024;   // free-plan friendly cap for relayed files
const RELAY_TAG = "media-relay";
const PIN_HTML_MAX = 4 * 1024 * 1024;       // max Pinterest HTML bytes read by the resolver
const RESOLVER_MAX_REDIRECTS = 5;            // pin.it -> pinterest.com -> locale/canonical hops
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15000;
const RELAY_TIMEOUT_MS = 180000;
const GEN_TIMEOUT_MS = 170000;               // image generation can queue on ZeroGPU
const RATE_LIMIT_PER_MIN = 1500;
const UA = "TheHiddenWhyMediaBridge/2.0 (+https://media-bridge.fatehayeb17.workers.dev)";

const API_HOSTS = ["commons.wikimedia.org", "archive.org", "api.pexels.com", "pixabay.com"];
const MEDIA_HOSTS = ["upload.wikimedia.org", "archive.org", ".archive.org", "images.pexels.com", "videos.pexels.com", "cdn.pixabay.com", "v1.pinimg.com", "i.pinimg.com", "mcp-tools-z-image-turbo.hf.space"];
// Hosts the Pinterest resolver may fetch HTML pages from. Deliberately NOT part of MEDIA_HOSTS, so
// probe_media / fetch_chunk / relay_media can never be used on Pinterest pages. ".pinterest.com" matches
// subdomains only (the leading dot is required), so "evilpinterest.com" does not match.
const RESOLVER_HOSTS = ["pin.it", "pinterest.com", ".pinterest.com"];

// Image generation (Hugging Face Space mcp-tools/Z-Image-Turbo, Gradio api_name "generate").
const GEN_BASE = "https://mcp-tools-z-image-turbo.hf.space";
const GEN_HOSTS = ["mcp-tools-z-image-turbo.hf.space"];
const GEN_RESOLUTIONS = [
  "1024x1024 ( 1:1 )", "1152x896 ( 9:7 )", "896x1152 ( 7:9 )", "1152x864 ( 4:3 )", "864x1152 ( 3:4 )", "1248x832 ( 3:2 )",
  "832x1248 ( 2:3 )", "1280x720 ( 16:9 )", "720x1280 ( 9:16 )", "1344x576 ( 21:9 )", "576x1344 ( 9:21 )",
  "1280x1280 ( 1:1 )", "1440x1120 ( 9:7 )", "1120x1440 ( 7:9 )", "1472x1104 ( 4:3 )", "1104x1472 ( 3:4 )", "1536x1024 ( 3:2 )",
  "1024x1536 ( 2:3 )", "1536x864 ( 16:9 )", "864x1536 ( 9:16 )", "1680x720 ( 21:9 )", "720x1680 ( 9:21 )",
  "1536x1536 ( 1:1 )", "1728x1344 ( 9:7 )", "1344x1728 ( 7:9 )", "1728x1296 ( 4:3 )", "1296x1728 ( 3:4 )", "1872x1248 ( 3:2 )",
  "1248x1872 ( 2:3 )", "2048x1152 ( 16:9 )", "1152x2048 ( 9:16 )", "2016x864 ( 21:9 )", "864x2016 ( 9:21 )",
];

const SIGNATURES = [
  ["jpeg", [0xff, 0xd8, 0xff]], ["png", [0x89, 0x50, 0x4e, 0x47]], ["gif", [0x47, 0x49, 0x46, 0x38]],
  ["webm/mkv", [0x1a, 0x45, 0xdf, 0xa3]], ["ogg", [0x4f, 0x67, 0x67, 0x53]],
];

class BridgeError extends Error { constructor(code, message) { super(message); this.code = code; } }

// ---------- validation ----------
function hostAllowed(host, list) {
  host = host.toLowerCase();
  return list.some(h => (h.startsWith(".") ? host.endsWith(h) : host === h));
}
function isIpLiteral(host) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("["); }

function validateUrl(raw, hosts) {
  let u;
  try { u = new URL(raw); } catch { throw new BridgeError("invalid_url", "URL could not be parsed"); }
  if (u.protocol !== "https:") throw new BridgeError("unsupported_protocol", "only https is allowed");
  if (u.username || u.password) throw new BridgeError("invalid_url", "credentials in URL are not allowed");
  if (u.port && u.port !== "443") throw new BridgeError("invalid_url", "custom ports are not allowed");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || isIpLiteral(h))
    throw new BridgeError("blocked_host", "local, private and IP-literal hosts are blocked");
  if (!hostAllowed(h, hosts)) throw new BridgeError("host_not_allowed", "host is not on the approved source list: " + h);
  return u;
}

// Query strings are stripped from trace entries on purpose (they can carry invite codes / tokens).
function traceUrl(u) { try { const x = new URL(u); return x.hostname + x.pathname; } catch { return "?"; } }

async function guardedFetch(rawUrl, init, hosts, timeoutMs = TIMEOUT_MS, maxRedirects = MAX_REDIRECTS, trace = null) {
  let url = validateUrl(rawUrl, hosts).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    trace?.push(res.status + " " + traceUrl(url));
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop === maxRedirects) throw new BridgeError("too_many_redirects", "redirect limit exceeded" + (trace ? " via " + trace.join(" > ") : ""));
      const next = new URL(res.headers.get("location"), url).toString();
      url = validateUrl(next, hosts).toString();   // every hop re-validated
      continue;
    }
    return { res, finalHost: new URL(url).hostname, finalUrl: url };
  }
  throw new BridgeError("too_many_redirects", "redirect limit exceeded");
}

// ---------- helpers ----------
function toB64(u8) {
  let s = ""; const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
  return btoa(s);
}
async function sha256Hex(u8) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const stripHtml = s => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const clampInt = (v, d, lo, hi) => { v = Number.isFinite(+v) ? Math.floor(+v) : d; return Math.max(lo, Math.min(hi, v)); };

function sniff(u8) {
  for (const [name, sig] of SIGNATURES) if (sig.every((b, i) => u8[i] === b)) return name;
  if (u8.length >= 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return "mp4/mov";
  if (u8.length >= 12 && String.fromCharCode(...u8.subarray(0, 4)) === "RIFF" && String.fromCharCode(...u8.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

let bucket = { t: 0, n: 0 };
function rateLimited(env) {
  const limit = Number(env?.RATE_LIMIT_PER_MIN) || RATE_LIMIT_PER_MIN;
  const m = Math.floor(Date.now() / 60000);
  if (bucket.t !== m) bucket = { t: m, n: 0 };
  return ++bucket.n > limit;
}

function assessCommonsLicense(meta = {}) {
  const v = k => stripHtml(meta[k]?.value);
  const short = v("LicenseShortName"), lower = short.toLowerCase();
  let status = "unclear";
  if (/^(public domain|pd[- ]|pd$|cc0)/.test(lower)) status = "clear_public_domain";
  else if (/^cc[- ]by(-sa)?[- ]\d/.test(lower)) status = "clear_attribution_required";
  return {
    status, license: short || null, license_url: v("LicenseUrl") || null,
    attribution_required: status === "clear_attribution_required" || v("AttributionRequired").toLowerCase() === "true",
    share_alike: /-sa\b/.test(lower), artist: v("Artist") || null, credit: v("Credit") || null,
    note: status === "unclear" ? "License could not be confirmed automatically. Do not use without manual review." : undefined,
  };
}

// ---------- tools ----------
const TOOLS = [
  { name: "hello", description: "Connectivity test. Input: none. Output: a fixed text string.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "search_commons", description: "Search Wikimedia Commons files. Output: JSON list (title, page_url, direct file url, mime, size, dimensions, license assessment). Limit 1-20 results. Licenses are assessed, NOT guaranteed: status 'unclear' means manual review is required.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200 }, media: { type: "string", enum: ["image", "video", "any"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false } },
  { name: "commons_info", description: "Full metadata and license assessment for one Commons file title (e.g. 'File:Example.webm'). Output: JSON. Fails with not_found if the title does not exist.",
    inputSchema: { type: "object", properties: { title: { type: "string", maxLength: 300 } }, required: ["title"], additionalProperties: false } },
  { name: "search_archive", description: "Search Internet Archive items by text. Output: identifier, title, creator, year, license url, rights. Availability does NOT imply commercial reuse clearance; check license fields.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200 }, mediatype: { type: "string", enum: ["movies", "image"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false } },
  { name: "archive_files", description: "List media files of one Internet Archive item with format, size in bytes, duration in seconds (when known), direct download url, and license/rights fields. Use before choosing which derivative to retrieve.",
    inputSchema: { type: "object", properties: { identifier: { type: "string", pattern: "^[A-Za-z0-9._-]{1,100}$" } }, required: ["identifier"], additionalProperties: false } },
  { name: "search_pexels", description: "Search Pexels photos or videos (official API). Requires the PEXELS_API_KEY secret; returns error 'not_configured' otherwise. Output: ids, page urls, photographer, file urls, durations.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200 }, media: { type: "string", enum: ["image", "video"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false } },
  { name: "search_pixabay", description: "Search Pixabay images or videos (official API). Requires the PIXABAY_API_KEY secret; returns 'not_configured' otherwise. Output: ids, page urls, user, file urls.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200 }, media: { type: "string", enum: ["image", "video"] }, limit: { type: "integer", minimum: 3, maximum: 20 } }, required: ["query"], additionalProperties: false } },
  { name: "probe_media", description: "Inspect a media URL on an approved host WITHOUT downloading it: content type, total size in bytes, whether byte ranges are supported. Refuses files over 250 MB. Fails with host_not_allowed, blocked_host, range_unsupported, too_large.",
    inputSchema: { type: "object", properties: { url: { type: "string", maxLength: 1000 } }, required: ["url"], additionalProperties: false } },
  { name: "fetch_chunk", description: "Return one byte range of an approved media file as base64 with a per-chunk SHA-256. Stateless: re-request any offset to recover a lost chunk. Default chunk 65536 bytes, max 98304. The offset-0 chunk is validated against file signatures (jpeg, png, gif, webp, mp4/mov, webm/mkv, ogg). Output JSON: transfer_id, offset, length, total_size, chunk_index, chunk_count, sha256, mime, b64, done. Only suitable for tiny files: every byte passes through the chat context. For real files use relay_media.",
    inputSchema: { type: "object", properties: { url: { type: "string", maxLength: 1000 }, offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: CHUNK_MAX } }, required: ["url", "offset"], additionalProperties: false } },
  { name: "relay_media", description: "Copy an approved media file (up to 100 MB) to a temporary GitHub Release asset so the sandbox can download it from github.com. For Pinterest, pass the video.url returned by resolve_pinterest. Requires GITHUB_TOKEN and GITHUB_REPO secrets. Output JSON: download_url, asset_id, size, sha256. After downloading and verifying, call relay_cleanup with asset_id.",
    inputSchema: { type: "object", properties: { src: { type: "string", maxLength: 1000 }, name: { type: "string", pattern: "^[A-Za-z0-9._-]{1,100}$" } }, required: ["src", "name"], additionalProperties: false } },
  { name: "relay_cleanup", description: "Delete a temporary relay asset by asset_id once it has been downloaded.",
    inputSchema: { type: "object", properties: { asset_id: { type: "integer", minimum: 1 } }, required: ["asset_id"], additionalProperties: false } },
  { name: "resolve_pinterest", description: "Resolve a Pinterest pin (pin.it short link or pinterest.com/pin/<id> URL) to its direct video file. Follows redirects with every hop validated against an allowlist. Output JSON: pin_id, pin_url, title, description, duration_seconds, width, height, thumbnail_url, video {url, variant, size_bytes, content_type, relay_eligible}, alternatives, next_step. Pass video.url to relay_media to download. Errors: pin_not_found, pin_unavailable (private/blocked), no_video, unsupported_url (message names where the redirect ended and the hop chain), unsupported_video_format, unsupported_media_host, video_unavailable, host_not_allowed, blocked_host, too_many_redirects.",
    inputSchema: { type: "object", properties: { url: { type: "string", maxLength: 1000 } }, required: ["url"], additionalProperties: false } },
  { name: "generate_image", description: "Generate an image from a text prompt with the Hugging Face Space mcp-tools/Z-Image-Turbo (free; may queue for up to a couple of minutes). Output JSON: image_url (temporary link on the Space), seed_info, and, when the GitHub relay is configured and relay is true, relay {download_url, asset_id, size, sha256}: download it from github.com, verify, then call relay_cleanup with asset_id. Errors: invalid_input, space_unavailable, quota_or_queue_error, generation_failed, not_configured (only for the relay).",
    inputSchema: { type: "object", properties: { prompt: { type: "string", minLength: 1, maxLength: 2000 }, resolution: { type: "string", enum: GEN_RESOLUTIONS }, seed: { type: "integer", minimum: 0, maximum: 2147483647 }, shift: { type: "number", minimum: 1, maximum: 10 }, relay: { type: "boolean" } }, required: ["prompt"], additionalProperties: false } },
];

async function apiJson(url, headers = {}) {
  const { res } = await guardedFetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } }, API_HOSTS);
  if (res.status === 429) throw new BridgeError("rate_limited", "provider rate limit reached");
  if (!res.ok) throw new BridgeError("upstream_error", "provider returned HTTP " + res.status);
  return res.json();
}

async function searchCommons({ query, media = "any", limit = 8 }) {
  const ft = media === "video" ? " filetype:video" : media === "image" ? " filetype:bitmap" : "";
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  const p = { action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrsearch: query + ft, gsrlimit: String(clampInt(limit, 8, 1, 20)), prop: "imageinfo", iiprop: "url|size|mime|mediatype|extmetadata", iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired|Copyrighted|ObjectName", iiurlwidth: "640" };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  const d = await apiJson(u.toString());
  const pages = Object.values(d?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return { source: "wikimedia_commons", results: pages.map(pg => { const i = pg.imageinfo?.[0] ?? {};
    return { title: pg.title, page_url: i.descriptionurl, file_url: i.url, thumb_url: i.thumburl, mime: i.mime, mediatype: i.mediatype, size_bytes: i.size, width: i.width, height: i.height, license: assessCommonsLicense(i.extmetadata) }; }) };
}

async function commonsInfo({ title }) {
  if (!/^File:/i.test(title)) throw new BridgeError("invalid_input", "title must start with 'File:'");
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", titles: title, prop: "imageinfo", iiprop: "url|size|mime|mediatype|extmetadata|timestamp" })) u.searchParams.set(k, v);
  const d = await apiJson(u.toString());
  const pg = Object.values(d?.query?.pages ?? {})[0];
  if (!pg || pg.missing !== undefined || !pg.imageinfo) throw new BridgeError("not_found", "file not found on Commons");
  const i = pg.imageinfo[0];
  return { title: pg.title, page_url: i.descriptionurl, file_url: i.url, mime: i.mime, size_bytes: i.size, width: i.width, height: i.height, timestamp: i.timestamp, license: assessCommonsLicense(i.extmetadata) };
}

async function searchArchive({ query, mediatype = "movies", limit = 8 }) {
  const u = new URL("https://archive.org/advancedsearch.php");
  u.searchParams.set("q", `(${query}) AND mediatype:(${mediatype})`);
  for (const f of ["identifier", "title", "creator", "year", "licenseurl", "rights", "downloads"]) u.searchParams.append("fl[]", f);
  u.searchParams.set("rows", String(clampInt(limit, 8, 1, 20))); u.searchParams.set("output", "json");
  const d = await apiJson(u.toString());
  return { source: "internet_archive", results: (d?.response?.docs ?? []).map(x => ({ identifier: x.identifier, title: x.title, creator: x.creator, year: x.year, license_url: x.licenseurl ?? null, rights: x.rights ?? null, downloads: x.downloads, item_url: "https://archive.org/details/" + x.identifier })) };
}

async function archiveFiles({ identifier }) {
  const d = await apiJson("https://archive.org/metadata/" + encodeURIComponent(identifier));
  if (!d?.files) throw new BridgeError("not_found", "item not found or has no files");
  const m = d.metadata ?? {};
  const keep = /\.(mp4|mpeg|mpg|ogv|webm|mov|avi|jpe?g|png|gif)$/i;
  return { identifier, title: m.title, creator: m.creator, license_url: m.licenseurl ?? null, rights: m.rights ?? null, possible_copyright_status: m["possible-copyright-status"] ?? null,
    note: "Archive availability does not imply commercial reuse clearance. Check license/rights fields.",
    files: d.files.filter(f => keep.test(f.name)).slice(0, 60).map(f => ({ name: f.name, format: f.format, source: f.source, size_bytes: +f.size || null, duration_seconds: f.length ? +f.length : null, width: f.width ? +f.width : null, height: f.height ? +f.height : null,
      download_url: `https://archive.org/download/${encodeURIComponent(identifier)}/${f.name.split("/").map(encodeURIComponent).join("/")}` })) };
}

async function searchPexels(env, { query, media = "image", limit = 8 }) {
  if (!env.PEXELS_API_KEY) throw new BridgeError("not_configured", "PEXELS_API_KEY secret is not set");
  const base = media === "video" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
  const u = new URL(base); u.searchParams.set("query", query); u.searchParams.set("per_page", String(clampInt(limit, 8, 1, 20)));
  const d = await apiJson(u.toString(), { Authorization: env.PEXELS_API_KEY });
  if (media === "video") return { source: "pexels", credit_note: "Credit Pexels and the videographer.", results: (d.videos ?? []).map(v => ({ id: v.id, page_url: v.url, creator: v.user?.name, duration_seconds: v.duration, width: v.width, height: v.height, files: (v.video_files ?? []).map(f => ({ quality: f.quality, width: f.width, height: f.height, file_type: f.file_type, url: f.link })) })) };
  return { source: "pexels", credit_note: "Credit Pexels and the photographer.", results: (d.photos ?? []).map(p => ({ id: p.id, page_url: p.url, creator: p.photographer, width: p.width, height: p.height, alt: p.alt, files: { original: p.src?.original, large2x: p.src?.large2x, large: p.src?.large } })) };
}

async function searchPixabay(env, { query, media = "image", limit = 8 }) {
  if (!env.PIXABAY_API_KEY) throw new BridgeError("not_configured", "PIXABAY_API_KEY secret is not set");
  const u = new URL(media === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/");
  u.searchParams.set("key", env.PIXABAY_API_KEY); u.searchParams.set("q", query); u.searchParams.set("per_page", String(clampInt(limit, 8, 3, 20)));
  const d = await apiJson(u.toString());
  return { source: "pixabay", note: "Pixabay Content License. Download files; do not hotlink.", results: (d.hits ?? []).map(h => media === "video"
    ? { id: h.id, page_url: h.pageURL, user: h.user, duration_seconds: h.duration, files: Object.fromEntries(Object.entries(h.videos ?? {}).map(([k, v]) => [k, { width: v.width, height: v.height, size_bytes: v.size, url: v.url }])) }
    : { id: h.id, page_url: h.pageURL, user: h.user, width: h.imageWidth, height: h.imageHeight, files: { web: h.webformatURL, large: h.largeImageURL } }) };
}

function parseTotal(res) {
  const cr = res.headers.get("content-range"); // "bytes 0-0/12345"
  if (cr) { const m = /\/(\d+)$/.exec(cr); if (m) return +m[1]; }
  const cl = res.headers.get("content-length");
  return res.status === 200 && cl ? +cl : null;
}

async function probeMedia({ url }) {
  const { res, finalHost } = await guardedFetch(url, { headers: { "User-Agent": UA, Range: "bytes=0-0" } }, MEDIA_HOSTS);
  if (res.status === 404 || res.status === 410) { res.body?.cancel(); throw new BridgeError("not_found", "media not found"); }
  if (res.status !== 206 && res.status !== 200) { res.body?.cancel(); throw new BridgeError("upstream_error", "HTTP " + res.status); }
  const total = parseTotal(res), partial = res.status === 206;
  res.body?.cancel();
  if (total == null) throw new BridgeError("range_unsupported", "server did not report a file size");
  if (total > MAX_FILE_BYTES) throw new BridgeError("too_large", `file is ${total} bytes; limit is ${MAX_FILE_BYTES}`);
  if (!partial && total > CHUNK_MAX) throw new BridgeError("range_unsupported", "server ignores byte ranges and file is larger than one chunk");
  return { final_host: finalHost, content_type: res.headers.get("content-type"), total_size: total, accepts_ranges: partial, etag: res.headers.get("etag"), last_modified: res.headers.get("last-modified"), recommended_chunk_size: CHUNK_DEFAULT, chunk_count: Math.ceil(total / CHUNK_DEFAULT) };
}

async function readLimited(res, max) {
  const reader = res.body.getReader(); const parts = []; let n = 0;
  while (n < max) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  try { await reader.cancel(); } catch {}
  const out = new Uint8Array(Math.min(n, max)); let o = 0;
  for (const p of parts) { const take = Math.min(p.length, out.length - o); out.set(p.subarray(0, take), o); o += take; if (o >= out.length) break; }
  return out;
}

async function fetchChunk({ url, offset, length }) {
  length = clampInt(length, CHUNK_DEFAULT, 1, CHUNK_MAX); offset = clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const { res } = await guardedFetch(url, { headers: { "User-Agent": UA, Range: `bytes=${offset}-${offset + length - 1}` } }, MEDIA_HOSTS);
  if (res.status === 404 || res.status === 410) { res.body?.cancel(); throw new BridgeError("not_found", "media not found"); }
  if (res.status === 416) { res.body?.cancel(); throw new BridgeError("offset_out_of_range", "offset is beyond end of file"); }
  let total = parseTotal(res), bytes;
  if (res.status === 206) bytes = await readLimited(res, length);
  else if (res.status === 200) {
    if (total == null || total > CHUNK_MAX) { res.body?.cancel(); throw new BridgeError("range_unsupported", "server ignores byte ranges"); }
    const all = await readLimited(res, CHUNK_MAX); bytes = all.subarray(offset, offset + length);
  } else { res.body?.cancel(); throw new BridgeError("upstream_error", "HTTP " + res.status); }
  if (total != null && total > MAX_FILE_BYTES) throw new BridgeError("too_large", "file exceeds limit");
  if (offset === 0 && !sniff(bytes)) throw new BridgeError("unsupported_format", "file signature is not a supported image/video format");
  const ctype = res.headers.get("content-type") ?? "";
  if (!/^(image|video)\//i.test(ctype) && !/^application\/(octet-stream|ogg)/i.test(ctype)) throw new BridgeError("unsupported_format", "unexpected content type: " + ctype.slice(0, 60));
  const idBytes = new TextEncoder().encode(url);
  return { transfer_id: (await sha256Hex(idBytes)).slice(0, 16), offset, length: bytes.length, total_size: total, chunk_index: Math.floor(offset / CHUNK_DEFAULT), chunk_count: total ? Math.ceil(total / CHUNK_DEFAULT) : null,
    sha256: await sha256Hex(bytes), mime: ctype.split(";")[0], b64: toB64(bytes), done: total != null && offset + bytes.length >= total };
}

// ---------- Pinterest resolver (v2.2.0, hardened in v2.4.0) ----------
// Resolves a pin.it short link or a pinterest.com pin URL to a direct video file on an approved media host.
// Page fetching is restricted to RESOLVER_HOSTS; the returned media URL must pass MEDIA_HOSTS validation,
// so fetch_chunk / probe_media / relay_media can never be pointed at a Pinterest HTML page.
const PIN_ID_RE = /\/pin\/(?:[^/?#]*--)?(\d{5,25})(?:[/?#]|$)/;
const VIDEO_URL_RE = /\.(mp4|mov|webm)(?:[?#].*)?$/i;   // progressive files only; HLS/DASH manifests are excluded
const NEXT_PARAMS = ["next", "return_to", "redirect_uri", "continue", "url"];

function metaContent(html, prop) {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*?content=["']([^"']*)["']`, "i").exec(html)
    || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${p}["']`, "i").exec(html);
  return m ? stripHtml(m[1]) : null;
}

// Pin id from a URL path, or from a login/consent wrapper such as /login/?next=%2Fpin%2F123%2F (parsed only, never fetched).
function pinIdFromUrl(raw, depth = 0) {
  let u; try { u = new URL(raw); } catch { return null; }
  const m = PIN_ID_RE.exec(u.pathname);
  if (m) return m[1];
  if (depth < 2) for (const k of NEXT_PARAMS) {
    const v = u.searchParams.get(k);
    if (v) { const id = pinIdFromUrl(v.startsWith("/") ? "https://www.pinterest.com" + v : v, depth + 1); if (id) return id; }
  }
  return null;
}

function canonicalHref(html) {
  const m = /<link[^>]+rel=["']canonical["'][^>]*?href=["']([^"']*)["']/i.exec(html)
    || /<link[^>]+href=["']([^"']*)["'][^>]*?rel=["']canonical["']/i.exec(html);
  return m ? m[1] : null;
}

// Pin id declared by the page itself (canonical / og:url / app links). Only the page's OWN identity tags are used, never a
// scan of the body, so related or recommended pins cannot be mistaken for the requested one. Ambiguous -> null.
function pinIdFromHtml(html) {
  const ids = new Set();
  for (const raw of [canonicalHref(html), metaContent(html, "og:url"), metaContent(html, "al:ios:url"), metaContent(html, "al:android:url")]) {
    if (!raw) continue;
    const m = /pin\/(?:[^/?#]*--)?(\d{5,25})/.exec(raw);
    if (m) ids.add(m[1]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

function describeNonPin(finalUrl, trace) {
  let kind = "other page", where = "?";
  try {
    const u = new URL(finalUrl); where = u.hostname + u.pathname;
    const seg = u.pathname.split("/").filter(Boolean);
    if (/^(login|signup|auth)/i.test(seg[0] || "")) kind = "login/consent wall";
    else if (/^(search|ideas|topics)$/i.test(seg[0] || "")) kind = "search/ideas page";
    else if (seg.length === 1) kind = "profile";
    else if (seg.length >= 2) kind = "board or board section";
  } catch {}
  return `redirect chain ended at ${where} (${kind}), which has no /pin/<id>. Chain: ${trace.join(" > ")}. Boards, profiles and search pages are not supported.`;
}

function jsonScriptBlocks(html) {
  const out = [], re = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 20) { try { out.push(JSON.parse(m[1])); } catch { /* truncated or not JSON */ } }
  return out;
}

// A pin-like object that is NOT the requested pin (e.g. a related/recommended pin) must never contribute a video.
function isOtherPin(node, pinId) {
  return node && typeof node === "object" && !Array.isArray(node) && node.id !== undefined && String(node.id) !== pinId &&
    (node.type === "pin" || node.videos !== undefined || node.images !== undefined || node.story_pin_data !== undefined);
}

function findVideoList(root, pinId) {
  const stack = [root]; let seen = 0;
  while (stack.length && seen++ < 50000) {
    const n = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (!Array.isArray(n) && n.video_list && typeof n.video_list === "object") return n.video_list;
    for (const v of Array.isArray(n) ? n : Object.values(n)) if (v && typeof v === "object" && !isOtherPin(v, pinId)) stack.push(v);
  }
  return null;
}

function locatePin(blocks, pinId) {
  let fallback = null;
  for (const root of blocks) {
    const stack = [root]; let seen = 0;
    while (stack.length && seen++ < 300000) {
      const n = stack.pop();
      if (!n || typeof n !== "object") continue;
      if (!Array.isArray(n) && String(n.id) === pinId) {
        const videoList = findVideoList(n, pinId);
        if (videoList) return { pin: n, videoList };
        if (!fallback) fallback = n;
      }
      for (const v of Array.isArray(n) ? n : Object.values(n)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return { pin: fallback, videoList: null };
}

function safeMediaUrl(u) {
  if (typeof u !== "string") return null;
  try { return validateUrl(u, MEDIA_HOSTS).toString(); } catch { return null; }
}

// Highest resolution first. Non-progressive formats (m3u8, etc.) are dropped.
function rankVariants(videoList) {
  const items = [];
  for (const [key, v] of Object.entries(videoList || {})) {
    if (!v || typeof v.url !== "string" || !VIDEO_URL_RE.test(v.url)) continue;
    items.push({ key, url: v.url, width: +v.width || null, height: +v.height || null, duration_raw: +v.duration || null, thumbnail: typeof v.thumbnail === "string" ? v.thumbnail : null });
  }
  return items.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) || a.key.localeCompare(b.key));
}

function firstText(...vals) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return stripHtml(v).slice(0, 300);
  return null;
}

// Fetches the page behind a pin.it / pinterest.com URL and works out which pin it is. Throws a descriptive unsupported_url
// (with the redirect chain) when the link does not lead to a single pin.
async function fetchPinPage(env, start) {
  const ua = env?.PINTEREST_USER_AGENT || UA, trace = [];
  const { res, finalUrl } = await guardedFetch(start.toString(),
    { headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" } },
    RESOLVER_HOSTS, TIMEOUT_MS, RESOLVER_MAX_REDIRECTS, trace);
  const drop = () => { try { res.body?.cancel(); } catch {} };
  if (res.status === 404 || res.status === 410) { drop(); throw new BridgeError("pin_not_found", "pin not found or deleted"); }
  if (res.status === 401 || res.status === 403) { drop(); throw new BridgeError("pin_unavailable", "pin is private, restricted, or blocked the request (HTTP " + res.status + ")"); }
  if (res.status === 429) { drop(); throw new BridgeError("rate_limited", "Pinterest rate limit reached"); }
  if (!res.ok) { drop(); throw new BridgeError("upstream_error", "Pinterest returned HTTP " + res.status); }
  if (!/^text\/html/i.test(res.headers.get("content-type") ?? "")) { drop(); throw new BridgeError("unsupported_page", "Pinterest did not return an HTML page"); }

  let pinId = pinIdFromUrl(finalUrl);                       // 1) path, or a login wrapper's next= param
  const html = new TextDecoder().decode(await readLimited(res, PIN_HTML_MAX));
  if (!pinId) pinId = pinIdFromHtml(html);                  // 2) the page's own canonical / og:url / app link
  if (!pinId) throw new BridgeError("unsupported_url", describeNonPin(finalUrl, trace));
  return { pinId, html };
}

async function resolvePinterest(env, { url }) {
  const start = validateUrl(url, RESOLVER_HOSTS);
  const { pinId, html } = await fetchPinPage(env, start);
  const { pin, videoList } = locatePin(jsonScriptBlocks(html), pinId);
  const ogVideo = metaContent(html, "og:video:secure_url") || metaContent(html, "og:video:url") || metaContent(html, "og:video");
  const ogTitle = metaContent(html, "og:title"), ogImage = metaContent(html, "og:image");

  let variants = rankVariants(videoList);
  if (!variants.length && ogVideo && VIDEO_URL_RE.test(ogVideo)) {
    variants = [{ key: "og:video", url: ogVideo, width: +metaContent(html, "og:video:width") || null, height: +metaContent(html, "og:video:height") || null, duration_raw: null, thumbnail: null }];
  }
  if (!pin && !variants.length && !ogTitle) throw new BridgeError("pin_unavailable", "no pin data found in the page: the pin may be private, deleted or region-restricted, or Pinterest changed its page layout");
  if (!variants.length) {
    const hlsOnly = videoList && Object.values(videoList).some(v => v && typeof v.url === "string");
    throw new BridgeError(hlsOnly ? "unsupported_video_format" : "no_video", hlsOnly ? "pin only offers streaming manifests (HLS), which cannot be relayed" : "pin has no video (image pin, or unsupported pin type)");
  }

  let chosen = null, blockedHost = null;
  for (const v of variants) {
    const ok = safeMediaUrl(v.url);
    if (ok) { chosen = { ...v, url: ok }; break; }
    try { blockedHost = new URL(v.url).hostname; } catch {}
  }
  if (!chosen) throw new BridgeError("unsupported_media_host", "video is hosted on a host that is not approved" + (blockedHost ? ": " + blockedHost : ""));

  let probe = null, probeError = null;
  try { probe = await probeMedia({ url: chosen.url }); }
  catch (e) {
    if (e instanceof BridgeError && e.code === "not_found") throw new BridgeError("video_unavailable", "pin page exists but the video file is gone");
    probeError = e instanceof BridgeError ? e.code : "probe_failed";
  }
  const pinUrl = `https://www.pinterest.com/pin/${pinId}/`;
  return {
    source: "pinterest", pin_id: pinId, pin_url: pinUrl, requested_url: start.toString(),
    title: firstText(pin?.title, pin?.grid_title, pin?.seo_title, ogTitle),
    description: firstText(pin?.description, metaContent(html, "og:description")),
    duration_seconds: chosen.duration_raw ? chosen.duration_raw / 1000 : null,   // Pinterest reports milliseconds; verify with ffprobe
    duration_raw: chosen.duration_raw, width: chosen.width, height: chosen.height,
    thumbnail_url: safeMediaUrl(chosen.thumbnail) || safeMediaUrl(ogImage),
    video: { url: chosen.url, variant: chosen.key, size_bytes: probe?.total_size ?? null, content_type: probe?.content_type ?? null, accepts_ranges: probe?.accepts_ranges ?? null,
      relay_eligible: probe ? probe.total_size <= RELAY_MAX_BYTES : null, probe_error: probeError },
    alternatives: variants.filter(v => v.key !== chosen.key).map(v => ({ variant: v.key, width: v.width, height: v.height, url: safeMediaUrl(v.url) })),
    next_step: { tool: "relay_media", src: chosen.url, suggested_name: `pin_${pinId}.mp4` },
  };
}

// ---------- relay (GitHub Release asset) ----------
function relayConfig(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw new BridgeError("not_configured", "GITHUB_TOKEN and GITHUB_REPO secrets are not set");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO)) throw new BridgeError("invalid_config", "GITHUB_REPO must look like owner/repo");
  return { repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN };
}
const gh = (cfg, path, init = {}) => fetch("https://api.github.com" + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: {
  Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) } });

async function ensureRelease(cfg) {
  let r = await gh(cfg, `/repos/${cfg.repo}/releases/tags/${RELAY_TAG}`);
  if (r.status === 404) r = await gh(cfg, `/repos/${cfg.repo}/releases`, { method: "POST",
    body: JSON.stringify({ tag_name: RELAY_TAG, name: RELAY_TAG, body: "Temporary media relay. Assets are deleted after download.", prerelease: true }) });
  if (!r.ok) throw new BridgeError("github_error", "could not get or create the relay release (HTTP " + r.status + "); check GITHUB_TOKEN permissions and GITHUB_REPO");
  return r.json();
}

async function relayMedia(env, { src, name }) {
  const cfg = relayConfig(env);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name || "")) throw new BridgeError("invalid_input", "name must match [A-Za-z0-9._-]{1,100}");
  const { res } = await guardedFetch(src, { headers: { "User-Agent": UA } }, MEDIA_HOSTS, RELAY_TIMEOUT_MS);
  if (res.status === 404 || res.status === 410) { res.body?.cancel(); throw new BridgeError("not_found", "media not found"); }
  if (!res.ok || !res.body) { res.body?.cancel(); throw new BridgeError("upstream_error", "HTTP " + res.status); }
  const ctype = res.headers.get("content-type") ?? "";
  if (!/^(image|video)\//i.test(ctype) && !/^application\/(octet-stream|ogg)/i.test(ctype)) { res.body.cancel(); throw new BridgeError("unsupported_format", "unexpected content type: " + ctype.slice(0, 60)); }
  const len = Number(res.headers.get("content-length"));
  if (!len) { res.body.cancel(); throw new BridgeError("size_unknown", "source did not report a size"); }
  if (len > RELAY_MAX_BYTES) { res.body.cancel(); throw new BridgeError("too_large", `file is ${len} bytes; relay limit is ${RELAY_MAX_BYTES}`); }
  const rel = await ensureRelease(cfg);
  // replace an existing asset with the same name
  const la = await gh(cfg, `/repos/${cfg.repo}/releases/${rel.id}/assets?per_page=100`);
  if (la.ok) for (const a of await la.json()) if (a.name === name) await gh(cfg, `/repos/${cfg.repo}/releases/assets/${a.id}`, { method: "DELETE" });
  const [forUpload, forHash] = res.body.tee();
  const digest = new crypto.DigestStream("SHA-256");
  const hashDone = forHash.pipeTo(digest);
  const uploadBase = String(rel.upload_url).replace(/\{\?.*\}$/, "");
  const putP = fetch(uploadBase + "?name=" + encodeURIComponent(name), { method: "POST", body: forUpload.pipeThrough(new FixedLengthStream(len)),
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": ctype.split(";")[0] || "application/octet-stream", "Content-Length": String(len), "User-Agent": UA } });
  const [put] = await Promise.all([putP, hashDone]);
  if (put.status !== 201) throw new BridgeError("upload_failed", "GitHub upload returned HTTP " + put.status);
  const asset = await put.json();
  const sha = [...new Uint8Array(await digest.digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  return { asset_id: asset.id, size: asset.size, sha256: sha, content_type: ctype.split(";")[0],
    download_url: `https://github.com/${cfg.repo}/releases/download/${RELAY_TAG}/${name}`,
    note: "Download within minutes, verify size and sha256, then call relay_cleanup with asset_id." };
}

async function relayCleanup(env, { asset_id }) {
  const cfg = relayConfig(env);
  if (!Number.isInteger(asset_id) || asset_id < 1) throw new BridgeError("invalid_input", "asset_id must be a positive integer");
  const r = await gh(cfg, `/repos/${cfg.repo}/releases/assets/${asset_id}`, { method: "DELETE" });
  if (r.status !== 204 && r.status !== 404) throw new BridgeError("github_error", "delete returned HTTP " + r.status);
  return { deleted: r.status === 204, already_gone: r.status === 404 };
}

// ---------- image generation (v2.3.0) ----------
// Gradio "call" API of the Space: POST /gradio_api/call/generate -> {event_id}; GET .../generate/<event_id> -> SSE stream.
// Input order (from the Space's app.py click handler): [prompt, resolution, seed, steps, shift, random_seed].
function parseSse(text) {
  let ev = null, complete = null, error = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("event:")) ev = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      const d = line.slice(5).trim();
      if (ev === "complete") complete = d;
      else if (ev === "error") error = d;
    }
  }
  return { complete, error };
}

async function generateImage(env, { prompt, resolution = "1024x1024 ( 1:1 )", seed, shift = 3, relay = true }) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000) throw new BridgeError("invalid_input", "prompt must be a non-empty string of at most 2000 characters");
  if (!GEN_RESOLUTIONS.includes(resolution)) throw new BridgeError("invalid_input", "resolution must be one of the supported values listed in the tool schema");
  const randomSeed = !Number.isInteger(seed);
  const shiftVal = Math.max(1, Math.min(10, Number.isFinite(+shift) ? +shift : 3));
  const auth = env.HF_TOKEN ? { Authorization: "Bearer " + env.HF_TOKEN } : {};
  const data = [prompt.trim(), resolution, randomSeed ? 42 : seed, 8, shiftVal, randomSeed];

  const { res: start } = await guardedFetch(GEN_BASE + "/gradio_api/call/generate",
    { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json", ...auth }, body: JSON.stringify({ data }) }, GEN_HOSTS, TIMEOUT_MS);
  if (!start.ok) { start.body?.cancel(); throw new BridgeError("space_unavailable", "the Space returned HTTP " + start.status + " (it may be sleeping, restarting or over quota); try again shortly"); }
  const started = await start.json().catch(() => null);
  const eventId = started?.event_id;
  if (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{4,100}$/.test(eventId)) throw new BridgeError("space_unavailable", "the Space did not return a valid event_id");

  const { res: stream } = await guardedFetch(GEN_BASE + "/gradio_api/call/generate/" + eventId,
    { headers: { "User-Agent": UA, Accept: "text/event-stream", ...auth } }, GEN_HOSTS, GEN_TIMEOUT_MS);
  if (!stream.ok) { stream.body?.cancel(); throw new BridgeError("space_unavailable", "the Space returned HTTP " + stream.status + " while generating"); }
  const { complete, error } = parseSse(await stream.text());
  if (!complete) {
    const msg = (error && error !== "null" ? error : "no result returned").slice(0, 300);
    throw new BridgeError(/quota|queue|GPU|limit/i.test(msg) ? "quota_or_queue_error" : "generation_failed", msg);
  }
  let out;
  try { out = JSON.parse(complete); } catch { throw new BridgeError("generation_failed", "could not parse the Space response"); }
  const img = Array.isArray(out) ? out[0] : null;
  const rawUrl = img?.url || (img?.path ? GEN_BASE + "/gradio_api/file=" + img.path : null);
  if (!rawUrl) throw new BridgeError("generation_failed", "the Space returned no image");
  const imageUrl = validateUrl(rawUrl, GEN_HOSTS).toString();

  const result = { source: "z-image-turbo", prompt: prompt.trim(), resolution, seed_info: typeof out[1] === "string" ? out[1] : null, image_url: imageUrl,
    note: "image_url is temporary and lives on the Space; relay it (relay_media) or use the relay field if present." };
  if (relay && env.GITHUB_TOKEN && env.GITHUB_REPO) {
    const ext = (/\.(webp|png|jpe?g)(?:[?#]|$)/i.exec(new URL(imageUrl).pathname)?.[1] || "webp").toLowerCase();
    try { result.relay = await relayMedia(env, { src: imageUrl, name: `zimage_${Date.now()}.${ext}` }); }
    catch (e) { result.relay_error = e instanceof BridgeError ? { error: e.code, message: e.message } : { error: "internal_error" }; }
  } else if (relay) {
    result.next_step = { tool: "relay_media", src: imageUrl, suggested_name: "zimage.webp" };
  }
  return result;
}

async function callTool(env, name, a = {}) {
  switch (name) {
    case "hello": return "media-bridge MCP is working. Ready for media search integration.";
    case "search_commons": return searchCommons(a);
    case "commons_info": return commonsInfo(a);
    case "search_archive": return searchArchive(a);
    case "archive_files": return archiveFiles(a);
    case "search_pexels": return searchPexels(env, a);
    case "search_pixabay": return searchPixabay(env, a);
    case "probe_media": return probeMedia(a);
    case "fetch_chunk": return fetchChunk(a);
    case "relay_media": return relayMedia(env, a);
    case "relay_cleanup": return relayCleanup(env, a);
    case "resolve_pinterest": return resolvePinterest(env, a);
    case "generate_image": return generateImage(env, a);
    default: throw new BridgeError("unknown_tool", "Unknown tool");
  }
}

// ---------- MCP / HTTP ----------
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

async function handleRpc(env, body) {
  const id = body.id ?? null;
  const ok = result => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (body.method) {
    case "initialize": return ok({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "media-bridge", version: VERSION } });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    case "tools/call": {
      if (rateLimited(env)) return ok({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: "rate_limited", message: "too many calls this minute" }) }] });
      try {
        const out = await callTool(env, body.params?.name, body.params?.arguments);
        return ok({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] });
      } catch (e) {
        const code = e instanceof BridgeError ? e.code : "internal_error";
        const message = e instanceof BridgeError ? e.message : "unexpected failure";
        return ok({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: code, message }) }] });
      }
    }
    default: return err(-32601, "Method not found");
  }
}

// Exposed for tests only (not reachable through the MCP endpoint).
export const __test = { VERSION, BridgeError, guardedFetch, resolvePinterest, pinIdFromUrl, pinIdFromHtml, describeNonPin, validateUrl };

export default {
  async fetch(request, env) {
    // Fail closed: no token configured -> nothing is served.
    const token = env?.ACCESS_TOKEN;
    if (!token || token.length < 24) return J({ error: "not_configured" }, 503);
    const path = new URL(request.url).pathname;
    // Anything but the exact secret path looks like a plain 404 (do not reveal the endpoint).
    if (!ctEqual(path, `/${token}/mcp`)) return J({ error: "not_found" }, 404);
    if (request.method === "GET") return J({ name: "media-bridge", version: VERSION, status: "ready" });
    if (request.method !== "POST") return J({ error: "method_not_allowed" }, 405);
    let body;
    try { body = await request.json(); } catch { return J({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }, 400); }
    if (Array.isArray(body)) { const out = (await Promise.all(body.map(b => b.id === undefined ? null : handleRpc(env, b)))).filter(Boolean); return out.length ? J(out) : new Response(null, { status: 202 }); }
    if (body.id === undefined || body.method?.startsWith("notifications/")) return new Response(null, { status: 202 });
    return J(await handleRpc(env, body));
  },
};
