# media-bridge

Cloudflare Worker exposing an MCP server for media retrieval (Wikimedia Commons, Internet Archive, Pexels, Pixabay),
Pinterest video resolution, image generation, and a temporary GitHub-release relay.

## Develop
```
npm test          # node >= 20, no dependencies
```
Deploy `worker.js` with `wrangler deploy` or paste it in the Cloudflare dashboard (Workers > media-bridge > Edit code).
Secrets are configured on the Worker, never in this repo: `ACCESS_TOKEN` (required), `PEXELS_API_KEY`, `PIXABAY_API_KEY`,
`GITHUB_TOKEN` + `GITHUB_REPO` (relay), `PINTEREST_USER_AGENT`, `HF_TOKEN`.

## Changelog
### 2.4.0 - Pinterest resolver hardening
- `unsupported_url` now reports where the redirect chain ended (query strings stripped), classifies it (board / profile / login wall /
  search) and lists the hops, so a failing link can be diagnosed from the error alone.
- Login or consent walls that wrap a pin in `?next=` are unwrapped.
- If the final URL has no `/pin/<id>`, the id is taken from the page's own canonical / og:url / app-link tags when they agree on exactly
  one pin. Related pins in the page body are never used; conflicting tags are treated as ambiguous.
- Allowlists unchanged: redirects off `pin.it` / `pinterest.com` and videos off approved media hosts are still refused.
- Regression tests cover the previously working `pin.it` -> `/pin/<id>/sent/` shape, direct pin URLs, no_video, HLS-only, 403/404,
  redirect loops and the security cases.

### 2.3.0 generate_image - 2.2.0 resolve_pinterest - 2.1.0 relay_media / relay_cleanup
