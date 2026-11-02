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
blocks = {}
for m in re.finditer(r'<script\b([^>]*)type=["\']application/json["\']([^>]*)>([\s\S]*?)</script>', html):
    idm = re.search(r'id=["\']([^"\']+)', m.group(1) + m.group(2)); 
    try: blocks[idm.group(1) if idm else "noid"] = json.loads(m.group(3))
    except Exception as e: blocks[(idm.group(1) if idm else "noid") + "_BAD"] = str(e)
note("blocks", json.dumps({k: (len(json.dumps(v)) if not isinstance(v, str) else v) for k, v in blocks.items()}))
def walk(node, path, out, pred, depth=0):
    if depth > 60: return
    if isinstance(node, dict):
        for k, v in node.items(): walk(v, path + [k], out, pred, depth + 1)
        if pred(node, path): out.append((path, node))
    elif isinstance(node, list):
        for i, v in enumerate(node): walk(v, path + [i], out, pred, depth + 1)
# 1. objects directly holding an .mp4 url string
hits = []
walk(blocks.get("__PWS_DATA__"), [], hits, lambda n, p: any(isinstance(v, str) and ".mp4" in v and "pinimg" in v for v in n.values()))
note("mp4_holders", json.dumps([{"path": "/".join(map(str, p)), "obj": {k: (v if not isinstance(v, (dict, list)) else "<%s>" % type(v).__name__) for k, v in n.items()}} for p, n in hits[:8]])[:3400])
# 2. nodes whose id == pin id
pins = []
walk(blocks.get("__PWS_DATA__"), [], pins, lambda n, p: str(n.get("id")) == pin_id)
note("pin_nodes", json.dumps([{"path": "/".join(map(str, p)), "keys": sorted(n.keys())[:60]} for p, n in pins[:5]])[:3400])
# 3. distinct video hashes in whole page (are related pins' videos present?)
hashes = sorted(set(re.findall(r"pinimg\.com/videos/[^/]+/(?:[^/]+/)?[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{2}/([0-9a-f]{32})", html.replace("\\/", "/"))))
note("video_hashes", json.dumps(hashes))
# 4. all key names containing 'video' anywhere in PWS_DATA
keys = set(); 
def kw(node, d=0):
    if d > 60: return
    if isinstance(node, dict):
        for k, v in node.items():
            if "video" in str(k).lower() or str(k).startswith("V_"): keys.add(str(k))
            kw(v, d + 1)
    elif isinstance(node, list):
        for v in node: kw(v, d + 1)
kw(blocks.get("__PWS_DATA__")); note("video_keys", json.dumps(sorted(keys)[:80]))
note("page", json.dumps({"final_url": url, "og_present": "og:video" in html, "title": (re.search(r"<title[^>]*>([^<]*)", html) or [0, ""])[1][:100]}))
