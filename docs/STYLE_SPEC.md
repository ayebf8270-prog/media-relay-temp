# Documentary Motion-Graphics Style Spec

**Reference:** YouTube `sI66-RKy4VU` ("Stuxnet" documentary, Spanish, channel *Anatomía de un Hackeo*)
**Source file:** `sI66-RKy4VU.video.399.mp4` — AV1, 1920×1080, 30 fps, 1286.37 s (21:26)
**Release that holds it:** `ytck-42528222758` in this repo
**Purpose:** reproduce the *visual system* (palette, type, HUD, components, motion) for original documentaries. This spec describes style only. Do not reuse the reference's script, text, imagery, or brand elements.

## 0. How to read this document

Every value carries a confidence tag:

| Tag | Meaning |
|---|---|
| **[M]** | Measured directly from pixels of the full-resolution frames (exact RGB, bounding boxes, frame diffs). |
| **[E]** | Estimated from the contact sheets or frames by eye or derived arithmetic from [M] values. |
| **[?]** | Seen but not measured. Treat as a starting point and tune against the reference. |

**Evidence base**
- 28 full-resolution PNG frames (1920×1080) at: 3.0, 18.95, 23.43, 29.5, 47.55, 52.35, 58.1, 83.23, 170.3, 230.75, 239.5, 345.07, 375.73, 426.0, 700.97, 717.73, 759.8, 807.27, 855.7, 882.73, 943.77, 1039.63, 1070.9, 1104.59, 1113.5, 1167.53, 1237.7, 1275.0 s.
- Three contact sheets: `contact_sheet_shots.jpg` (44 shots), `contact_sheet_long_1.jpg` and `contact_sheet_long_2.jpg` (75 interior samples every 15 s inside long shots). The sheets are **not** committed here because they are third-party frames and this repo is public. Regenerate them from `shots.json` logic (§7).
- 30 fps frame-difference runs around 12 cuts; ORB affine camera-scale estimates; exact-RGB histogram across all frames.
- Fonts identified by rendering candidates and scoring pixel-mask IoU against real glyph crops.

## 1. Color palette

The graphics are flat vector art, so exact RGB values repeat heavily. The table below uses the most frequent exact values across all 28 frames.

### 1.1 Backgrounds and surfaces

| Token | HEX | Evidence |
|---|---|---|
| `--bg` (page base) | `#020306` | **[M]** most frequent exact color, 12.75% of all pixels; corner median of every frame |
| `--bg-2` | `#06070C` | **[M]** 9.10% of pixels; edge-midpoint median |
| `--bg-3` | `#04050A` | **[M]** 4.81% |
| `--black` (letterbox only) | `#000000` | **[M]** title-card bars |
| `--scene-bg` (illustrated scenes) | `#080A12` | **[M]** top strip of the control-room frame |
| `--surface-1` | `#131B22` | **[M]** 1.41% of pixels; window pillar and desk family |
| `--surface-2` | `#0B1016` | **[M]** 1.43% |
| `--surface-3` | `#0A1219` | **[M]** 1.03% |
| `--surface-4` | `#111920` | **[M]** 0.60% |
| `--panel-ui-gray` | `#242C33` | **[M]** dominant non-background color in the dense UI frame at 230.75 s |
| `--tower` / schematic structure | `#2C353D` | **[M]** schematic tower fill (375.73 s) |
| `--wall` / schematic wall | `#171F26` | **[M]** schematic wall fill |
| `--ground-below` | `#0B0E15` | **[M]** floor under the ground line (y≈743) |
| `--card-fill-top` → `--card-fill-bottom` | `#0F171E` → `#0D1218` | **[M]** certificate card, top vs bottom |
| `--card-dim` (de-emphasised past card) | `#64676C` | **[M]** grey browser-mock card fill |
| `--newsprint` | `#DED6C9` (family `#D6CFBF`–`#E3DED2`) | **[M]** top light neutrals, 45% of content pixels in the clipping frame |

### 1.2 Accents

