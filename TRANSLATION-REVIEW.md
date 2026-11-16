# Spanish translation review

A checklist for a fluent Spanish speaker. The Spanish site lives in `es/` and mirrors the English site page for page. It aims for warm, neutral Latin American Spanish that addresses the reader as **usted**.

**How to review:**

- Open each page live, or read the source file listed beside it.
- Tick the box when the page reads naturally.
- Write corrections next to the item, or edit the file directly. Keep prices, minimums, dates and links exactly as they are.
- Items marked ⚠️ are the ones I'm least sure about. Start with those.

Live site: `https://iquinones2.github.io/Salem-Blog/es/`

## Decisions to confirm first (they repeat across many pages)

- [ ] ⚠️ **"camiseta"** for shirt / T-shirt. In Mexico, "playera" is more common. "Camiseta" is understood everywhere, so I used it. If Salem's customers are mostly Mexican, consider "playera" throughout.
- [ ] ⚠️ **"diario"** for "the journal" (the blog). Alternatives: "blog", "bitácora", "historias". It appears in the menu, footer, post byline ("← Volver al diario") and home page.
- [ ] ⚠️ **"taller"** for "studio" (the print shop). "Estudio" sounds more like an art or photo studio.
- [ ] ⚠️ **"Hecho con cariño. Llevado con propósito."** for "Made with care. Worn with purpose." The footer tagline is on every page. "Llevado" (worn) may sound odd. An alternative is "Hecho con cariño. Vestido con propósito."
- [ ] **"Únase a la lista de Salem"** for "Join the Salem list". It appears in the menu, footer and forms.
- [ ] **"Escríbale a Salem"** for "Message Salem" / "Chat with Salem". It appears on the chat button and post buttons. "Escríbale a Salem para hacer su pedido" = "Message Salem to order".
- [ ] **"Inscríbame"** for the "Count me in" button.
- [ ] **"costo de preparación"** for "setup fee".
- [ ] ⚠️ Gender: I avoided gendered words where possible ("¿Primera vez con Salem?", "Le damos la bienvenida", "Su suscripción está activa"). Check that nothing reads as only masculine or feminine.
- [ ] Brand name **Salem Custom Screen Printing** and the logo text "CUSTOM SCREEN PRINTING" stay in English. They're marked `lang="en"` so screen readers pronounce them in English.

## Pages

| ✓ | Page | Source file | Notes |
|---|---|---|---|
| [ ] | Home | `es/index.qmd` | ⚠️ "TINTA FRESCA. AIRE DE OTOÑO." (Fresh ink. Fall feeling.) and "Describa, cotice y recoja." (Describe, quote, and pick up.) |
| [ ] | About | `es/about.qmd` | "Más que tinta." (More than ink.) |
| [ ] | Shop (shirt designer) | `es/shop.qmd` | ⚠️ "racleta" (squeegee) in photo descriptions, "REUNIDOS EN SU GRACIA" (sample shirt text for "GATHER IN GRACE"), "Prenda" (Garment), "Empezar de nuevo" (Reset) |
| [ ] | Join the list | `es/subscribe.qmd` | Interest labels must match the emails (see "Emails" below) |
| [ ] | You're on the list | `es/subscribed.qmd` | |
| [ ] | Unsubscribe | `es/unsubscribe.qmd` | "Darse de baja" on the site. ⚠️ The emails say "Cancelar suscripción". Choose one? |
| [ ] | Preferences | `es/preferences.qmd` | |
| [ ] | Journal listing | `es/index.qmd` + `es/journal.ejs` | Category names: ⚠️ "Ofertas" (Sale), "Misión" (Mission). "Rooted" stays in English because it's the event's name |
| [ ] | Post: ¡Adelántese a las fiestas! | `es/posts/Christmas-Bundle/index.qmd` | ⚠️ "Sudaderas a juego" (matching sweatshirts). The flyer image itself is in English |
| [ ] | Post: ¡Llegó el otoño! | `es/posts/October-Sale/index.qmd` | ⚠️ "Producción rápida" for "Fast turnaround". The flyer image is in English |
| [ ] | Post: Evento Rooted | `es/posts/Rooted/index.qmd` | ⚠️ The verse uses **Reina-Valera 1960** (Colosenses 2:6–7), because the English uses the KJV. Confirm that's the version Salem wants. ⚠️ "Crezca profundo antes de crecer alto." |
| [ ] | Post: La misión de Salem | `es/posts/Salems-Mission/index.qmd` | "Arraigados en la fe" (Rooted in faith) |
| [ ] | Footer and newsletter box on posts | `_partials/es/salem-footer.html`, `_partials/es/title-block.html` | |

