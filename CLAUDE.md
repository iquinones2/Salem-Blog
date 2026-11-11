# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Quarto static website and journal for Salem Custom Screen Printing, a small, faith-driven custom apparel shop in Chicago. Isai builds and maintains it pro bono. Live at https://iquinones2.github.io/Salem-Blog/ (repo: https://github.com/iquinones2/Salem-Blog). Designs live in Figma, file key `RusVTb4cCO7e9gBTei1Cd0` (use the Figma MCP if available). The site is informational only — there is no checkout, cart, or order handling. Nothing on the site charges money, and only the Salem list (newsletter) sends data, to a Google Sheet via Apps Script; ordering happens by messaging Salem (Instagram DM). Keep wording consistent with that (e.g. "Message Salem to order", not "Buy now").

## Working rules

- Read the existing files before changing them; reuse what is there.
- Run `quarto render` and fix errors before saying a task is done.
- **Never commit or push.** Isai reviews and commits.
- Never `console.log` personal data. Never put an email or phone number in a URL (hand data between pages with `sessionStorage`).
- Must work at 390px width, with accessible states (`role="status"` / `role="alert"`, focus management, `aria-describedby`).

## Commands

```bash
quarto preview              # live-reloading local server
quarto render               # build the whole site into docs/
quarto render shop.qmd      # re-render a single page
```

Render one file at a time, or the whole site. Passing several files to one `quarto render` call leaked one page's `header-includes` into another and dropped the Google Fonts link (seen Nov 2026). Don't run `quarto render` while `quarto preview` is running: the preview then serves "Quarto Render Error" on every page until it is restarted. Stop the preview first, or let it re-render on save.

There is no package manager, linter, build step, or test suite. Verify changes by rendering and checking the output in `docs/` (or in the browser via `quarto preview`).

## Publishing

- GitHub Pages serves the committed `docs/` folder from `master`. `docs/` is generated — never edit it by hand; fix the source and re-render.
- Source changes and the re-rendered `docs/` belong in the same commit (Isai commits).
- `_quarto.yml` renders only `*.qmd` files, so `readme.md` (the GitHub README) is not published. Files Quarto can't discover through references must be listed under `project: resources:` (e.g. `images/icons/sprout.svg`, used only by the journal template's no-thumbnail fallback, and `assets/js/*.js`). `apps-script/` is not published.

## Architecture