| Token | HEX | Role | Evidence |
|---|---|---|---|
| `--red` (primary accent) | `#FF4757` | chapter rule, stamps, alarm states, progress fill | **[M]** repeated exact values `#FF4757`, `#FF4555`, `#FF4655`, `#FF3D47`; thin strokes antialias darker (measured rule core `#FF4050`, progress fill `#FD4052`) |
| `--red-dim` | `#9E4248`, `#AE3A46` | muted red strokes/panels | **[M]** top saturated exact values |
| `--red-wash` | `#631C27`, `#361519`, `#672225` | red room tint, dark red panels | **[M]** content colors at 717.73 and 807.27 s |
| `--amber` (years, labels, selected state) | `#FDB446`–`#FDB649` | year numerals, selected pill, tag, eyebrow | **[M]** exact `#FDB446` (12.8k px), `#FDB649` (pill), `#FBBA54` (tag) |
| `--amber-deep` | `#E8B82B` | map region fill, deeper amber text | **[M]** most frequent saturated exact color (26.5k px) |
| `--cyan` | `#45C7FD` | schematic strokes, info labels | **[M]** exact `#45C7FD` (12.4k px); stroke measured `#4FC5F9`, label `#51BAE4` |
| `--blue-deep` | `#1D3EA7` | blue-screen shot only | **[M]** 20k+ px; appears on the BSOD scene |
| `--green-ok` | `#3FD095` | "valid / normal" UI state | **[M]** bucket mode; dark variants `#277E5A`, `#20734F` |
| `--crt-green` | `#4CD8A0` (peak `#7BD3AC`) | CRT monitor text | **[M]** control-room frame |
| `--crt-screen-bg` | `#051F13`, `#09291A`, `#0F2A1C` | CRT screen panel | **[M]** |

### 1.3 Text neutrals

| Token | HEX | Use | Evidence |
|---|---|---|---|
| `--text-hi` | `#EDF1F5` (headings), `#F5F9FC` (overlays) | chapter title, big titles | **[M]** `#EDF1F5` measured on "chapter title"; `#F5F9FC` top exact light value |
| `--text-hi-2` | `#EFF2F6` | section title | **[M]** |
| `--text-mid` | `#919193` | HUD header secondary text | **[M]** |
| `--text-mid-2` | `#9B9F9D` | location-tag secondary | **[M]** |
| `--text-low` | `#6B6B6D` | title-card subtitle | **[M]** |
| `--text-low-2` | `#595A5E` | right-aligned date caption | **[M]** |
| `--text-gray-fill` | `#92979D` | gray fill inside the hex-dump title letters | **[M]** |
| `--hud-track` | `#242528` | progress track | **[M]** |
| `--hud-tick` | `#757275` | chapter ticks | **[M]** |
| `--axis` | `#474747` | timeline axis | **[M]** |
| `--outline-numeral` | `#3A3B3E` | outlined chapter numeral stroke | **[M]** |

### 1.4 Usage rules (derived from the sheets)

- Red = threat, sabotage, alarm, chapter structure, rubber stamps.
- Amber = time and place: years, dates, selected timeline item, location tag.
- Cyan = systems, networks, "how it works" schematics and labels.
- Green = "normal / valid" state. Appears only on CRT recreations and verification UI.
- White = primary reading text. Gray = metadata, captions, de-emphasis.
- **[E]** Never more than two saturated accent hues in one frame (red + one of amber/cyan/green is the typical pairing).
- Saturated pixels are only **1.48%** of all pixels **[M]**: accents are used sparingly on near-black.

## 2. Typography

Font matching was done by rendering candidates and scoring the binary-mask IoU against the real glyphs.

| Role | Best match | Score | Evidence |
|---|---|---|---|
| Display / headings | **Bricolage Grotesque**, wght 800–900, wdth 100, opsz 48, tracking ≈ −2 px at 140 px (≈ −0.014 em) | IoU **0.919** (next-best candidates Inter, Inter Tight, Archivo, Manrope, Space Grotesk, Geist scored lower) | **[M]** crop of the chapter title |
| HUD, labels, data, CRT text | **JetBrains Mono**, wght 700 (600 also scores well) | IoU **0.913** (vs IBM Plex Mono, Roboto Mono, Share Tech Mono, Geist Mono) | **[M]** crop of "NORMAL" |

Both are open-source (SIL OFL) and available from Google Fonts. Body text inside small UI cards (e.g. the browser mock) was not individually matched **[?]**. Use Bricolage Grotesque 600–700 there.

### 2.1 Type scale at 1920×1080 (derived from measured cap heights)

