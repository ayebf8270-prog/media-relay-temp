// Regression + behaviour tests for media-bridge v2.4.0. Offline: every network call is stubbed.
// Usage: NEW=/path/new.mjs OLD=/path/old.mjs node test.mjs
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const load = p => import(pathToFileURL(p).href);
const NEW = await load(process.env.NEW), OLD = await load(process.env.OLD);

// Cloudflare-only globals used by relay_media; minimal Node polyfills so the relay path can be tested.
globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
class DigestStream extends WritableStream {
  constructor(alg) { let res; const p = new Promise(r => { res = r; }); const chunks = [];
    super({ write(c) { chunks.push(Buffer.from(c)); }, async close() { res(await crypto.subtle.digest(alg, Buffer.concat(chunks))); } });
    this.digest = p; }
}
Object.defineProperty(globalThis.crypto, "DigestStream", { value: DigestStream, configurable: true });

const TOKEN = "t".repeat(32);
const env = { ACCESS_TOKEN: TOKEN, HF_TOKEN: "hf_test" };
const url = `https://w.example/${TOKEN}/mcp`;
const rpc = (mod, body, e = env) => mod.default.fetch(new Request(url, { method: "POST", body: JSON.stringify(body) }), e).then(r => r.json());
const callTool = async (mod, name, args, e = env) => (await rpc(mod, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, e)).result;
const textOf = r => r.content[0].text;
let passed = 0; const ok = n => { passed++; console.log("ok -", n); };
const realFetch = globalThis.fetch;
const noNetwork = () => { globalThis.fetch = async u => { throw new Error("unexpected network call: " + u); }; };

const OLD_NAMES = ["hello","search_commons","commons_info","search_archive","archive_files","search_pexels","search_pixabay","probe_media","fetch_chunk","relay_media","relay_cleanup","resolve_pinterest","generate_image"];

