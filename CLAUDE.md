# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Quarto static website and journal for Salem Custom Screen Printing (Chicago). Live at https://iquinones2.github.io/Salem-Blog/. The site is informational only — there is no checkout, cart, or order handling. The shop customizer and the forms never charge or send anything; ordering happens by messaging Salem (Instagram DM). Keep wording consistent with that (e.g. "Message Salem to order", not "Buy now").

## Commands

```bash
quarto preview              # live-reloading local server
quarto render               # build the whole site into docs/
quarto render shop.qmd      # re-render a single page
```

There is no package manager, linter, build step, or test suite. Verify changes by rendering and checking the output in `docs/` (or in the browser via `quarto preview`).

## Publishing

- GitHub Pages serves the committed `docs/` folder from `master`. `docs/` is generated — never edit it by hand; fix the source and re-render.
- Commit source changes and the re-rendered `docs/` together, in one commit.
- `_quarto.yml` renders only `*.qmd` files, so `readme.md` (the GitHub README) is not published. Files Quarto can't discover through references must be listed under `project: resources:` (e.g. `images/icons/sprout.svg`, used only by the journal template's no-thumbnail fallback).

## Architecture

**Pages are mostly raw HTML.** `index.qmd`, `about.qmd`, `shop.qmd`, and `subscribe.qmd` use `page-layout: custom` and put their markup in ```` ```{=html} ```` blocks, with inline `<script>` for behavior. Each page's `body-classes` (`salem-home`, `salem-about`, `salem-shop`, `salem-subscribe`) scopes its CSS. Their footers are written inline per page, separately from the post footer partial — keep footer links in sync across `index.qmd`, `about.qmd`, `shop.qmd`, `subscribe.qmd`, and `_partials/salem-footer.html`.

**Journal.** `index.qmd` defines a Quarto listing over `posts/` rendered with the custom `journal.ejs` template. Quarto's own sort/filter UI is disabled; an inline script at the bottom of `index.qmd` builds the category filter pills and the sort dropdown from `data-cats` / `data-title` / `data-listing-date-sort` attributes the template emits. Posts without `image` get the sprout "mission artwork" card.

**Posts.** Each post is `posts/<Post-Name>/index.qmd` with its thumbnail and a `photos/` folder. `posts/_metadata.yml` applies to all posts: `freeze: true`, `body-classes: salem-post`, the custom title block (`_partials/title-block.html`) and footer/newsletter (`_partials/salem-footer.html`). Partial paths are relative to `posts/<post>/` (`../../`). Front matter: `title`, `author`, `date` (`YYYY-MM-DD`), `image`, `description`, `categories`, and `body-classes: salem-post post-<theme>`. The `post-<theme>` class sets `--post-accent` / `--post-soft` in `styles.css` ("Blog post layouts" section) — add a new class there for a new post theme. Content uses Pandoc divs such as `.post-wide`, `.post-photo`, `.verse-banner`, `.section-label`; images need `fig-alt`.

**Styles.** Everything lives in `styles.css` on top of the `lux` theme. Design tokens (`--salem-*` colors and fonts) are in the `:root` block under "Salem design tokens"; the file is organized in banner-commented sections per page (Homepage, Blog posts, About, Shop, Join the Salem list). Later sections build on earlier ones (Shop reuses About layout; Subscribe reuses Shop form fields), so check shared selectors before changing them. Fonts load from Google Fonts in `_quarto.yml`.

**Shop customizer.** `shop/shirt-styles.js` is pure data (`window.SALEM_SHIRT_STYLES`, `window.SALEM_INK_COLORS`): styles, sizes, mockup images in `images/shop/`, print areas as fractions of the preview, and color swatches — adding a style or color only requires editing this file. `shop/customizer.js` is a dependency-free IIFE that reads that data and drives the markup in `shop.qmd`: a single `state` object mutated through `change()` with undo history, persisted to `localStorage` (`salem-shirt-design-v1`), text/image layers per shirt side, PNG preview download, and `aria-live` announcements. Both scripts are copied to `docs/` via `resources:` in `shop.qmd`'s front matter.

**Forms.** The subscribe form (`subscribe.qmd`) and the shop quote form validate client-side and show an on-page confirmation only; neither is connected to a backend yet (see the `TODO` in `subscribe.qmd` and the quote handler at the end of `customizer.js`).

## Project subagents

`.claude/agents/site-checker.md` (pre-publish health check) and `.claude/agents/a11y-reviewer.md` (WCAG 2.2 AA review) are read-only reviewers tailored to this site.