Cap-height ratios from the fonts: Bricolage 800 = 0.66; JetBrains Mono 700 = 0.73 (advance 0.60 em).

| Element | Measured | Derived size | Tracking | Color | Tag |
|---|---|---|---|---|---|
| Big title ("STUXNET" style) | cap height 123 px, glyph block x 242–1688 | **≈186 px** Bricolage 800 | tight | gray fill `#92979D` with hex-dump texture | M/E |
| Title subtitle | height 55 px, x 477–1444 | **≈64 px** bold sans **[E]** | normal | `#6B6B6D` | M/E |
| Chapter title | cap height 64 px | **≈97 px** Bricolage 800 | −0.014 em | `#EDF1F5` | M/E |
| Chapter numeral (outlined) | height 175 px, x 841–1072 | **≈265 px** Bricolage, **stroke only** | normal | stroke `#3A3B3E` (≈2 px) | M/E |
| Chapter label ("CAPÍTULO n DE 8") | cap ≈18 px, width 403 px | **≈25 px** JetBrains Mono | **≈0.51 em** | `--red` | M/E |
| HUD header | cap height 16 px | **≈22 px** JetBrains Mono | ≈0.16 em (red word), wider on the gray part **[E]** | red word + `#919193` | M/E |
| Section title ("month, year" style) | height 51 px incl. ascenders | **≈72 px** Bricolage 800 **[E]** | −0.014 em | `#EFF2F6` | M/E |
| Section eyebrow | cap height 16 px, width 199 | **≈22 px** JetBrains Mono, wide | ≈0.3 em **[E]** | `#F0B95A` + amber dot | M/E |
| Date caption (right aligned) | cap height 16 px, x 1467–1813 | **≈22 px** JetBrains Mono, wide | ≈0.3 em **[E]** | `#595A5E` | M/E |
| Schematic label | cap height 17 px, width 416 px | **≈23 px** JetBrains Mono | ≈0.3 em **[E]** | `#51BAE4` | M/E |
| Location tag | cap 18 px (amber word), 23 px (gray word) | **≈24–25 px** mono | ≈0.2 em **[E]** | `#FBBA54` + `#9B9F9D` | M/E |
| Icon caption ("INTERNET" style) | cap height 21 px, width 190 | **≈29 px** mono, bold, white | ≈0.3 em **[E]** | white | M/E |
| Red sub-line (card callout) | height 53 px, 2 lines | **≈34 px** Bricolage 600 **[E]** | normal | `#F44660` | M/E |

Rules observed: titles are sentence case in Bricolage; every label, tag, caption and number readout is **UPPERCASE JetBrains Mono, wide-tracked**; hierarchy is created by size and color, not by many weights.

## 3. Frame structure, HUD and grids

### 3.1 Canvas and margins

- Canvas 1920×1080. Outer HUD margin **64 px** left/right **[M]** (track runs x=63→1856; header text starts x=65–66).
- Content left margin **x = 105 px** **[M]** (section title, eyebrow, timeline start at x≈105 / 105).
- Right-aligned items end at x ≈ **1813–1818** **[M]** (date caption, location tag).
- Bottom-right location tag sits at y ≈ **786–808** **[M]**.

### 3.2 Persistent HUD (every content frame after the intro)

- **Header text** at y 44–59 (cap height 16 px), left x=65: `BRAND-WORD` in `--red` + secondary text in `#919193`. In content frames the secondary part shows `NN · CHAPTER NAME`; on the chapter card it shows the film tagline **[M]**.
- **Progress track** at y ≈ 80–84 (≈5 px thick **[E]**), color `#242528`, spanning x 63→1856 **[M]**.
- **Chapter ticks**: 14 px tall (y 76–89), ≈3 px wide, color `#757275`. Measured tick x-positions: **71 (start), 315, 534, 741, 919, 1179, 1380, 1559** **[M]**.
- **Progress fill**: `--red`, same y band as the track, grows continuously with a fitted rate of **1.48 px/s**: `x(t) = 71 + 1.48 × (t − 60)` for t ≈ 60–1266 s **[M]** (fit within ±3 px at 12 sample times; fill end measured 71 @60 s, 425 @300 s, 1460 @1000 s, 1845 @1260 s).
- Derived chapter start times from tick positions (`t = 60 + (x−71)/1.48`): ch2 ≈ 225 s, ch3 ≈ 373 s, ch4 ≈ 513 s, ch5 ≈ 633 s, ch6 ≈ 809 s, ch7 ≈ 944 s, ch8 ≈ 1065 s **[E]**. These agree with shot boundaries at 225.0, 372.73, 804.27, 940.77 and 1065.13 s **[M]**.
- The HUD is absent on the cold open and title cards. The first ≈55 s have no progress bar **[M]** (chapter card at 55 s is the first frame with the HUD).

