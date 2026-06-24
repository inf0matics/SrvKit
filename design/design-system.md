# Design System — tsp.tools

**Live preview:** [`design-system-preview.html`](./design-system-preview.html) — tokens, fonts, icons, UI elements + landing (Dark/Light toggle).

**Landing page template:** [`landing-template.html`](./landing-template.html) — generic tsp.tools landing page: hero wordmark, tagline, CTA, mobile-safe footer with theme toggle, Tip Jar, Imprint/Privacy (env-var driven), version badge.

**Logged-in app shell:** [`logged-in-template.html`](./logged-in-template.html) — sidebar layout: Space Grotesk amber logo, filled-amber active nav, User → Logout → theme toggle → GitHub + version badge at the bottom.

Platform-wide design tokens. Every service (trips, piggybank, …) consumes these so the
whole platform looks like one product. **Source of truth:** the `tsp.tools` landing repo
(`tailwind.config.js` / `app/assets/css/tailwind.css`). This doc mirrors those values and
adds the Light theme + usage rules for the app services.

---

## Fonts

| Role | Font | Source | Use for |
|---|---|---|---|
| Logo / wordmark | **Space Grotesk** | Google Fonts | The "trips." wordmark & big brand moments only |
| Headlines | **Nunito** | Google Fonts | h1–h3, section headings |
| Body / UI | **Nunito** | Google Fonts | All app text, buttons, forms, tables — the default |

- Text is **Nunito** throughout (headlines + body) — one family keeps it simple and consistent.
- **Space Grotesk** is reserved for the logo/wordmark; never use it for body copy.
- Load both via Google Fonts. Nunito weights 400/600/700/800; Space Grotesk 500/700.
  (Replaces the old Delicious-Heavy display font.)

## Icons

**Tabler Icons** (`i-tabler-*`) — the same set piggybank already uses; keep one icon
family across the whole platform. In Nuxt services use Nuxt UI's `UIcon` / Iconify
(`tabler:car`, `tabler:settings`, `tabler:user-circle`, `tabler:logout`,
`tabler:brand-github`, …). Don't mix in emoji or a second icon set.

## Brand colours (theme-independent)

| Token | Hex | Use |
|---|---|---|
| `primary` | `#fbad18` | Primary actions, key accents (amber) |
| `primary-hover` | `#f7941e` | Hover state of primary |
| `primary-active` | `#f47920` | Active/pressed; also amber *text* on light backgrounds (contrast) |
| `accent` | `#f7941e` | Secondary highlights |
| `secondary` | `#6d6e70` | Muted UI, secondary buttons |
| `on-primary` | `#212529` | Text/icon on top of amber (dark, because amber is light) |
| `danger` | `#ff6347` | Errors, destructive actions, tamper warnings (from existing palette) |

> Accessibility: amber `#fbad18` on a light background fails text contrast. For amber
> *text* on light, use `#f47920` (`primary-active`) or darker. As a *fill* with dark text
> (`on-primary`), amber is fine on both themes.

## Dark theme (default — matches tsp.tools today)

| Token | Hex |
|---|---|
| `bg` | `#212529` |
| `surface` | `#2b3035` *(derived — raised panels/cards)* |
| `border` | `#404041` |
| `text` | `#f0f0f0` |
| `text-muted` | `#adb5bd` *(derived for legibility; `#6d6e70` for very subtle labels)* |

## Light theme (derived, brand-consistent)

| Token | Hex |
|---|---|
| `bg` | `#f8f9fa` |
| `surface` | `#ffffff` |
| `border` | `#dee2e6` |
| `text` | `#212529` *(brand charcoal)* |
| `text-muted` | `#6d6e70` *(`secondary`)* |

Amber/accent/danger stay the same across both themes; only bg/surface/border/text flip.

## Radius & elevation

- Corner radius: cards/inputs use a large radius — `rounded-xl` (0.75rem) as the default,
  `rounded-md` for small controls.
- Card shadow on dark: `inset 0 0 5rem rgba(0,0,0,0.5)` (the tsp `shadow-main`); on light,
  a soft drop shadow instead.

## Layout

App / admin content sits in a **centered container** — `max-w-4xl`, horizontal padding
`px-6 sm:px-10`, vertical padding `pt-10 pb-16`. The (dark) background stays **full-bleed**
behind it; only the content column is width-constrained. (Established by the piggybank admin
implementation; see ADR 008.)

## How services use this

**Stack:** Nuxt 4 + Nuxt UI 4 + Tailwind 4 (matching the piggybank services).

- Expose the tokens as CSS variables / Tailwind theme keys (`tsp-primary`, `tsp-bg`, …),
  matching the names above, so markup reads the same across services.
- Default theme = Dark (the platform's current look). Support a Light toggle that swaps the
  bg/surface/border/text group; brand colours are shared.
- Don't hard-code hex values in components — always reference the token.

## Landing page — hero wordmark

The default landing page shows the logo mark and service name as a large hero unit.

**Structure:** `<logo icon> <service name><dot>`

- **Logo icon** — the service's `logo.svg` in a bordered container:
  `size-14 rounded-[22%] border-4 border-tsp-text/80 sm:size-20`
- **Service name** — white (`tsp-text`), Space Grotesk 700
- **Dot** — amber (`tsp-primary`), same size and weight as the name

Example markup (Nuxt/Tailwind):
```html
<div class="flex items-center gap-4">
  <img src="/logo.svg" class="size-14 rounded-[22%] border-4 border-tsp-text/80 sm:size-20" />
  <span class="font-logo font-bold text-5xl text-tsp-text">stash<span class="text-tsp-primary">.</span></span>
</div>
```

---

## Platform footer

Every service renders the same footer — on the landing page as a page footer, in the logged-in app as the bottom section of the sidebar.

**Items (left to right on landing / top to bottom in sidebar):**
- **User** — email/name, links to Logto Account Center
- **Light/Dark toggle** — sun/moon icon
- **Logout**
- **Settings** — always visible in sidebar bottom; links to `/settings`
- **Imprint** — link to `IMPRINT_URL` env var (omit if not set)
- **Privacy Policy** — link to `PRIVACY_URL` env var (omit if not set)
- **Tip Jar** — link to `TIP_JAR_URL` env var (omit if not set); default: `https://thespielplatz.com/tip-jar`
- **Version** — read from `package.json` at build time, rendered as `v0.0.1` badge

All links open in a new tab. If a URL env var is not set, the corresponding item is hidden — no dead links.

```
IMPRINT_URL=
PRIVACY_URL=
TIP_JAR_URL=https://thespielplatz.com/tip-jar
```

---

*Derived values (surface, light theme, muted text) are noted as such; everything else is
taken verbatim from the tsp.tools repo. If the landing repo changes its tokens, update here.*
