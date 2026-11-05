import test from "node:test";
import assert from "node:assert/strict";
import { __test as W } from "../worker.js";

const { resolvePinterest, pinIdFromUrl, pinIdFromHtml, describeNonPin, BridgeError } = W;
const PIN = "1086986060093505821";
const VIDEO = "https://v1.pinimg.com/videos/iht/expMp4/6f/e6/b3/abc_720w.mp4";

const pinPage = (id, extra = "") => `<html><head><meta property="og:title" content="A pin"><link rel="canonical" href="https://www.pinterest.com/pin/${id}/"></head><body>
<script type="application/json">${JSON.stringify({ props: { initialReduxState: { pins: { [id]: { id, type: "pin", title: "A pin", videos: { video_list: {
  V_720P: { url: VIDEO, width: 720, height: 1280, duration: 42167 },
  V_HLSV3_MOBILE: { url: "https://v1.pinimg.com/videos/iht/hls/x.m3u8", width: 720, height: 1280, duration: 42167 } } } } } } } })}</script>${extra}</body></html>`;

function mockNetwork(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    const r = routes[url];
    if (!r) throw new Error("unexpected fetch: " + url);
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? { "content-type": "text/html" } });
  };
  return calls;
}
const redirect = to => ({ status: 302, headers: { location: to } });
const probeOk = { [VIDEO]: { status: 206, body: "x", headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/10930658" } } };
const code = async p => { try { await p; return null; } catch (e) { assert.ok(e instanceof BridgeError); return e; } };

test("version is 2.4.0", () => assert.equal(W.VERSION, "2.4.0"));

test("REGRESSION: pin.it -> /pin/<id>/sent/ resolves the 720p video (previously working link shape)", async () => {
  mockNetwork({ "https://pin.it/ok": redirect(`https://www.pinterest.com/pin/${PIN}/sent/?invite_code=abc`),
    [`https://www.pinterest.com/pin/${PIN}/sent/?invite_code=abc`]: { body: pinPage(PIN) }, ...probeOk });
  const r = await resolvePinterest({}, { url: "https://pin.it/ok" });
  assert.equal(r.pin_id, PIN); assert.equal(r.video.url, VIDEO); assert.equal(r.video.variant, "V_720P");
  assert.equal(r.duration_seconds, 42.167); assert.equal(r.video.size_bytes, 10930658); assert.equal(r.video.relay_eligible, true);
  assert.equal(r.next_step.suggested_name, `pin_${PIN}.mp4`);
});

test("direct pinterest.com/pin/<id> URL still works", async () => {
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { body: pinPage(PIN) }, ...probeOk });
  assert.equal((await resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` })).pin_id, PIN);
});

test("NEW: redirect ends on a non-pin URL but the page's canonical names one pin", async () => {
  mockNetwork({ "https://pin.it/c": redirect("https://www.pinterest.com/some/thing/"),
    "https://www.pinterest.com/some/thing/": { body: pinPage(PIN) }, ...probeOk });
  assert.equal((await resolvePinterest({}, { url: "https://pin.it/c" })).pin_id, PIN);
});

test("NEW: login wall wrapping the pin in ?next= is unwrapped", async () => {
  const wall = `https://www.pinterest.com/login/?next=%2Fpin%2F${PIN}%2F`;
  mockNetwork({ "https://pin.it/l": redirect(wall), [wall]: { body: pinPage(PIN) }, ...probeOk });
  assert.equal((await resolvePinterest({}, { url: "https://pin.it/l" })).pin_id, PIN);
});

test("NEW: board link -> unsupported_url that names the destination and hop chain, without the query string", async () => {
  mockNetwork({ "https://pin.it/b": redirect("https://www.pinterest.com/someuser/myboard/?invite_code=SECRET"),
    "https://www.pinterest.com/someuser/myboard/?invite_code=SECRET": { body: "<html>board</html>" } });
  const e = await code(resolvePinterest({}, { url: "https://pin.it/b" }));
  assert.equal(e.code, "unsupported_url");
  assert.match(e.message, /www\.pinterest\.com\/someuser\/myboard\/ \(board or board section\)/);
  assert.match(e.message, /302 pin\.it\/b > 200 www\.pinterest\.com\/someuser\/myboard\//);
  assert.doesNotMatch(e.message, /SECRET/);
});

test("NEW: profile and login destinations are classified", () => {
  assert.match(describeNonPin("https://www.pinterest.com/someuser/", []), /\(profile\)/);
  assert.match(describeNonPin("https://www.pinterest.com/login/", []), /login\/consent wall/);
  assert.match(describeNonPin("https://www.pinterest.com/search/pins/?q=x", []), /search\/ideas page/);
});

test("SAFETY: related/recommended pins in the body never supply the id or the video", async () => {
  assert.equal(pinIdFromHtml('<html><a href="/pin/333333333333/">related</a></html>'), null);
  const other = "999999999999";
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { body: pinPage(PIN).replace(`"pins":{"${PIN}"`, `"pins":{"${other}":{"id":"${other}","type":"pin","videos":{"video_list":{"V_720P":{"url":"https://v1.pinimg.com/other.mp4","width":720,"height":1280}}}},"${PIN}"`) }, ...probeOk });
  assert.equal((await resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` })).video.url, VIDEO);
});

test("SAFETY: conflicting identity tags are ambiguous, not guessed", () => {
  assert.equal(pinIdFromHtml('<link rel="canonical" href="https://x/pin/111111111111/"><meta property="og:url" content="https://x/pin/222222222222/">'), null);
});

test("SAFETY: redirects off the allowlist are blocked; http is refused; IDs under 5 digits are ignored", async () => {
  mockNetwork({ "https://pin.it/e": redirect("https://evil.example/pin/123456789012/") });
  assert.equal((await code(resolvePinterest({}, { url: "https://pin.it/e" }))).code, "host_not_allowed");
  assert.equal((await code(resolvePinterest({}, { url: "http://pin.it/e" }))).code, "unsupported_protocol");
  assert.equal(pinIdFromUrl("https://www.pinterest.com/pin/123/"), null);
});

test("redirect loops stop and report the chain", async () => {
  const routes = {}; for (let i = 0; i < 8; i++) routes[`https://pin.it/h${i}`] = redirect(`https://pin.it/h${i + 1}`);
  mockNetwork(routes);
  const e = await code(resolvePinterest({}, { url: "https://pin.it/h0" }));
  assert.equal(e.code, "too_many_redirects"); assert.match(e.message, /via 302 pin\.it\/h0/);
});

test("pin without video -> no_video; HLS-only -> unsupported_video_format; 404 -> pin_not_found; 403 -> pin_unavailable", async () => {
  const img = `<html><meta property="og:title" content="x"><script type="application/json">${JSON.stringify({ p: { id: PIN, type: "pin", images: {} } })}</script></html>`;
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { body: img } });
  assert.equal((await code(resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` }))).code, "no_video");
  const hls = `<html><meta property="og:title" content="x"><script type="application/json">${JSON.stringify({ p: { id: PIN, videos: { video_list: { V_HLS: { url: "https://v1.pinimg.com/a.m3u8" } } } } })}</script></html>`;
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { body: hls } });
  assert.equal((await code(resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` }))).code, "unsupported_video_format");
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { status: 404 } });
  assert.equal((await code(resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` }))).code, "pin_not_found");
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { status: 403 } });
  assert.equal((await code(resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` }))).code, "pin_unavailable");
});

test("video on a non-approved host is refused", async () => {
  const bad = pinPage(PIN).replaceAll("https://v1.pinimg.com/videos/iht/expMp4", "https://evil.example/v");
  mockNetwork({ [`https://www.pinterest.com/pin/${PIN}/`]: { body: bad } });
  assert.equal((await code(resolvePinterest({}, { url: `https://www.pinterest.com/pin/${PIN}/` }))).code, "unsupported_media_host");
});