### 3.3 Backgrounds

- Base fill `--bg #020306`. Mean luminance on a typical content frame (170.3 s): **center 28.9, left edge 18.0, extreme corner 4.0** (0–255) **[M]**, i.e. a radial vignette that darkens to near-black corners.
- Accent-tinted ambient glow: the timeline frame (882.73 s) shows a faint warm radial (center-top `#13110D` vs bottom `#04050A`) **[M]**. Tint with the section's accent hue at very low alpha **[E]**.
- Title card only: **letterbox bars**, black rows 0–110 and 963–1079 at 47.55 s (≈110 px each), 0–99 / 963–1079 at 52.35 s **[M]**. Bars are *not* used elsewhere.
- Hex-dump texture behind the title: monospace hex text, very faint (max channel `#18191C`, median `#060508`) **[M]**, with a few red-highlighted rows inside the title glyphs **[M]**.
- Background grid: a very faint grid/perspective floor is visible on the sheets (shots 17–20, 14–16), but periodic spacing could not be measured reliably in the sampled region **[?]**. Reproduce as 1 px lines at ≈ +2–4 luma above `--bg`.
- **CRT scanlines** (control-room monitor only): vertical luminance profile repeats every **5 px** with values ≈45/46/63/62/65, i.e. ≈30% dip **[M]**.

## 4. Infographic components

### 4.1 Title card (hex-dump title)

- Giant title at x 242–1688, y 357–479 (cap 123 px). Letter fill is the hex dump masked inside the glyphs, white and red-highlighted rows, on a mid-gray plate (`#92979D`) **[M]**.
- **Red rule** under it: x 488–1431 (width 944 px), y 640–644 (**5 px** thick), core `#FF4050`, glow tight **[M]**.
- Glow profile (R channel across the rule): peak 255 at center row, 156–171 at ±1–3 px, ≈37–42 at ±4–6 px, baseline ≈ 20–29 beyond **[M]** → tight glow, **≈6 px blur at low alpha** **[E]**.
- Subtitle centered below (y 683–738) in `#6B6B6D`.
- Faint horizontal scan texture across the frame (row-to-row luma std 3.37) **[M]** (weak).

### 4.2 Chapter card

All measured at 58.1 s:

| Element | Box (x0,y0 – x1,y1) | Notes |
|---|---|---|
| Label "CAPÍTULO n DE 8" | 753,318 – 1155,342 | `--red`, mono ≈25 px, tracking ≈0.51 em |
| Outlined numeral "0n" | 841,398 – 1072,572 | stroke-only, `#3A3B3E`, ≈265 px |
| Red rule | 701,621 – 1218,623 (**3 px** × 518 px) | `--red`, soft glow |
| Chapter title | 740,677 – 1184,740 | `#EDF1F5`, ≈97 px |
| HUD | see §3.2 | present, fill not yet advanced |

Layout is centered on the vertical axis (x ≈ 960). The stack is label → numeral → rule → title with ≈ 30–55 px between elements.

### 4.3 Section header + timeline (e.g. a dated sequence)

Measured at 882.73 s:
- Eyebrow `● LA ALARMA`-style: amber dot + mono caps at x 105–303, y 142–157.
- Section title: x 105–489, y 183–233.
- Right caption: x 1467–1813, y 199–214, `#595A5E`.
- Timeline axis at **y = 331**, `#474747`, running x ≈ 105 → 1815; day labels above in mono, tick below.
- **Selected-day pill**: amber `#FDB649`, **60×42 px**, rounded, black number inside; the selected tick has a filled amber node; past items are dimmed.
- Past event copy is dimmed to `#64676C`; current event copy is full white plus a red sub-line (`#F44660`).
- Bracket connectors (thin amber lines, right-angle) link the axis node to the event column.