// ---- 1. existing tools are untouched ----
noNetwork();
const oldList = (await rpc(OLD, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
const newList = (await rpc(NEW, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
assert.deepEqual(oldList.map(t => t.name), OLD_NAMES); ok("previous worker (v2.3.0) exposes the 13 known tools");
assert.deepEqual(newList.map(t => t.name), OLD_NAMES); ok("new worker = the same 13 tools in the same order");
for (const t of oldList) assert.deepEqual(JSON.parse(JSON.stringify(newList.find(x => x.name === t.name))), JSON.parse(JSON.stringify(t)), "definition changed: " + t.name);
ok("every existing tool definition (name, description, input schema) is byte-for-byte equivalent");
const init = (await rpc(NEW, { jsonrpc: "2.0", id: 1, method: "initialize" })).result;
assert.equal(init.serverInfo.version, "2.4.0"); ok("initialize reports 2.4.0");
assert.equal(textOf(await callTool(NEW, "hello", {})), textOf(await callTool(OLD, "hello", {}))); ok("hello unchanged");

// ---- 2. access control and host allowlists behave identically for existing tools ----
for (const m of [OLD, NEW]) {
  assert.equal((await m.default.fetch(new Request("https://w.example/wrong/mcp", { method: "POST", body: "{}" }), env)).status, 404);
  assert.equal((await m.default.fetch(new Request(url, { method: "POST", body: "{}" }), { ACCESS_TOKEN: "short" })).status, 503);
}
ok("wrong path -> 404 and missing/short token -> 503 (fail closed), same as before");
const probe = async (m, u) => JSON.parse(textOf(await callTool(m, "probe_media", { url: u }))).error;
const cases = [
  ["https://evil.example.com/a.mp4", "host_not_allowed"], ["http://cdn.pixabay.com/a.mp4", "unsupported_protocol"],
  ["https://127.0.0.1/a.mp4", "blocked_host"], ["https://www.pinterest.com/pin/12345678/", "host_not_allowed"],
  ["https://evil-mcp-tools-z-image-turbo.hf.space/a.webp", "host_not_allowed"], ["https://mcp-tools-z-image-turbo.hf.space.evil.com/a.webp", "host_not_allowed"],
  ["https://user:pw@cdn.pixabay.com/a.mp4", "invalid_url"],
];
for (const [u, code] of cases) assert.equal(await probe(NEW, u), code, u);
for (const [u, code] of cases.slice(0, 5).filter(c => !c[0].includes("z-image"))) assert.equal(await probe(OLD, u), code, "old: " + u);
ok("host allowlist: look-alike hosts, http, IP literals, credentials and Pinterest pages are still rejected");

// ---- 3. generate_image ----
const bytes = Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 fake-image-bytes");
const sha = createHash("sha256").update(bytes).digest("hex");
const IMG = "https://mcp-tools-z-image-turbo.hf.space/gradio_api/file=/tmp/gradio/x/image.webp";
let log = [];
const stub = ({ sse, postStatus = 200 } = {}) => { log = []; globalThis.fetch = async (u, init = {}) => {
  u = String(u); const method = init.method || "GET"; log.push({ u, method, body: init.body, auth: init.headers?.Authorization });
  if (u.endsWith("/gradio_api/call/generate") && method === "POST") return postStatus === 200 ? new Response(JSON.stringify({ event_id: "evt_abc12345" })) : new Response("busy", { status: postStatus });
  if (u.endsWith("/gradio_api/call/generate/evt_abc12345")) return new Response(sse ?? `event: generating\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([{ path: "/tmp/gradio/x/image.webp", url: IMG }, "The seed used for generation was77"])}\n\n`);
  if (u === IMG) return new Response(bytes, { headers: { "content-type": "image/webp", "content-length": String(bytes.length) } });
  if (u.includes("/releases/tags/media-relay")) return Response.json({ id: 9, upload_url: "https://uploads.github.com/repos/o/r/releases/9/assets{?name,label}" });
  if (u.includes("/releases/9/assets?per_page")) return Response.json([]);
  if (u.startsWith("https://uploads.github.com/")) { await new Response(init.body).arrayBuffer(); return Response.json({ id: 555, size: bytes.length }, { status: 201 }); }
  throw new Error("unexpected network call: " + method + " " + u); }; };

stub();
let r = JSON.parse(textOf(await callTool(NEW, "generate_image", { prompt: "desert oasis at sunset", resolution: "1536x864 ( 16:9 )" })));
assert.deepEqual(JSON.parse(log[0].body).data, ["desert oasis at sunset", "1536x864 ( 16:9 )", 42, 8, 3, true]);
assert.equal(log[0].auth, "Bearer hf_test"); assert.equal(r.image_url, IMG); assert.match(r.seed_info, /77/); assert.equal(r.next_step.tool, "relay_media");
assert.ok(!log.some(c => c.u.includes("github.com")), "must not touch GitHub when relay is not configured");
ok("generate_image: correct Gradio payload order, HF token forwarded, image URL returned, no GitHub call when relay unconfigured");

stub();
r = JSON.parse(textOf(await callTool(NEW, "generate_image", { prompt: "x", seed: 123, shift: 4.5, relay: false })));
assert.deepEqual(JSON.parse(log[0].body).data.slice(2), [123, 8, 4.5, false]);
assert.equal(r.next_step, undefined); assert.equal(r.relay, undefined); ok("explicit seed disables random_seed; shift honoured; relay:false skips relay");

stub();
r = JSON.parse(textOf(await callTool(NEW, "generate_image", { prompt: "oasis" }, { ...env, GITHUB_TOKEN: "ghp_x", GITHUB_REPO: "o/r" })));
assert.match(r.relay.download_url, /^https:\/\/github\.com\/o\/r\/releases\/download\/media-relay\/zimage_\d+\.webp$/);
assert.equal(r.relay.asset_id, 555); assert.equal(r.relay.size, bytes.length); assert.equal(r.relay.sha256, sha);
ok("generate_image -> relay: image uploaded to the GitHub release, size and SHA-256 match the original bytes");

for (const [args, code] of [[{ prompt: "x", resolution: "1x1" }, "invalid_input"], [{ prompt: "" }, "invalid_input"], [{ prompt: "a".repeat(2001) }, "invalid_input"]]) {
  noNetwork(); assert.equal(JSON.parse(textOf(await callTool(NEW, "generate_image", args))).error, code);
}
ok("invalid prompt/resolution rejected before any network call");
stub({ sse: 'event: error\ndata: "You have exceeded your GPU quota"\n\n' });
assert.equal(JSON.parse(textOf(await callTool(NEW, "generate_image", { prompt: "x" }))).error, "quota_or_queue_error"); ok("ZeroGPU quota error is reported clearly");
stub({ postStatus: 503 });
assert.equal(JSON.parse(textOf(await callTool(NEW, "generate_image", { prompt: "x" }))).error, "space_unavailable"); ok("Space down/sleeping -> space_unavailable");
stub({ sse: `event: complete\ndata: ${JSON.stringify([{ url: "https://evil.example.com/x.webp" }, "s"])}\n\n` });
assert.equal(JSON.parse(textOf(await callTool(NEW, "generate_image", { prompt: "x" }))).error, "host_not_allowed"); ok("a result URL on an unapproved host is refused");


// ---- 4. v2.4.0: Pinterest resolver hardening (all through the public MCP tool; Pinterest and the CDN are stubbed) ----
const PIN = "1086986060093505821", VID = "https://v1.pinimg.com/videos/iht/expMp4/6f/e6/b3/abc_720w.mp4";
const page = (id, other = "") => `<html><head><meta property="og:title" content="A pin"><link rel="canonical" href="https://www.pinterest.com/pin/${id}/"></head><body><script type="application/json">${JSON.stringify({ pins: { ...(other ? { [other]: { id: other, type: "pin", videos: { video_list: { V_720P: { url: "https://v1.pinimg.com/other.mp4", width: 720, height: 1280 } } } } } : {}), [id]: { id, type: "pin", title: "A pin", videos: { video_list: { V_720P: { url: VID, width: 720, height: 1280, duration: 42167 }, V_HLS: { url: "https://v1.pinimg.com/x.m3u8" } } } } } })}</script></body></html>`;
const net = routes => { globalThis.fetch = async u => { const r = routes[String(u)]; if (!r) throw new Error("unexpected network call: " + u);
  return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? { "content-type": "text/html" } }); }; };
const redir = to => ({ status: 302, headers: { location: to } });
const probeOk = { [VID]: { status: 206, body: "x", headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/10930658" } } };
const resolve = async (m, u) => { const r = await callTool(m, "resolve_pinterest", { url: u }); return r.isError ? { error: JSON.parse(textOf(r)) } : JSON.parse(textOf(r)); };

net({ "https://pin.it/ok": redir(`https://www.pinterest.com/pin/${PIN}/sent/?invite_code=a`), [`https://www.pinterest.com/pin/${PIN}/sent/?invite_code=a`]: { body: page(PIN) }, ...probeOk });
for (const m of [OLD, NEW]) { const r = await resolve(m, "https://pin.it/ok"); assert.equal(r.pin_id, PIN); assert.equal(r.video.url, VID); assert.equal(r.duration_seconds, 42.167); assert.equal(r.video.size_bytes, 10930658); }
ok("REGRESSION: the pin.it -> /pin/<id>/sent/ shape resolves identically on the previous and the new worker");

net({ "https://pin.it/c": redir("https://www.pinterest.com/some/thing/"), "https://www.pinterest.com/some/thing/": { body: page(PIN) }, ...probeOk });
assert.equal((await resolve(OLD, "https://pin.it/c")).error?.error, "unsupported_url");
assert.equal((await resolve(NEW, "https://pin.it/c")).pin_id, PIN);
ok("NEW: non-pin final URL whose page canonical names exactly one pin now resolves (previously unsupported_url)");

const wall = `https://www.pinterest.com/login/?next=%2Fpin%2F${PIN}%2F`;
net({ "https://pin.it/l": redir(wall), [wall]: { body: page(PIN) }, ...probeOk });
assert.equal((await resolve(NEW, "https://pin.it/l")).pin_id, PIN); ok("NEW: login wall wrapping the pin in ?next= is unwrapped");

net({ "https://pin.it/b": redir("https://www.pinterest.com/someuser/myboard/?invite_code=SECRET"), "https://www.pinterest.com/someuser/myboard/?invite_code=SECRET": { body: "<html>board</html>" } });
let e = (await resolve(NEW, "https://pin.it/b")).error;
assert.equal(e.error, "unsupported_url"); assert.match(e.message, /www\.pinterest\.com\/someuser\/myboard\/ \(board or board section\)/);
assert.match(e.message, /302 pin\.it\/b > 200 www\.pinterest\.com\/someuser\/myboard\//); assert.ok(!e.message.includes("SECRET"));
ok("NEW: a board link still fails, but the error names the destination and hop chain (query string stripped)");

net({ [`https://www.pinterest.com/pin/${PIN}/`]: { body: page(PIN, "999999999999") }, ...probeOk });
assert.equal((await resolve(NEW, `https://www.pinterest.com/pin/${PIN}/`)).video.url, VID); ok("SAFETY: a related pin's video never replaces the requested pin's video");
net({ "https://pin.it/e": redir("https://evil.example/pin/123456789012/") });
assert.equal((await resolve(NEW, "https://pin.it/e")).error.error, "host_not_allowed"); assert.equal((await resolve(NEW, "http://pin.it/e")).error.error, "unsupported_protocol");
ok("SAFETY: off-allowlist redirects and http are still refused");
net({ [`https://www.pinterest.com/pin/${PIN}/`]: { status: 403 } }); assert.equal((await resolve(NEW, `https://www.pinterest.com/pin/${PIN}/`)).error.error, "pin_unavailable");
net({ [`https://www.pinterest.com/pin/${PIN}/`]: { status: 404 } }); assert.equal((await resolve(NEW, `https://www.pinterest.com/pin/${PIN}/`)).error.error, "pin_not_found");
ok("error mapping unchanged: 403 -> pin_unavailable, 404 -> pin_not_found");

globalThis.fetch = realFetch;
console.log(`\nALL ${passed} TESTS PASSED`);
