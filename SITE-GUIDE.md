# Salem site guide: themes, languages and checks

How light and dark mode, English and Spanish, and the automatic accessibility check work, and how to change them. This guide isn't published: Quarto only publishes `.qmd` files.

## Light and dark mode

- `_quarto.yml` gives Quarto two themes: `assets/scss/salem-light.scss` and `assets/scss/salem-dark.scss`. These set Bootstrap's own colors (page background, text, links, form fields).
- With `respect-user-color-scheme: true`, a first-time visitor gets whatever their phone or computer uses.
- Quarto adds `quarto-dark` to `<body>` before the page draws, so there's no flash of the wrong theme.
- Everything Salem-specific is colored in `styles.css`.

### Changing colors

All colors live at the top of `styles.css`, in the "Salem design tokens" section:

- **`:root { ... }`**: the light theme. The palette is `--salem-navy`, `--salem-blue` and so on. The *role* tokens below them say where each color is used:

  | Token | Used for |
  |---|---|
  | `--salem-page` | Page background |
  | `--salem-ink` | Main text |
  | `--salem-surface` | Cards and inputs |
  | `--salem-accent` | Links and accents |
  | `--salem-button` / `--salem-on-button` | Filled buttons and their text |
  | `--salem-band` / `--salem-on-band` | Navy sections such as the footer and offers |
  | `--salem-field-line` | Form borders |

- **`body.quarto-dark { ... }`**: the same tokens with dark values (navy `#041E42`, cards `#0B2A55`, text white, secondary text `#B0B7BC`, links `#8DB4F0`, silver buttons with navy text).

Rules for new CSS:

- Use the role tokens (`var(--salem-ink)`), never a raw hex code. Then both themes work automatically.
- If you need a color only one theme should have, add it to both blocks.
- Check contrast before you ship. Text needs **4.5:1** against its background; large headings, icons and input borders need **3:1**. https://webaim.org/resources/contrastchecker/ works well.
- Never put `#003594`-style dark blue on the navy dark background.

Post themes (`post-rooted`, `post-fall`, …) have their own colors in the "Blog post layouts" section:

- `--post-accent` is the colored panel background.
- `--post-accent-text` is the accent used as text.
- A dark version of each sits on the line below (`body.quarto-dark.post-fall { ... }`).

### The settings (gear) button

`_partials/site-settings.html` is loaded on every page. It adds the "Español"/"English" link and the gear button to the header. The panel has three settings:

- **Appearance**: Light, Dark or Auto. This uses Quarto's own saved setting (`quarto-color-scheme` in the browser's storage). Auto removes it, so the site follows the device again.
- **Language**: links to the same page in the other language.
- **Text size**: Normal or Larger. Larger makes every font size 15% bigger: font sizes in `styles.css` are written as `calc(14px * var(--salem-text-scale, 1))`. Write new font sizes the same way.

The panel works with a keyboard: Tab to the gear, then Enter. Escape closes it and puts focus back on the gear. The panel's words are translated in the same file.

## English and Spanish

The Spanish site is a copy of the English site under `es/`, with the same file names:

| English | Spanish |
|---|---|
| `shop.qmd` | `es/shop.qmd` |
| `posts/Rooted/index.qmd` | `es/posts/Rooted/index.qmd` |

- **`es/_metadata.yml`** sets `lang: es` for everything in `es/`. That gives the pages `<html lang="es">`.
- **`assets/lua/i18n.lua`** checks whether a page's twin exists in the other language. If it does, it adds `hreflang` links (for Google) and tells the header's language link where to go. A page without a twin links to the other language's home page.
- **The menu** is shared by both languages. On Spanish pages, `site-settings.html` translates its labels and points its links at the `es/` pages.
- **Scripts** keep their messages in `en:` / `es:` dictionaries and pick one from `<html lang>`:
  - `assets/js/*-page.js` for each page, plus the shared messages in `subscriber-store.js`
  - `shop/customizer.js` for the shirt designer
  - `shop/shirt-styles.js` holds `es: {...}` names for styles and colors
- **Feeds**: the Spanish journal has its own feed at `es/index.xml`. The newsletter-draft job reads only the English feed (`index.xml`).
- **Emails**: people who sign up on a Spanish page get Spanish emails (`lang` column in the sheet).
- **Form values** go to the sheet in English on both sites (interests, birthday month, "how did you hear"). Only the labels people see are Spanish, so the sheet and newsletter audiences don't care which site someone used.

### Adding a post in both languages

1. Write the English post as usual: `posts/My-Post/index.qmd`, its thumbnail, and a `photos/` folder. Add `image-alt:` to the front matter, describing the thumbnail for screen readers.
2. Copy it to `es/posts/My-Post/index.qmd`. Use the **same folder name**; that's how the two are paired.
3. Translate the title, description, text, captions and every `fig-alt`. Translate the category too: Sale → Ofertas, Mission → Misión. Keep prices, dates and links the same.
4. Don't copy the photos. Point at the English post's files with three `../`:
   - `image: ../../../posts/My-Post/thumb.jpg`
   - `![Pie de foto](../../../posts/My-Post/photos/photo-1.png){fig-alt="..."}`
5. Links to site pages stay relative (`../../shop.html`), so they go to the Spanish pages.
6. Run `quarto render`, then check both journals and the "Español" link on the new post.

### Changing a page's text

Change the English page and its `es/` copy together. Footers are written into each page, so keep the links in sync:

- English pages and `_partials/salem-footer.html`
- Spanish pages and `_partials/es/salem-footer.html`

`TRANSLATION-REVIEW.md` lists everything a Spanish reviewer should check.

## Reading the accessibility check

`.github/workflows/accessibility.yml` runs on every push to `master` that changes `docs/`.

- It serves the rendered site and checks it with [pa11y-ci](https://github.com/pa11y/pa11y-ci) and the axe engine against **WCAG 2 AA**, at phone width.
- It covers the home and subscribe pages in English and Spanish.
- It runs twice: **light** (`.github/pa11y/light.json`) and **dark** (`.github/pa11y/dark.json`).

To read the results:

1. On GitHub, open the **Actions** tab, or click the ✓ / ✗ next to a commit.
2. Open the **Accessibility** run. There are two jobs, "WCAG AA (light mode)" and "WCAG AA (dark mode)". A red ✗ on either means it found at least one error.
3. Open the failing job and expand **Check pages**. Each page is listed with its result:

   ```
    > http://localhost:8080/es/subscribe.html - 1 errors

    Errors in http://localhost:8080/es/subscribe.html:

     • Elements must meet minimum color contrast ratio thresholds
       (https://dequeuniversity.com/rules/axe/4.10/color-contrast)
       (.btn-accent)
       <a class="btn-accent" href="...">Únase…</a>
   ```

   - The first line names the problem, and the link explains it with examples.
   - The line in brackets is a CSS selector that finds the element.
   - The last line is the start of the element's HTML.
4. Common errors and their fixes:

   | Error | Fix |
   |---|---|
   | **color-contrast** | Change the color tokens in `styles.css`, in the theme that failed (see "Changing colors" above) |
   | **label** / **select-name** | A form field has no `<label for="...">` or `aria-label` |
   | **image-alt** | An `<img>` has no `alt`, or a Markdown image has no `fig-alt`. Use `alt=""` only for decorative icons |
   | **aria-…** | An ARIA attribute is misspelled or not allowed on that element |

5. Fix the source, run `quarto render`, commit the source and `docs/` together, and push. The check runs again.

To run it on demand: Actions → Accessibility → **Run workflow**.

The check covers four pages. Other pages (shop, posts) use the same styles, but it's still worth looking at them in both themes after big changes.