### 4.4 Info card ("document / certificate" style)

Measured at 882.73 s:
- Box **540,611 – 942,851 (403 × 241 px)**, corner radius **≈18 px** **[M]**, 1 px border (measured `#3C5B6D` on the antialiased edge; it is `--cyan` at ≈40% alpha **[E]**).
- Fill: vertical gradient `#0F171E` → `#0D1218`.
- Contents: tiny mono eyebrow in cyan (`CERTIFICADO DIGITAL` style), big bold name in white, mono sub-line in gray, a green `--green-ok` status line with check, a faint wavy line pattern at the bottom, an outline "seal" icon in cyan at the top right, and a gray mono watermark tag bottom-right.
- **"RECREACIÓN" tag** (any reconstructed scene): small pill with mono caps, near-black fill, thin border, on the upper right of the illustration. Appears on recreated screens/photos **[M seen on 2 frames]**.
- Companion "past" card: same radius, gray fill `#64676C`, reads as a browser mock with 3 window dots, URL pill and headline text.

### 4.5 CRT monitor recreation

- Bezel dark `#030E08`/`#07130D`; screen `#051F13`–`#0F2A1C`; text `#4CD8A0` (peak `#7BD3AC`).
- Status line: giant mono text ("NORMAL ✓"), dot-matrix of `--green-ok` circles on the left and right monitors, outlined badge with spaced mono text.
- Scanlines every 5 px **[M]**, light bloom around bright text **[E]**.
- Monitors tilt in perspective (≈ ±3–5°) **[E]**.

### 4.6 Silhouettes and rim lighting

- Silhouette fill `#02050A` (measured 100% of sampled body region) **[M]**.
- **Rim light**: 2–3 px red edge, median `#AB3A47` **[M]**, only on edges facing the light.
- Floor/desk `#0C131A`/`#0A0F15` **[M]**; window/pillar frames `#121B21`.
- Scene background is an illustrated, red-washed environment (`#631C27` family) behind the silhouettes **[M/E]**.

### 4.7 Schematic / cutaway diagram

From 375.73 s:
- Ground line at y ≈ 743, dashed on the left, solid across.
- Structures in flat `#2C353D` (towers) and `#171F26` (wall) with 1 px lighter separators.
- Active system highlighted as a **cyan outline monitor** (`#4FC5F9`, 2–3 px stroke, rounded) that also carries a small bar-chart glyph and green status dot.
- Circuit/data line: white 4 px line with cyan dashes traveling along it, right-angle bends.
- Red dot lights (≈10 px) on towers as status LEDs `--red`.
- Labels in cyan mono caps, wide-tracked; place name tag bottom-right in amber (`NATANZ`-style) + gray qualifier (`ESQUEMA`-style).
- Icon + caption pair: line-art circle icon with white mono caption centered below (e.g. a globe + "INTERNET" style label).

### 4.8 Map / globe callouts

From sheets (long_1 rows 2–3, long_2 rows 1–3) **[E]**:
- Dark globe with faint dotted continents; countries appear as flat polygons filled in `--amber-deep` or dim.
- Callouts: pin node + pill with mono eyebrow, one bold line, optionally a metric (e.g. `≈ 100,000`), border 1 px in amber, cyan, or red depending on category.
- Dashed route lines between pins in amber.
- **Infection map**: a dense field of small red dots clustering on continents with a bright red hot-spot at the origin **[E]**.

### 4.9 Data readouts and counters

- Large numeral with unit in mono, glowing: e.g. green `1.064 Hz`, amber `10.414`, `8.692`; counters tick up in place.
- Line/area chart: thin 2 px line, area filled with amber at low alpha, end-point value with a glowing dot, axis labels in mono gray **[E]**.
- Waveform monitors: green trace on dark panel with red spike variant when "attacked" **[E]**.
- Seven-day style calendar card: red top band with month, large white day numeral, small gray year **[E]**.

### 4.10 Rubber stamps and badges

Rotated 3–8°, 3 px red outline with red mono caps, slight roughness; seen as "NO", "ROBADA", a verdict stamp and a "DESPEDIDO"-style stamp **[E]**. Also a **film-strip card** (dark with sprocket holes and white title) and a **red glowing box** (reveal scene) **[E]**.

