import urllib.request, urllib.error, re, json, os
URL = "https://pin.it/2fdcfr34k"
UA = "TheHiddenWhyMediaBridge/2.0 (+https://media-bridge.fatehayeb17.workers.dev)"
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedirect)
def note(t, m): print(f"::notice title={t}::{m[:3500]}")
url = URL
for _ in range(8):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.8"})
    try: r = op.open(req, timeout=25); st, hd, body = r.status, r.headers, r.read(6_000_000)
    except urllib.error.HTTPError as e: st, hd, body = e.code, e.headers, (e.read() if e.code < 300 or e.code >= 400 else b"")
    if 300 <= st < 400 and hd.get("location"): url = urllib.request.urljoin(url, hd["location"]); continue
    break
html = body.decode("utf-8", "replace")
pin_id = re.search(r"/pin/(\d+)", url).group(1)

H = "1e54868dd483d5a1a59c10e90d14aaf0"
scripts = [m for m in re.finditer(r'<script\b([^>]*data-relay-completed-request[^>]*)>([\s\S]*?)</script>', html)]
note("relay_script_count", str(len(scripts)))
rel = [m.group(2) for m in scripts if H in m.group(2)]
note("relay_with_hash", str(len(rel)))
b = rel[0]
note("script_head", b[:260].replace("\n", " "))
note("script_tail", b[-200:].replace("\n", " "))
i, j = b.find("{"), b.rfind("}")
try:
    data = json.loads(b[i:j+1]); note("json_parse", "OK top keys=" + json.dumps(list(data.keys())[:20]))
except Exception as e:
    note("json_parse", "FAIL " + repr(e)[:300]); data = None
def walk(node, path, out, pred, d=0):
    if d > 80: return
    if isinstance(node, dict):
        if pred(node): out.append((path, node))
        for k, v in node.items(): walk(v, path + [k], out, pred, d + 1)
    elif isinstance(node, list):
        for k, v in enumerate(node): walk(v, path + [k], out, pred, d + 1)
if data:
    vids = []
    walk(data, [], vids, lambda n: isinstance(n.get("videos"), dict) and "videoList" in n["videos"])
    note("pin_like_nodes_with_videos", str(len(vids)))
    for p, n in vids[:2]:
        v = n["videos"]
        note("pin_node", json.dumps({"path": "/".join(map(str, p))[:200], "entityId": n.get("entityId"), "id": n.get("id"), "type": n.get("__typename"), "keys": sorted(n.keys())[:70]})[:1500])
        vl = v["videoList"]
        note("videoList_keys", json.dumps({k: (sorted(x.keys()) if isinstance(x, dict) else type(x).__name__) for k, x in vl.items()})[:2000])
        for k, x in vl.items():
            if isinstance(x, dict) and ".mp4" in str(x.get("url", "")):
                note("sample_entry_" + k, json.dumps(x)[:600])
        note("videos_other_keys", json.dumps({k: (x if not isinstance(x, (dict, list)) else "<%s>" % type(x).__name__) for k, x in v.items()})[:800])
