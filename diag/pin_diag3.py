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
raw = html
note("occurrences", str(len(re.findall(H, raw))))
for m in list(re.finditer(r'<script\b([^>]*)>', raw)):
    pass
# find enclosing <script ...> tag of each occurrence
spans = [(m.start(), m.end(), m.group(1)) for m in re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script>', raw)]
cnt = {}
for mm in re.finditer(H, raw):
    pos = mm.start(); tag = "outside-script"
    for a, b, attrs in spans:
        if a <= pos <= b: tag = re.sub(r"\s+", " ", attrs)[:120]; break
    cnt[tag] = cnt.get(tag, 0) + 1
note("enclosing_script_tags", json.dumps(cnt))
# context snippets for the first mp4 occurrence and the first 720w one
for label, pat in (("ctx_expMp4", r"expMp4"), ("ctx_hevc540", r"540w\.mp4"), ("ctx_m3u8", r"hls/")):
    m = re.search(pat, raw)
    if m: note(label, raw[max(0, m.start()-700): m.end()+500].replace("\n", " "))