### 4.11 Documentary props

A newspaper clipping in `--newsprint #DED6C9` with a thin dark masthead, headline in serif, small photo; a dossier page with a red "TOP SECRET" stamp; a gavel; all drawn as flat vector props with soft drop shadow **[E]**. Replace the text with your own subject matter. Do not reproduce real mastheads or headlines.

## 5. Animation and camera

### 5.1 Camera

- **Default: locked-off.** The UI/infographic shots at 167–225 s show scale = 1.0000 (±0.0002) over 57 s, zero pan **[M]**.
- **Hall/cold-open shot** (0–15 s): scale 0.996 → 1.003 (t=2–8 s, noise), 1.007 @10 s, 1.020 @12 s, **1.065 @14.5 s** with ≈ −63 px horizontal drift **[M]** → static for ≈10 s, then an **accelerating ease-in push-in of ≈6.5% over the last ≈2.5 s** before the cut.
- Perspective scenes (hall, silhouettes) are drawn in one-point perspective with a centered vanishing point **[E]**.

### 5.2 Cuts and transitions

All transitions measured at 30 fps frame differences (mean abs luma diff):

| Cut | Peak diff | Frames above 25% of peak | Reading |
|---|---|---|---|
| rapid cut @22.83 s | 42.6 | 4 (0.13 s) | **hard cut**, then 3 frames (≈ 11–13) of the new scene's elements snapping in |
| rapid cut @24.03 s | 42.8 | 4 (0.13 s) | same |
| title in @46.5 s | 58.2 | 3 (0.10 s) | hard cut, then 4–5 frames of settle |
| title → bars @48.6 s | 8.6 | 6 (0.20 s) | alternate-frame flicker (diffs 6.7 / 0.7 / 8.6 / 0.5 …) = **glitch flicker** during the title hold |
| chapter card in @55.1 s | 11.3 | 7 (0.23 s) | hard cut + staggered fades |
| long → rapid @162.37 s | 15.1 | 2 (0.07 s) | hard cut |
| UI → UI @225.0 s | 10.6 | 2 (0.07 s) | hard cut |
| map/globe @372.73 s | 6.5 | 3 (0.10 s) | hard cut |
| chapter 6 card @697.97 s | 6.9 | 9 (0.30 s) | slower staggered build |
| chapter 7 card @940.77 s | 12.4 | 6 (0.20 s) | hard cut + staggered |
| end @1234.7 s | 34.2 | 1 (0.03 s) | hard cut |

**Conclusion [M]:** there are **no cross-dissolves**. Every shot boundary is a single-frame **hard cut**; softness comes from *elements animating in after the cut* (3–4 frames for montage cuts, 6–9 frames for chapter cards).

### 5.3 Element motion

- **Chapter card entrance** (measured 54.6–57.7 s at 30 fps): after the hard cut at ≈55.5 s the HUD header goes from luma 4 → 136 → 176 → 196 over **≈ 4–5 frames**, the red rule appears in **≈ 1–3 frames** (4 → 161), then values settle by ≈56.0 s. Total build ≈ **0.4–0.5 s (12–15 frames)**.
- **Internal activity inside long shots** [M]: a new element/event begins every **1.6–2.7 s** (median gaps 1.6 s on the UI shot, 1.8 s and 1.85 s on others, 2.7 s on the map shot), i.e. **14–19 events per minute**. Mean frame-to-frame change is small (0.58–1.03), so most of the screen is static while one element animates.
- Reveal styles seen on sheets **[E]**: type-on of text, counters ticking, line draws along paths (data line with traveling dashes), panels scaling/fading in, highlight-pill hopping between ticks, dimming of previous items when the next becomes current.
- Easing: ease-out for entrances, ease-in for the cold-open push-in **[E]**. Exact curves were not extracted **[?]**.

### 5.4 Effects

| Effect | Spec | Tag |
|---|---|---|
| Soft red glow on rules and alarm UI | ≈6 px blur, peak at core, low alpha; red `#FF4050` | M/E |
| Hex-dump text masked in title glyphs | monospace, white and pink rows, flicker at ≈15 Hz during the hold | M/E |
| CRT scanlines | 5 px period, ≈30% dip, only on monitor panels | M |
| Radial vignette | center 28.9 → edge 18.0 → corner 4.0 luma | M |
| Rim light on silhouettes | 2–3 px red edge `#AB3A47` | M |
| Glitch/chromatic offset on a statistic ("1 de cada 10" style) | red/cyan channel split with horizontal tear | E |
| Particle networks | small red dots with thin links, fade in over map | E |

