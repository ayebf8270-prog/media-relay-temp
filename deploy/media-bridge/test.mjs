// Regression + behaviour tests for media-bridge v2.3.0. Offline: every network call is stubbed.
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

const OLD_NAMES = ["hello","search_commons","commons_info","search_archive","archive_files","search_pexels","search_pixabay","probe_media","fetch_chunk","relay_media","relay_cleanup","resolve_pinterest"];

// ---- 1. existing tools are untouched ----
noNetwork();
const oldList = (await rpc(OLD, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
const newList = (await rpc(NEW, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
assert.deepEqual(oldList.map(t => t.name), OLD_NAMES); ok("old worker exposes the 12 known tools");
assert.deepEqual(newList.map(t => t.name), [...OLD_NAMES, "generate_image"]); ok("new worker = same 12 tools in the same order + generate_image");
for (const t of oldList) assert.deepEqual(JSON.parse(JSON.stringify(newList.find(x => x.name === t.name))), JSON.parse(JSON.stringify(t)), "definition changed: " + t.name);
ok("every existing tool definition (name, description, input schema) is byte-for-byte equivalent");
const init = (await rpc(NEW, { jsonrpc: "2.0", id: 1, method: "initialize" })).result;
assert.equal(init.serverInfo.version, "2.3.0"); ok("initialize reports 2.3.0");
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

globalThis.fetch = realFetch;
console.log(`\nALL ${passed} TESTS PASSED`);
