import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { ACCESS_TOKEN: "x".repeat(32) };
const rpc = (method, params, id = 1) => worker.fetch(new Request(`https://h/${env.ACCESS_TOKEN}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }), env).then(r => r.json());

test("fails closed without ACCESS_TOKEN; wrong path is a 404", async () => {
  assert.equal((await worker.fetch(new Request("https://h/anything"), {})).status, 503);
  assert.equal((await worker.fetch(new Request("https://h/nope/mcp"), env)).status, 404);
});
test("initialize reports 2.4.0 and tools/list exposes all 13 tools", async () => {
  assert.equal((await rpc("initialize")).result.serverInfo.version, "2.4.0");
  const names = (await rpc("tools/list")).result.tools.map(t => t.name);
  assert.equal(names.length, 13); assert.ok(names.includes("resolve_pinterest") && names.includes("relay_media"));
});
test("tools/call surfaces BridgeError codes (unsupported_protocol)", async () => {
  const r = await rpc("tools/call", { name: "resolve_pinterest", arguments: { url: "http://pin.it/x" } });
  assert.equal(r.result.isError, true); assert.equal(JSON.parse(r.result.content[0].text).error, "unsupported_protocol");
});