## 6. Shot composition and timing

### 6.1 Statistics (shots detected at scene-score > 0.05, cuts < 1 s merged)

- **44 shots**; median length **15.07 s**; min 1.0 s; max **274.97 s**. Longest shots (long infographic sequences): #26 (423.0 s, 275 s), #22 (236.5 s, 100 s), #36 (940.8 s, 96 s), #15 (80.2 s, 82 s), #43 (1164.5 s, 70 s) **[M]**.
- Consequence: **the pacing is built from very few cuts and a steady drip of animated events** (≈ one every 2 s), not from fast editing.

### 6.2 Structure of the video

| Time | Content | Cut rhythm |
|---|---|---|
| 0:00–0:22 | Cold open: illustrated hall (15 s, slow push-in at the end), then control-room recreation (7.8 s) | 2 shots |
| 0:22.8–0:30.3 | **Rapid-cut montage**: 5 shots of 1.2, 1.7, 1.43, 1.57, 1.53 s (36–51 frames each) | hard cuts |
| 0:30–0:46 | Three shots of 4.6, 6.1 and 5.6 s leading into the title | |
| 0:46.5–0:55 | **Title card** (2.1 s) → title with bars (1.0 s flicker) → hold (5.5 s) | |
| 0:55 | **Chapter card 01** (≈ 4–5 s hold) → chapters are long, mostly single-shot explainers | |
| 2:42–2:47 | Second **rapid-cut burst** (5 cuts at 1.1–1.4 s) | |
| 3:45 → end | Long infographic sequences with chapter changes at the derived times (§3.2); chapter cards at ch1, ch6 (804 s), ch7 (941 s) | |
| 20:34–21:21 | Closing: calendar/reveal scenes, then end cards with a question prompt and a subscribe-style pill | |

### 6.3 Composition rules

- **Symmetry and center axis** for titles and chapter cards (all centered on x=960). Left-aligned for data scenes (x=105).
- **Illustrated scenes**: one-point perspective, vanishing point centered; silhouettes in the bottom third, large and unlit, rim-lit in red.
- **Negative space is large**: content pixels were only 2–27% of the frame in the sampled frames **[M]**; the typical infographic frame has 1–3 elements active.
- **One idea per beat**: each 1.6–2.7 s event adds or highlights one element; previous items dim.
- **Header safe zone**: nothing from the scene sits in y < 100 so the HUD stays clean **[M]**.

## 7. Reusable templates (parameters for your own projects)

All times are frames at 30 fps. Items marked [M]/[E] follow the confidence legend.

```css
:root{
  --bg:#020306; --bg-2:#06070C; --bg-3:#04050A;
  --surface-1:#131B22; --surface-2:#0B1016; --panel:#242C33;
  --red:#FF4757; --red-dim:#9E4248; --red-wash:#361519;
  --amber:#FDB446; --amber-deep:#E8B82B;
  --cyan:#45C7FD; --green:#3FD095; --crt:#4CD8A0;
  --text-hi:#EDF1F5; --text-mid:#919193; --text-low:#6B6B6D; --text-cap:#595A5E;
  --hud-track:#242528; --hud-tick:#757275; --axis:#474747;
  --font-display:"Bricolage Grotesque",system-ui,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
  --margin-hud:64px; --margin-content:105px;
}
```

