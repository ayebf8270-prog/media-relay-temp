import urllib.request, urllib.error, re, json, sys, os
URL = os.environ.get("PIN_URL", "https://pin.it/2fdcfr34k")
UAS = {
 "worker_ua": "TheHiddenWhyMediaBridge/2.0 (+https://media-bridge.fatehayeb17.workers.dev)",
 "chrome_desktop": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
 "iphone_safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
 "android_chrome": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedirect)
def note(t, m): print(f"::notice title={t}::{m}")
def get(url, ua, hops=8):
    chain = []
    for _ in range(hops):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8"})
        try: r = op.open(req, timeout=25); body = r.read(6_000_000); st = r.status; hd = r.headers
        except urllib.error.HTTPError as e:
            st = e.code; hd = e.headers; body = e.read(6_000_000) if st < 300 or st >= 400 else b""
        chain.append(f"{st} {url[:110]}")
        loc = hd.get("location")
        if 300 <= st < 400 and loc:
            url = urllib.request.urljoin(url, loc); continue
        return chain, st, hd, body.decode("utf-8", "replace"), url
    return chain, 0, {}, "", url
for name, ua in UAS.items():
    try: chain, st, hd, html, final = get(URL, ua)
    except Exception as e: note(name, f"EXC {e!r}"); continue
    info = {"chain": chain, "status": st, "ctype": hd.get("content-type") if hd else None, "len": len(html)}
    metas = re.findall(r'<meta[^>]+(?:property|name)=["\'](og:[^"\']+|twitter:[^"\']+)["\'][^>]*?content=["\']([^"\']*)', html)
    info["meta"] = {k: v[:140] for k, v in metas if k.startswith(("og:video", "og:type", "og:title", "twitter:player", "og:url"))}
    blocks = re.findall(r'<script\b([^>]*)type=["\']application/json["\']([^>]*)>', html)
    info["json_script_ids"] = [re.search(r'id=["\']([^"\']+)', a + b).group(1) if re.search(r'id=["\']([^"\']+)', a + b) else "(no id)" for a, b in blocks][:15]
    info["has_video_list"] = "video_list" in html
    info["has_story_pin"] = "story_pin_data" in html
    info["has_login_wall"] = bool(re.search(r'LoginPage|"isAuthenticated":false|/login/', html))
    vids = sorted(set(re.findall(r'https:\\?/\\?/v1\.pinimg\.com[^"\'\s<>\\]*', html.replace("\\/", "/"))))
    info["pinimg_video_urls"] = [v[:140] for v in vids][:12]
    info["ext_counts"] = {e: len(re.findall(r'\.' + e + r'\b', html)) for e in ("mp4", "m3u8", "cmfv", "mov", "webm")}
    info["title_tag"] = (re.search(r'<title[^>]*>([^<]*)', html) or [None, None])[1]
    note(name, json.dumps(info)[:2900])
    if name == "chrome_desktop":
        open("chrome.html", "w").write(html)