## Messages people see only sometimes (inside scripts)

These show up after an action (sending a form, an error, a loading state). Each file has an `en:` and an `es:` block next to each other. Only edit the `es:` block.

- [ ] Shared messages: `assets/js/subscriber-store.js` (`MESSAGES.es`): connection errors, "Enviando…", fresh-link confirmation
- [ ] Join form: `assets/js/subscribe-page.js`: validation, "Usted ya está en la lista.", loading and errors. ⚠️ "Qué gusto verle de nuevo." (Welcome back, for returning customers)
- [ ] Unsubscribe: `assets/js/unsubscribe-page.js`
- [ ] Preferences: `assets/js/preferences-page.js`
- [ ] Subscribed: `assets/js/subscribed-page.js`
- [ ] Journal filter: `assets/js/journal-page.js` ("Todas")
- [ ] Shirt designer announcements and summary: `shop/customizer.js` (the `es:` block near the top). ⚠️ "Imagen" for "Artwork" (an uploaded design)
- [ ] Shirt style and color names: `shop/shirt-styles.js` (the `es: { ... }` entries). ⚠️ "Mezclilla" (Denim), "Óxido" (Rust), "Verde salvia" (Sage)
- [ ] Header settings panel and Spanish menu: `_partials/site-settings.html`: "Configuración", "Apariencia: Claro / Oscuro / Automático (según su dispositivo)", "Tamaño del texto: Normal / Más grande", menu "Tienda · Diario · Nosotros · Únase a la lista de Salem"

## Emails (Apps Script)

- [ ] `apps-script/Code.gs`, the `STRINGS.es` block near the top: welcome email, "your links" email, footer. After changes, paste into the Apps Script editor and Deploy → Manage deployments → Edit → New version.
- [ ] ⚠️ The fallback greeting uses "amigo" when there is no first name. Consider a neutral option ("Hola:", or "Hola, amistad").
- [ ] Interest names in `STRINGS.es.interests` must match the chips on `es/subscribe.qmd` and `es/preferences.qmd` word for word: Camisetas individuales · Pedidos para equipos y grupos · Eventos de iglesia y de jóvenes · Recaudación de fondos · Regalos personales · Otros eventos.

## Image descriptions (alt text): please review both languages

These describe images for screen readers. They're written in both languages; check the Spanish and the facts.

| Image | English | Spanish |
|---|---|---|
| Journal card, Christmas post | Three holiday sweatshirt designs from the Family Christmas Bundle | Tres diseños de sudaderas navideñas del Paquete Familiar de Navidad |
| Journal card, October post | Custom shirts in fall colors for the October sale | Camisetas personalizadas en colores de otoño para la oferta de octubre |
| Journal card, Rooted post | The charcoal Rooted event tee | La camiseta gris carbón del evento Rooted |
| Journal card, Mission post | Salem Custom Screen Printing laurel logo | Logotipo de laureles de Salem Custom Screen Printing |
| Christmas flyer | Family Christmas Bundle flyer showing three holiday sweatshirt designs and a $100 price | Volante del Paquete Familiar de Navidad (en inglés) con tres diseños de sudaderas navideñas y un precio de $100 |
| October flyer | October Sale flyer: custom t-shirts, one ink color, one side, $16.50 per shirt | Volante de la oferta de octubre (en inglés): camisetas personalizadas, un color de tinta, un lado, $16.50 por camiseta |

The card descriptions live in each post's front matter as `image-alt:`. The flyer descriptions are the `fig-alt` on the flyer image.