| ID | Template | Layout and spec | Animation timeline |
|---|---|---|---|
| **T1** | Cold-open establishing shot | Illustrated one-point-perspective environment, red wash, 15 s. No HUD. | Locked 0–10 s; ease-in scale 1.00 → **1.065** over the last 2.5 s with ≈ −60 px x-drift **[M]** |
| **T2** | Recreation panel (CRT) | 3 tilted monitors, 5 px scanlines, `--crt` text, status badge, "RECREACIÓN" pill top-right | Bloom pulse; dots light sequentially; ≈ 7–8 s hold **[E]** |
| **T3** | Rapid-cut montage | 4–6 shots × 36–51 frames of silhouettes/props with red rim light, no HUD | Hard cut; elements snap in over **3–4 frames**; no dissolves **[M]** |
| **T4** | Hex-dump title card | Letterbox 110 px; title ≈186 px Bricolage 800 filled with masked hex text; red rule 944×5 px at y=640; subtitle ≈64 px `#6B6B6D` | Cut in (settle 4–5 frames); 2-frame alternating flicker during hold; total ≈ 8–9 s **[M]** |
| **T5** | Chapter card | Label 25 px mono red (0.51 em), outlined numeral 265 px, rule 518×3 px at y=621, title 97 px, HUD visible | Hard cut; header fades over 4–5 frames, rule in 1–3 frames, label/title in ≤ 10 frames; **0.4–0.5 s** build **[M]**; hold 4–5 s **[E]** |
| **T6** | HUD frame | Header 22 px mono at y=44; track y≈80–84, x 64→1856; ticks at chapter positions | Fill `x(t)=71+1.48·(t−60)`; chapter name text swaps at tick **[M]** |
| **T7** | Dated-timeline section | Eyebrow (amber dot, 22 px mono, 0.3 em), title 72 px, axis y=331, amber pill 60×42, bracket connectors, 1–2 event columns starting x≈105 | Pill hops tick to tick; previous column dims to `#64676C`; new column fades/slides in ≈ 10–15 frames **[E]** |
| **T8** | Info card | 403×241, radius 18, 1 px `--cyan` @40%, fill `#0F171E→#0D1218`, eyebrow cyan mono, name white, green status line, icon top-right | Card scales 0.96 → 1.0 and fades over ≈ 10 frames **[E]** |
| **T9** | Schematic cutaway | Ground line y≈743; structures `#2C353D`/`#171F26`; active system = cyan outline monitor; data line white 4 px with cyan dashes; amber location tag bottom-right (right edge x≈1818, y 786–808) | Elements appear one per 1.6–2.7 s; dashes travel along the line **[M cadence / E motion]** |
| **T10** | Map/globe callout | Dark globe or flat map, amber polygons, pin + pill callouts with mono eyebrow, dashed amber routes | Camera locked; pins appear one at a time, route draws between them **[E]** |
| **T11** | Data counter | Large mono numeral + unit, glow in `--green`/`--amber`, caption in mono gray | Count-up in place over 1–2 s **[E]** |
| **T12** | Stamp | Rotated 3–8°, 3 px red outline, mono caps | Scale 1.3 → 1.0 + opacity in 3–5 frames **[E]** |
| **T13** | Outro prompt | Question card + pill button on dark HUD frame | **[?]** |

Rules for assembling a full video **[E from §6]**
1. ≈ 45–55 s of cold open and rapid-cut montage, then a title card, then chapter 1.
2. Chapters last ≈ 2.5–4 min; use at most **one** long locked-off shot per chapter segment and drive pacing with an event every ~2 s.
3. Cut only with hard cuts; build softness with 3–15 frame element entrances.
4. One accent hue per beat (red threat, amber time/place, cyan system, green normal).
5. Keep ≥ 70% of the frame as near-black negative space.

## 8. Known gaps (not measured, treat with care)

- Exact easing curves, spring values and keyframe offsets of element animations **[?]**.
- Periodic background grid spacing/alpha **[?]**.
- Stamp roughness, exact rotation angles, film-strip card dimensions, the globe's dot spacing **[?]**.
- Exact weights of body text inside small UI cards **[?]**.
- Audio design (music, SFX, transitions) was **not analyzed**. Only visuals.
- Chapter-card hold lengths for chapters 2–5 are not confirmed (their boundaries lie inside long shots).

## 9. Reproduction notes

- **Rendering target:** 1920×1080 @ 30 fps, sRGB. HTML/CSS + a frame-accurate renderer (e.g. HyperFrames-style HTML→MP4) or After Effects/Motion with the tokens above.
- **Verify against reference:** to check any frame, re-extract from `ytck-42528222758` with `ffmpeg -ss <t> -i sI66-RKy4VU.video.399.mp4 -frames:v 1` and compare color tokens with the table in §1.
- **Rights:** use this spec for the *look*. Create all text, illustrations, props, icons and map data yourself or from properly licensed sources.