**Pages are mostly raw HTML.** `index.qmd`, `about.qmd`, `shop.qmd`, and `subscribe.qmd` use `page-layout: custom` and put their markup in ```` ```{=html} ```` blocks, with inline `<script>` for behavior. Each page's `body-classes` (`salem-home`, `salem-about`, `salem-shop`, `salem-subscribe`) scopes its CSS. Their footers are written inline per page, separately from the post footer partial — keep footer links in sync across `index.qmd`, `about.qmd`, `shop.qmd`, `subscribe.qmd`, `subscribed.qmd`, `unsubscribe.qmd`, `preferences.qmd`, and `_partials/salem-footer.html`.

**Journal.** `index.qmd` defines a Quarto listing over `posts/` rendered with the custom `journal.ejs` template. Quarto's own sort/filter UI is disabled; an inline script at the bottom of `index.qmd` builds the category filter pills and the sort dropdown from `data-cats` / `data-title` / `data-listing-date-sort` attributes the template emits. Posts without `image` get the sprout "mission artwork" card.

**Posts.** Each post is `posts/<Post-Name>/index.qmd` with its thumbnail and a `photos/` folder. `posts/_metadata.yml` applies to all posts: `freeze: true`, `body-classes: salem-post`, the custom title block (`_partials/title-block.html`) and footer/newsletter (`_partials/salem-footer.html`). Partial paths are relative to `posts/<post>/` (`../../`). Front matter: `title`, `author`, `date` (`YYYY-MM-DD`), `image`, `description`, `categories`, and `body-classes: salem-post post-<theme>`. The `post-<theme>` class sets `--post-accent` / `--post-soft` in `styles.css` ("Blog post layouts" section) — add a new class there for a new post theme. Content uses Pandoc divs such as `.post-wide`, `.post-photo`, `.verse-banner`, `.section-label`; images need `fig-alt`.

**Styles.** Everything lives in `styles.css` on top of the `lux` theme. Design tokens (`--salem-*` colors and fonts) are in the `:root` block under "Salem design tokens"; the file is organized in banner-commented sections per page (Homepage, Blog posts, About, Shop, Join the Salem list). Later sections build on earlier ones (Shop reuses About layout; Subscribe reuses Shop form fields), so check shared selectors before changing them. Fonts load from Google Fonts in `_quarto.yml`.

**Shop customizer.** `shop/shirt-styles.js` is pure data (`window.SALEM_SHIRT_STYLES`, `window.SALEM_INK_COLORS`): styles, sizes, mockup images in `images/shop/`, print areas as fractions of the preview, and color swatches — adding a style or color only requires editing this file. `shop/customizer.js` is a dependency-free IIFE that reads that data and drives the markup in `shop.qmd`: a single `state` object mutated through `change()` with undo history, persisted to `localStorage` (`salem-shirt-design-v1`), text/image layers per shirt side, PNG preview download, and `aria-live` announcements. Both scripts are copied to `docs/` via `resources:` in `shop.qmd`'s front matter.

**Forms.** The shop quote form validates client-side and is not connected to anything (see the quote handler at the end of `customizer.js`). The subscribe form is the Salem list, below.

## Salem list (subscription system, decided Nov 2026)

**Backend: Google Sheet + Apps Script web app.** Deployed with Execute as: Me, Access: Anyone. URL lives only in `assets/js/config.js` (`window.SALEM_API_URL`).
- Sheet "Salem — Subscribers", tab **`Subscribers`**, columns A–P plain text: `id | token | firstName | lastName | email | phone | birthdayMonth | birthdayDay | interests | heardAbout | consent | consentAt | status | createdAt | updatedAt | unsubscribedAt`.
- Script Properties: `SITE_URL` (no trailing slash), `OWNER_EMAIL`.
- Source of truth: **`apps-script/Code.gs`**. After editing it, Isai pastes it into the Apps Script editor, runs `authorizeOnce` if new permissions are needed, then Deploy → Manage deployments → Edit → **New version** (keeps the same URL; never "New deployment"). Check the live version with a GET to the URL: it should return `{"ok":true,"service":"salem-subscribe",...}`.
- Emails go out with MailApp (~100 recipients/day on a consumer Gmail account). Welcome and "your links" emails link to `unsubscribe.html?token=` and `preferences.html?token=`.
- Newsletters (added Nov 2026): Salem writes them in a **`Newsletter`** tab (labels in column A, values in B) and sends from the sheet's "Salem list" menu (`onOpen`): preview to `OWNER_EMAIL`, then confirm + `sendNewsletter`. Over the daily quota, a 9am daily trigger continues it; progress is tracked by subscriber id in a hidden `Newsletter log` tab and cleared when done. `MAILING_ADDRESS` is an optional Script Property: Salem chose not to publish an address (Nov 2026), so footers fall back to "Chicago, Illinois". Don't make it required again unless asked.

**Rules.** Email is the ONLY unique identifier (trimmed + lowercased); phone is optional, stored as digits only (leading US "1" dropped), and may repeat. Status is `active` (old rows may say `subscribed`). **Unsubscribing deletes the row** (Isai's decision, Nov 2026: no details are kept after someone leaves); rejoining creates a fresh row. Welcome/alert/links emails run through `trySend_`, so a mail failure is logged in Executions but never fails the request (the row is already saved by then).

**API contract.** `fetch(URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ... }) })`. text/plain avoids a CORS preflight, which Apps Script can't answer. `GET /exec` returns health JSON.

| action | body | responses (`status`) |
|---|---|---|
| `subscribe` | firstName, lastName, email, phone?, birthdayMonth?, birthdayDay?, interests[], heardAbout?, consent:true, website (honeypot, must be empty) | `created`, `resubscribed`, `exists`; or `{ok:false, error:"validation", fields:{name:msg}}` |
| `unsubscribe` | token (deletes the row) | `unsubscribed`, `not_found` |
| `get_preferences` | token | `found` (+ firstName, interests[]), `not_found` |
| `unsubscribe_by_email` | firstName, lastName, email, website (honeypot) — deletes the row only if all three match (case-insensitive names); 5 tries per email per hour | always `unsubscribed` (never reveals a match); or `validation` |
| `update_interests` | token, interests[] | `updated`, `not_found` |
| `resend_link` | email | always `ok` (never reveals whether someone is subscribed) |

Errors: `{ok:false, error:"server_error"|"busy"|"bad_request", message}`. The client adds `timeout` (15s) and `network`.

**Frontend.**
- `assets/js/subscriber-store.js` (`window.SalemList`): every API call goes through it, with a 15s timeout and a localStorage stand-in when `SALEM_API_URL` is empty. It also handles the `?token=` hand-off (`takeToken`: saved to sessionStorage, stripped with `history.replaceState`), the homepage/post "Count me in" boxes (`form[data-list-handoff]` carries the email in sessionStorage, not the URL), and the shared "Email me a fresh link" forms (`[data-resend-form]`). Pages load `config.js` then `subscriber-store.js` with a `?v=` cache-buster; bump it in every page and `_partials/salem-footer.html` whenever either file changes, or browsers keep running the old copy.
- `subscribe.qmd`: keeps all existing fields. States follow Figma "Salem — Subscribe form states" (node 27:28499): Error, Loading, Already subscribed ("Email me my preferences link" → `resend_link`), Success → redirect to `subscribed.html`. The New/Returning audience toggle and "What have you printed with us?" are not sent (the sheet has no columns for them).
- `subscribed.qmd`: "You are subscribed to Salem Custom Screen Printing." (+ "Welcome back" on resubscribe), personalized from sessionStorage.
- `unsubscribe.qmd`: without a token it shows a first name / last name / email form (`unsubscribe_by_email`), so people can leave without the email link; with a token it shows a confirm button first (never unsubscribe on page load, because email scanners open links), then the Figma "You're off the list." view (node 27:27246 desktop / 27:28207 mobile).
- `preferences.qmd`: edit interest chips.
- The three pages above use `body-classes: salem-home salem-about salem-list-page` and `header-includes` for `noindex` (+ `no-referrer` on the token pages). Use `header-includes`, not `include-in-header`, in page front matter: the latter replaces the site-wide Google Fonts include. Styles: the "Salem list" section at the end of `styles.css`.

## Future ideas (not now)

Order page with payment (Zelle), drag-and-drop shirt designer, RSS-triggered post emails, possibly Supabase/Netlify once Salem has its own domain. The owner wants the focus on existing customers and a simple web presence for now.

## Project subagents

`.claude/agents/site-checker.md` (pre-publish health check) and `.claude/agents/a11y-reviewer.md` (WCAG 2.2 AA review) are read-only reviewers tailored to this site.
