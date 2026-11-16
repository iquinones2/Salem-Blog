/**
 * Salem Subscribe API — Google Apps Script
 * Bound to the Google Sheet "Salem — Subscribers" (tab: "Subscribers").
 *
 * This file is the source of truth. After editing it, paste it into the
 * Apps Script editor, run authorizeOnce if new permissions are needed, then
 * Deploy → Manage deployments → Edit → New version (keeps the same URL).
 *
 * Actions (POST, JSON body sent as text/plain from the website):
 *   subscribe, unsubscribe, get_preferences, update_interests, resend_link
 * GET /exec returns a small health-check JSON.
 *
 * Email is the only unique identifier. Phone is optional and may repeat.
 * Unsubscribing deletes the row. Email failures are logged, never returned as errors.
 *
 * Newsletters: written in the "Newsletter" tab and sent from the sheet's
 * "Salem list" menu (see the Newsletter section below).
 *
 * Automations (see the Automation section): Settings tab, Agent Log tab,
 * askClaude_ (optional AI help), installTriggers.
 *
 * Script Properties used: SITE_URL, OWNER_EMAIL, MAILING_ADDRESS (optional),
 * ANTHROPIC_API_KEY (optional; only ever stored here, never in the website code)
 * (NEWSLETTER_CAMPAIGN is set and cleared by the script while a newsletter sends.
 *  LAST_POST_LINK, LAST_POST_DATE, AI_OFF_NOTED, NEWSLETTER_STARTED and STATS_yyyy-MM
 *  monthly counters are kept by the automations.)
 */

const SHEET_NAME = "Subscribers";
const HEADERS = [
  "id", "token", "firstName", "lastName", "email", "phone",
  "birthdayMonth", "birthdayDay", "interests", "heardAbout",
  "consent", "consentAt", "status", "createdAt", "updatedAt", "unsubscribedAt"
];
// Added later; table_() creates them if missing. lang: "en" or "es" (blank = en).
const OPTIONAL_HEADERS = ["lang"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BRAND = "Salem Custom Screen Printing";

/* ------------------------------------------------------------------ */
/* Email text in English and Spanish. Edit wording here.               */
/* ------------------------------------------------------------------ */
// {firstName} is replaced with the subscriber's first name.
// Interest values are stored in English in the sheet (they double as
// newsletter audiences); "interests" below only changes how they're shown.
// Spanish: neutral Latin American, "usted". Listed in TRANSLATION-REVIEW.md.
const STRINGS = {
  en: {
    langName: "English",
    city: "CHICAGO, ILLINOIS",
    tagline: "Custom shirts, made with care.",
    whyYouGetThis: "You're receiving this because you joined the Salem list.",
    unsubscribe: "Unsubscribe",
    updateInterests: "Update interests",
    signoff: "Made with care. Worn with purpose.",
    friend: "friend",
    readMore: "Read the full story",
    previewTag: "[Preview]",
    welcome: {
      subject: "Welcome to the Salem circle",
      kicker: "GOOD THINGS, IN YOUR INBOX",
      heading: "Welcome to the Salem circle.",
      hello: "Hello, {firstName}. Thanks for joining the Salem list. We're a small, faith-driven custom apparel business in Chicago, and we're glad you're here.",
      expect: "Expect studio stories, seasonal offers, and a little inspiration. Every shirt we print carries more than ink — it carries a message.",
      interestsLabel: "YOUR INTERESTS",
      journalButton: "Explore the Salem journal",
      shopButton: "Start a shirt idea"
    },
    links: {
      subject: "Your Salem list links",
      heading: "Your Salem list links",
      body: "Hi {firstName}, you're already on the Salem list. Use these links to update what you hear about, or to leave the list.",
      preferencesButton: "Update my interests",
      unsubscribeButton: "Unsubscribe"
    },
    interests: {}
  },
  es: {
    langName: "Español",
    city: "CHICAGO, ILLINOIS",
    tagline: "Camisetas personalizadas, hechas con cariño.",
    whyYouGetThis: "Recibe este correo porque se unió a la lista de Salem.",
    unsubscribe: "Cancelar suscripción",
    updateInterests: "Actualizar intereses",
    signoff: "Hecho con cariño. Llevado con propósito.",
    friend: "amigo",
    readMore: "Leer la historia completa",
    previewTag: "[Vista previa]",
    welcome: {
      subject: "Le damos la bienvenida al círculo de Salem",
      kicker: "COSAS BUENAS, EN SU BANDEJA DE ENTRADA",
      heading: "Le damos la bienvenida al círculo de Salem.",
      hello: "Hola, {firstName}. Gracias por unirse a la lista de Salem. Somos un pequeño negocio de ropa personalizada en Chicago, guiado por la fe, y nos alegra mucho que esté aquí.",
      expect: "Le compartiremos historias del taller, ofertas de temporada y un poco de inspiración. Cada camiseta que imprimimos lleva más que tinta: lleva un mensaje.",
      interestsLabel: "SUS INTERESES",
      journalButton: "Explorar el diario de Salem",
      shopButton: "Empezar a diseñar una camiseta"
    },
    links: {
      subject: "Sus enlaces de la lista de Salem",
      heading: "Sus enlaces de la lista de Salem",
      body: "Hola, {firstName}: usted ya está en la lista de Salem. Use estos enlaces para elegir sobre qué desea recibir noticias o para salir de la lista.",
      preferencesButton: "Actualizar mis intereses",
      unsubscribeButton: "Cancelar suscripción"
    },
    interests: {
      "Individual shirts": "Camisetas individuales",
      "Team and group orders": "Pedidos para equipos y grupos",
      "Church and youth events": "Eventos de iglesia y de jóvenes",
      "Fundraisers": "Recaudación de fondos",
      "Personal gifts": "Regalos personales",
      "Other events": "Otros eventos"
    }
  }
};

/** "es" for Spanish, otherwise "en" (old rows and old pages send nothing). */
function langOf_(v) {
  return /^es\b/i.test(String(v == null ? "" : v).trim()) ? "es" : "en";
}
function strings_(lang) { return STRINGS[langOf_(lang)]; }
function fill_(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));
}
function interestName_(value, lang) { return strings_(lang).interests[value] || value; }

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, service: "salem-subscribe", time: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try {
    body = parseBody_(e);
  } catch (err) {
    return json_({ ok: false, error: "bad_request", message: "We couldn't read that request." });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: "busy", message: "Salem is busy right now. Please try again in a moment." });
  }

  try {
    switch (body.action || "subscribe") {
      case "subscribe":        return json_(subscribe_(body));
      case "unsubscribe":      return json_(unsubscribe_(body));
      case "unsubscribe_by_email": return json_(unsubscribeByEmail_(body));
      case "get_preferences":  return json_(getPreferences_(body));
      case "update_interests": return json_(updateInterests_(body));
      case "resend_link":      return json_(resendLink_(body));
      default:
        return json_({ ok: false, error: "unknown_action", message: "Unknown request." });
    }
  } catch (err) {
    console.error("Salem API error: " + (err && err.message));
    return json_({ ok: false, error: "server_error", message: "Something went wrong on our side. Please try again." });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function subscribe_(b) {
  // Honeypot: bots fill hidden fields. Pretend success, save nothing.
  if (clean_(b.website)) return { ok: true, status: "created" };

  const firstName = clean_(b.firstName, 60);
  const lastName = clean_(b.lastName, 60);
  const email = normEmail_(b.email);
  const phone = normPhone_(b.phone);

  const fields = {};
  if (!firstName) fields.firstName = "Enter your first name.";
  if (!lastName) fields.lastName = "Enter your last name.";
  if (!EMAIL_RE.test(email)) fields.email = "Enter a complete email address, such as you@example.com.";
  if (phone && (phone.length < 10 || phone.length > 15)) fields.phone = "Enter a full phone number, or leave it blank.";
  if (!isYes_(b.consent)) fields.consent = "Please check the box to agree to emails.";
  if (Object.keys(fields).length) {
    return { ok: false, error: "validation", fields: fields, message: "Please check the highlighted fields." };
  }

  const t = table_();
  const now = new Date().toISOString();
  const matches = r => r.data.email === email;

  // Already an active subscriber? Say so, but reveal nothing about them.
  if (t.rows.some(r => isActive_(r.data.status) && matches(r))) {
    return { ok: true, status: "exists" };
  }

  const interests = toList_(b.interests);
  const fresh = {
    token: Utilities.getUuid(),
    firstName: firstName,
    lastName: lastName,
    email: email,
    phone: phone,
    birthdayMonth: clean_(b.birthdayMonth, 20),
    birthdayDay: String(b.birthdayDay || "").replace(/\D/g, "").slice(0, 2),
    interests: interests.join(", "),
    lang: langOf_(b.lang), // from the page's <html lang>; missing = English
    heardAbout: clean_(b.heardAbout, 60),
    consent: "yes",
    consentAt: now,
    status: "active",
    updatedAt: now,
    unsubscribedAt: ""
  };

  // Old row left over from before unsubscribing deleted rows? Reuse it.
  const old = t.rows.find(matches);
  if (old) {
    const merged = Object.assign({}, old.data, fresh);
    writeRow_(t, old.rowNumber, merged);
    countEvent_("joined");
    trySend_("welcome", () => sendWelcome_(merged));
    return { ok: true, status: "resubscribed" };
  }

  const record = Object.assign({ id: Utilities.getUuid(), createdAt: now }, fresh);
  writeRow_(t, t.sh.getLastRow() + 1, record);
  countEvent_("joined");
  // The row is saved at this point: an email failure must not turn that into an error.
  trySend_("welcome", () => sendWelcome_(record));
  trySend_("owner alert", () => sendOwnerAlert_(record));
  return { ok: true, status: "created" };
}

// Unsubscribing deletes the subscriber's row, so none of their details stay in the sheet.
function unsubscribe_(b) {
  const token = clean_(b.token, 64);
  if (!token) return { ok: true, status: "not_found" };
  const t = table_();
  const row = t.rows.find(r => r.data.token === token);
  if (!row) return { ok: true, status: "not_found" };
  t.sh.deleteRow(row.rowNumber);
  countEvent_("unsubscribed"); // a number for the monthly report; nothing about the person
  return { ok: true, status: "unsubscribed" };
}

// Unsubscribe from the website form (no email link needed). Email plus first
// and last name must all match, so a stranger who only knows an address can't
// remove someone. The answer is the same whether or not anything matched, so
// the form never reveals who is on the list. Attempts per email are rate-limited.
function unsubscribeByEmail_(b) {
  const done = { ok: true, status: "unsubscribed" };
  if (clean_(b.website)) return done; // honeypot

  const email = normEmail_(b.email);
  const firstName = clean_(b.firstName, 60).toLowerCase();
  const lastName = clean_(b.lastName, 60).toLowerCase();

  const fields = {};
  if (!firstName) fields.firstName = "Enter your first name.";
  if (!lastName) fields.lastName = "Enter your last name.";
  if (!EMAIL_RE.test(email)) fields.email = "Enter a complete email address, such as you@example.com.";
  if (Object.keys(fields).length) {
    return { ok: false, error: "validation", fields: fields, message: "Please check the highlighted fields." };
  }

  const cache = CacheService.getScriptCache();
  const key = "unsub_" + Utilities.base64EncodeWebSafe(email).slice(0, 200);
  const tries = Number(cache.get(key) || 0);
  if (tries >= 5) return done; // 5 tries per email per hour
  cache.put(key, String(tries + 1), 3600);

  const t = table_();
  const row = t.rows.find(r =>
    r.data.email.trim().toLowerCase() === email &&
    r.data.firstName.trim().toLowerCase() === firstName &&
    r.data.lastName.trim().toLowerCase() === lastName
  );
  if (row) {
    t.sh.deleteRow(row.rowNumber);
    countEvent_("unsubscribed");
  }
  return done;
}

function getPreferences_(b) {
  const row = findActiveByToken_(table_(), b.token);
  if (!row) return { ok: true, status: "not_found" };
  return {
    ok: true, status: "found", firstName: row.data.firstName,
    interests: toList_(row.data.interests), lang: langOf_(row.data.lang)
  };
}

function updateInterests_(b) {
  const t = table_();
  const row = findActiveByToken_(t, b.token);
  if (!row) return { ok: true, status: "not_found" };
  const changes = { interests: toList_(b.interests).join(", "), updatedAt: new Date().toISOString() };
  if (b.lang != null && String(b.lang).trim()) changes.lang = langOf_(b.lang); // optional: email language
  writeRow_(t, row.rowNumber, Object.assign({}, row.data, changes));
  return { ok: true, status: "updated" };
}

function resendLink_(b) {
  const email = normEmail_(b.email);
  if (EMAIL_RE.test(email)) {
    const cache = CacheService.getScriptCache();
    const key = "resend_" + Utilities.base64EncodeWebSafe(email).slice(0, 200);
    if (!cache.get(key)) {
      const row = table_().rows.find(r => isActive_(r.data.status) && r.data.email === email);
      if (row) {
        trySend_("links", () => sendLinks_(row.data));
        cache.put(key, "1", 600); // one resend per email per 10 minutes
      }
    }
  }
  // Same answer every time, so nobody can test who is subscribed.
  return { ok: true, status: "ok" };
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function table_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Missing tab "' + SHEET_NAME + '"');
  const lastRow = Math.max(sh.getLastRow(), 1);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const headers = values[0].map(h => String(h).trim());
  HEADERS.forEach(h => {
    if (headers.indexOf(h) === -1) throw new Error("Missing header: " + h);
  });
  // Optional columns added after launch: created automatically at the end of
  // row 1 the first time they're needed. Empty cells mean the default.
  OPTIONAL_HEADERS.forEach(h => {
    if (headers.indexOf(h) !== -1) return;
    let col = headers.length;
    while (col > 0 && !headers[col - 1]) col--; // after the last named column
    sh.getRange(1, col + 1).setValue(h);
    sh.getRange(1, col + 1, sh.getMaxRows(), 1).setNumberFormat("@");
    headers[col] = h;
  });
  const rows = values.slice(1).map((r, i) => {
    const data = {};
    headers.forEach((h, j) => { if (h) data[h] = r[j] == null ? "" : String(r[j]); }); // a just-added column has no cells yet
    return { rowNumber: i + 2, data: data };
  }).filter(r => r.data.id || r.data.email);
  return { sh: sh, headers: headers, rows: rows };
}

function writeRow_(t, rowNumber, record) {
  const line = t.headers.map(h => (h && record[h] != null) ? safeCell_(String(record[h])) : "");
  t.sh.getRange(rowNumber, 1, 1, line.length).setValues([line]);
}

function findActiveByToken_(t, token) {
  token = clean_(token, 64);
  if (!token) return null;
  return t.rows.find(r => r.data.token === token && isActive_(r.data.status)) || null;
}

/* ------------------------------------------------------------------ */
/* Input helpers                                                       */
/* ------------------------------------------------------------------ */

function parseBody_(e) {
  const pd = e && e.postData;
  if (pd && pd.contents && /json|text\/plain/i.test(pd.type || "")) {
    return JSON.parse(pd.contents);
  }
  // Fallback: a regular HTML form post (application/x-www-form-urlencoded)
  const p = Object.assign({}, (e && e.parameter) || {});
  if (e && e.parameters && e.parameters.interests) p.interests = e.parameters.interests;
  return p;
}

function clean_(v, max) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, max || 200);
}
function normEmail_(v) { return clean_(v, 254).toLowerCase(); }
function normPhone_(v) {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  return d;
}
function isYes_(v) { return v === true || /^(yes|true|on|1)$/i.test(String(v || "")); }
function isActive_(s) { return s === "active" || s === "subscribed"; }
function toList_(v) {
  const arr = Array.isArray(v) ? v : String(v || "").split(",");
  return arr.map(x => clean_(x, 60)).filter(Boolean).slice(0, 12);
}
// Stop values like "=IMPORTXML(...)" from running as formulas.
function safeCell_(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */

// Optional postal address for the email footer (Salem chose to leave it out,
// Nov 2026). When empty, footers show "Chicago, Illinois". Note: CAN-SPAM
// expects a postal address in promotional emails; a PO box or virtual mailbox counts.
function mailingAddress_() {
  return String(PropertiesService.getScriptProperties().getProperty("MAILING_ADDRESS") || "").trim();
}

function siteUrl_() {
  const v = PropertiesService.getScriptProperties().getProperty("SITE_URL") || "https://iquinones2.github.io/Salem-Blog";
  return v.replace(/\/+$/, "");
}
function esc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Run an email step without letting it fail the request. Logs the error type
// and message to Executions (no subscriber details are added by us).
function trySend_(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error("Email '" + label + "' failed: " + (err && err.message));
  }
}

function canSend_() {
  if (MailApp.getRemainingDailyQuota() < 1) {
    console.warn("Daily email quota reached; email skipped (row was still saved).");
    return false;
  }
  return true;
}
// Links in the subscriber's language. Spanish pages live under /es/; until
// they're published, Spanish subscribers get the English pages (the email
// text is still Spanish), so no link ever points to a missing page.
function links_(rec) {
  const site = siteUrl_();
  const lang = langOf_(rec.lang);
  const base = lang === "es" && spanishPagesLive_() ? site + "/es" : site;
  const tok = encodeURIComponent(rec.token);
  return {
    lang: lang,
    site: base,
    journal: base + "/index.html#journal",
    shop: base + "/shop.html",
    unsubscribe: base + "/unsubscribe.html?token=" + tok,
    preferences: base + "/preferences.html?token=" + tok
  };
}

// True once SITE_URL/es/unsubscribe.html loads. Checked at most every 6 hours.
function spanishPagesLive_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("es_pages_live");
  if (hit !== null) return hit === "1";
  let live = false;
  try {
    live = UrlFetchApp.fetch(siteUrl_() + "/es/unsubscribe.html", { muteHttpExceptions: true }).getResponseCode() === 200;
  } catch (err) {
    console.warn("Spanish page check failed: " + (err && err.message));
  }
  cache.put("es_pages_live", live ? "1" : "0", live ? 21600 : 1800);
  return live;
}

function button_(href, label, primary) {
  const style = primary
    ? "background:#2f5d8c;color:#ffffff;border:1px solid #2f5d8c;"
    : "background:#ffffff;color:#1c2a42;border:1px solid #1c2a42;";
  return '<tr><td style="padding:6px 0;"><a href="' + esc_(href) + '" style="display:block;text-align:center;' +
    style + 'padding:12px 16px;border-radius:4px;font-size:15px;text-decoration:none;">' + esc_(label) + ' &#8599;</a></td></tr>';
}

// lang: language of the email text (defaults to the links' language).
function emailShell_(inner, l, lang) {
  const S = strings_(lang || l.lang);
  return '<!doctype html><html lang="' + langOf_(lang || l.lang) + '"><body style="margin:0;padding:0;background:#e9ecef;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9ecef;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#f6f5f1;font-family:Helvetica,Arial,sans-serif;color:#1c2a42;">' +
    '<tr><td style="padding:28px 28px 8px;">' +
    '<span style="font-family:Georgia,serif;font-size:26px;letter-spacing:1px;">SALEM</span>' +
    '<span style="font-size:11px;letter-spacing:1px;padding-left:10px;">CUSTOM SCREEN PRINTING</span>' +
    '<div style="font-size:12px;letter-spacing:1px;color:#5b6577;padding-top:8px;">' + esc_(S.city) + '</div></td></tr>' +
    '<tr><td style="padding:16px 28px 28px;">' + inner + '</td></tr>' +
    '<tr><td style="background:#1c2a42;color:#d6dbe4;padding:24px 28px;font-size:12px;line-height:1.6;">' +
    '<strong style="color:#ffffff;font-size:14px;">' + BRAND + '</strong><br>' +
    esc_(mailingAddress_() || "Chicago, Illinois") + ' &middot; ' + esc_(S.tagline) + '<br><br>' +
    esc_(S.whyYouGetThis) + '<br>' +
    '<a href="' + esc_(l.unsubscribe) + '" style="color:#ffffff;">' + esc_(S.unsubscribe) + '</a> &nbsp;&nbsp; ' +
    '<a href="' + esc_(l.preferences) + '" style="color:#ffffff;">' + esc_(S.updateInterests) + '</a>' +
    '</td></tr></table></td></tr></table></body></html>';
}

// Plain-text footer that matches emailShell_.
function textFooter_(l, lang) {
  const S = strings_(lang || l.lang);
  return BRAND + "\n" + (mailingAddress_() || "Chicago, Illinois") + "\n" + S.whyYouGetThis + "\n" +
    S.updateInterests + ": " + l.preferences + "\n" + S.unsubscribe + ": " + l.unsubscribe;
}

function sendWelcome_(rec) {
  if (!canSend_()) return;
  const l = links_(rec);
  const S = strings_(l.lang), W = S.welcome;
  const vars = { firstName: rec.firstName };
  const interests = toList_(rec.interests).map(i => interestName_(i, l.lang));
  const interestHtml = interests.length
    ? '<div style="background:#e9ecef;padding:16px 18px;margin:20px 0;"><div style="font-size:12px;letter-spacing:1px;font-weight:bold;padding-bottom:8px;">' + esc_(W.interestsLabel) + '</div>' +
      interests.map(i => '<div style="font-size:14px;padding:3px 0;">&#10003; ' + esc_(i) + '</div>').join("") + '</div>'
    : "";

  const inner =
    '<div style="font-size:12px;letter-spacing:1px;font-weight:bold;">' + esc_(W.kicker) + '</div>' +
    '<h1 style="font-family:Georgia,serif;font-size:34px;line-height:1.15;margin:14px 0;">' + esc_(W.heading) + '</h1>' +
    '<p style="font-size:16px;line-height:1.6;">' + esc_(fill_(W.hello, vars)) + '</p>' +
    '<p style="font-size:14px;line-height:1.6;">' + esc_(W.expect) + '</p>' +
    interestHtml +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    button_(l.journal, W.journalButton, true) +
    button_(l.shop, W.shopButton, false) + '</table>' +
    '<p style="font-size:14px;line-height:1.6;margin-top:20px;">' + esc_(S.signoff) + '<br>&mdash; Salem</p>';

  const text =
    W.heading + "\n\n" + fill_(W.hello, vars) + "\n\n" + W.expect + "\n\n" +
    (interests.length ? W.interestsLabel + ": " + interests.join(", ") + "\n\n" : "") +
    W.journalButton + ": " + l.journal + "\n" + W.shopButton + ": " + l.shop + "\n\n" +
    S.signoff + " — Salem\n\n" + textFooter_(l);

  MailApp.sendEmail({
    to: rec.email, subject: W.subject, name: BRAND,
    body: text, htmlBody: emailShell_(inner, l)
  });
}

function sendLinks_(rec) {
  if (!canSend_()) return;
  const l = links_(rec);
  const K = strings_(l.lang).links;
  const body = fill_(K.body, { firstName: rec.firstName });
  const inner =
    '<h1 style="font-family:Georgia,serif;font-size:28px;margin:10px 0 14px;">' + esc_(K.heading) + '</h1>' +
    '<p style="font-size:15px;line-height:1.6;">' + esc_(body) + '</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    button_(l.preferences, K.preferencesButton, true) +
    button_(l.unsubscribe, K.unsubscribeButton, false) + '</table>';
  const text = body + "\n\n" + K.preferencesButton + ": " + l.preferences + "\n" + K.unsubscribeButton + ": " + l.unsubscribe;
  MailApp.sendEmail({
    to: rec.email, subject: K.subject, name: BRAND,
    body: text, htmlBody: emailShell_(inner, l)
  });
}

function sendOwnerAlert_(rec) {
  const owner = ownerEmail_();
  if (!owner || !canSend_()) return;
  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const lines = [
    ["Name", rec.firstName + " " + rec.lastName],
    ["Email", rec.email],
    ["Phone", rec.phone || "—"],
    ["Interests", rec.interests || "—"],
    ["Language", langOf_(rec.lang) === "es" ? "Spanish (es)" : "English (en)"],
    ["Heard about Salem", rec.heardAbout || "—"],
    ["Joined", rec.createdAt]
  ];
  const html = '<div style="font-family:Helvetica,Arial,sans-serif;color:#1c2a42;max-width:600px;">' +
    '<h2 style="font-family:Georgia,serif;">New Salem subscriber</h2><table cellpadding="6" style="font-size:14px;">' +
    lines.map(x => '<tr><td style="color:#5b6577;">' + esc_(x[0]) + '</td><td>' + esc_(x[1]) + '</td></tr>').join("") +
    '</table><p><a href="' + esc_(sheetUrl) + '" style="color:#2f5d8c;">Open the subscriber sheet</a></p></div>';
  MailApp.sendEmail({
    to: owner, subject: "New Salem subscriber: " + rec.firstName + " " + rec.lastName, name: "Salem website",
    body: lines.map(x => x[0] + ": " + x[1]).join("\n") + "\n\nSheet: " + sheetUrl,
    htmlBody: html
  });
}

/* ------------------------------------------------------------------ */
/* Newsletter                                                          */
/* ------------------------------------------------------------------ */
//
// Salem writes the email in the "Newsletter" tab (labels in column A, values
// in column B), then uses the sheet's "Salem list" menu:
//   1. Send me a preview   → one copy to OWNER_EMAIL
//   2. Send newsletter...  → asks to confirm, then emails everyone who matches
//
// Gmail allows ~100 recipients a day on a consumer account. When the quota
// runs low, sendNewsletter saves its place (Status = "Sending") and a daily
// trigger continues at 9am until everyone has it. Progress is tracked by
// subscriber id only (no names or emails) and is cleared when the send ends.

const NEWSLETTER_SHEET = "Newsletter";
const NEWSLETTER_LOG_SHEET = "Newsletter log";
const NEWSLETTER_HISTORY_SHEET = "Newsletter history";
const NEWSLETTER_FIELDS = [
  ["Subject", "", "Subject line in the inbox. {firstName} works here too."],
  ["Heading", "", "Big title at the top of the email (optional)."],
  ["Message", "", "Blank line = new paragraph. {firstName} becomes the reader's first name."],
  ["Button label", "", "Optional, e.g. Read the full story"],
  ["Button link", "", "Optional, a full https:// link"],
  ["Send to", "Everyone", "Everyone, or only people who picked one interest."],
  ["Status", "Draft", "Set by the script: Draft → Sending → Sent."],
  ["Progress", "", "Filled in by the script."]
];
// Spanish version: optional rows below the English ones. Spanish-speaking
// subscribers get it when "Subject (Español)" and "Message (Español)" are both
// filled; otherwise they get the English version.
const NEWSLETTER_ES_FIELDS = [
  ["Subject (Español)", "", "Spanish version (optional). Fill Subject and Message (Español) to send Spanish speakers their own version."],
  ["Heading (Español)", "", "Optional."],
  ["Message (Español)", "", "Blank line = new paragraph. {firstName} works here too."],
  ["Button label (Español)", "", 'Optional. Blank = "Leer la historia completa" when there is a button link.'],
  ["Button link (Español)", "", "Optional. Blank = the English button link (e.g. use the /es/ page here)."]
];
const NEWSLETTER_AUDIENCES = [
  "Everyone", "Individual shirts", "Team and group orders", "Church and youth events",
  "Fundraisers", "Personal gifts", "Other events"
];
const NEWSLETTER_QUOTA_RESERVE = 10;        // keep room for welcome emails from the website
const NEWSLETTER_RUN_LIMIT_MS = 4.5 * 60 * 1000; // Apps Script stops a run at 6 minutes

/** Adds the "Salem list" menu to the sheet. Runs automatically when the sheet opens. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Salem list")
    .addItem("Set up Newsletter tab", "setupNewsletterTab")
    .addItem("Send me a preview", "previewNewsletter")
    .addSeparator()
    .addItem("Send newsletter to the list…", "confirmSendNewsletter")
    .addSeparator()
    .addItem("Set up Settings tab", "setupSettingsTab")
    .addItem("Install automatic jobs", "installTriggers")
    .addSeparator()
    .addItem("Draft newsletter from latest post", "draftNewsletterFromLatestPost")
    .addItem("Check for bounced emails now", "checkBounces")
    .addSeparator()
    .addItem("Set up Orders tab", "setupOrdersTab")
    .addItem("Check order deadlines now", "checkOrderDeadlines")
    .addSeparator()
    .addItem("Run monthly report now", "runMonthlyReport")
    .addToUi();
}

/**
 * Creates the "Newsletter" tab with its labels, or adds the Spanish rows to an
 * existing tab. Safe to run again: it never changes what's already written.
 */
function setupNewsletterTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(NEWSLETTER_SHEET);
  if (existing) {
    const added = addSpanishNewsletterRows_(existing);
    notify_(added
      ? "Added " + added + ' Spanish row(s) at the bottom of the "' + NEWSLETTER_SHEET + '" tab.'
      : 'The "' + NEWSLETTER_SHEET + '" tab is already up to date. Nothing was changed.');
    return;
  }
  const sh = ss.insertSheet(NEWSLETTER_SHEET);
  sh.getRange(1, 1, NEWSLETTER_FIELDS.length, 3).setValues(NEWSLETTER_FIELDS);
  sh.getRange(1, 1, NEWSLETTER_FIELDS.length, 1).setFontWeight("bold");
  sh.getRange(1, 2, NEWSLETTER_FIELDS.length, 1).setWrap(true).setNumberFormat("@");
  sh.getRange(1, 3, NEWSLETTER_FIELDS.length, 1).setFontColor("#5b6577").setWrap(true);
  sh.getRange(1, 1, NEWSLETTER_FIELDS.length, 3).setVerticalAlignment("top");
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 520);
  sh.setColumnWidth(3, 300);
  sh.setRowHeight(fieldRow_("Message"), 240);
  sh.getRange(fieldRow_("Send to"), 2).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(NEWSLETTER_AUDIENCES, true).build());
  sh.getRange(fieldRow_("Status"), 2).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["Draft", "Sending", "Sent"], true).build());
  addSpanishNewsletterRows_(sh);
  notify_('Created the "' + NEWSLETTER_SHEET + '" tab. Write the email in column B (the Spanish rows at the bottom are optional), then use Salem list → Send me a preview.');
}

// Appends any missing "(Español)" rows below the existing ones. Returns how many.
function addSpanishNewsletterRows_(sh) {
  const labels = sh.getLastRow() ? sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
  const missing = NEWSLETTER_ES_FIELDS.filter(f => labels.indexOf(f[0]) === -1);
  if (!missing.length) return 0;
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, missing.length, 3).setValues(missing);
  sh.getRange(start, 1, missing.length, 1).setFontWeight("bold");
  sh.getRange(start, 2, missing.length, 1).setWrap(true).setNumberFormat("@");
  sh.getRange(start, 3, missing.length, 1).setFontColor("#5b6577").setWrap(true);
  sh.getRange(start, 1, missing.length, 3).setVerticalAlignment("top");
  missing.forEach((f, i) => { if (f[0] === "Message (Español)") sh.setRowHeight(start + i, 240); });
  return missing.length;
}

/** Sends the owner a preview of each version (English, and Spanish when it's filled in). */
function previewNewsletter() {
  const owner = ownerEmail_();
  if (!owner) return notify_('Add the "Owner email" in the Settings tab (or the OWNER_EMAIL Script Property) first, so the preview has somewhere to go.');
  const n = readNewsletter_();
  if (!n.subject && !n.message) return notify_("Write a Subject and Message in the Newsletter tab first.");

  // Preview links use a fake token: they open the right pages but won't change anything.
  const langs = n.hasEs ? ["en", "es"] : ["en"];
  const sent = [];
  langs.forEach(lang => {
    if (!canSend_()) return;
    const m = renderNewsletter_(n, { firstName: strings_(lang).friend, token: "preview", lang: lang });
    MailApp.sendEmail({ to: owner, subject: strings_(lang).previewTag + " " + m.subject, name: BRAND, body: m.text, htmlBody: m.html });
    sent.push(lang === "es" ? "Spanish" : "English");
  });
  if (!sent.length) return notify_("Gmail's daily email limit is used up. Try again tomorrow.");

  const problems = newsletterProblems_(n);
  notify_("Preview sent to the owner email: " + sent.join(" and ") + " version" + (sent.length > 1 ? "s" : "") + "." +
    (n.hasEs ? "" : "\n\nThere's no Spanish version, so Spanish-speaking subscribers will get the English one.") +
    (problems.length ? "\n\nFix these before sending to the list:\n- " + problems.join("\n- ") : ""));
}

/** Menu entry: shows who will get the newsletter and asks before sending. */
function confirmSendNewsletter() {
  const ui = SpreadsheetApp.getUi();
  const n = readNewsletter_();
  const problems = newsletterProblems_(n);
  if (problems.length) return notify_("Not sent yet. Please fix:\n- " + problems.join("\n- "));
  if (n.status === "sending") {
    return notify_('This newsletter is already sending (see Progress). It continues each morning at 9am.');
  }

  const recipients = newsletterRecipients_(n, table_());
  const count = recipients.length;
  if (!count) return notify_('Nobody on the list matches "Send to: ' + n.sendTo + '". Nothing was sent.');
  const esCount = recipients.filter(r => langOf_(r.data.lang) === "es").length;
  const enCount = count - esCount;

  const again = n.status === "sent" ? "\n\nThis newsletter was already sent once. Sending again emails everyone a second time." : "";
  const days = Math.ceil(count / 90);
  const timing = days > 1 ? "\n\nGmail's daily limit means this takes about " + days + " days. It continues each morning at 9am." : "";
  const split = "\n\n" + enCount + " in English, " + esCount + " in Spanish." +
    (esCount && !n.hasEs ? " The Spanish version is empty, so those " + esCount + " will get the English version." : "");
  let answer;
  try {
    answer = ui.alert("Send the Salem newsletter?",
      'Send "' + n.subject + '" to ' + count + (count === 1 ? " person" : " people") +
      (n.sendTo === "Everyone" ? "" : " interested in " + n.sendTo) + "?" + split + again + timing,
      ui.ButtonSet.YES_NO);
  } catch (err) {
    // The editor's Run button has no sheet window to ask in, so nothing is sent.
    console.log("Nothing sent. Open the Google Sheet and use Salem list → Send newsletter to the list… " +
      "(the confirmation box only appears there). It would go to " + count + " people.");
    return;
  }
  if (answer !== ui.Button.YES) return;

  startNewsletter_(n);
  sendNewsletter();
}

/**
 * Sends the newsletter to everyone who hasn't received it yet, until the run
 * time or the daily quota runs out. Called by the menu and by the daily trigger.
 */
function sendNewsletter() {
  // A separate lock from doPost's script lock, so signups keep working while this runs.
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(0)) return notify_("A newsletter send is already running.");
  try {
    const startedAt = Date.now();
    const n = readNewsletter_();
    const props = PropertiesService.getScriptProperties();
    const campaign = props.getProperty("NEWSLETTER_CAMPAIGN");
    if (n.status !== "sending" || !campaign) {
      stopNewsletterTrigger_();
      return notify_('Nothing to send. Use Salem list → "Send newsletter to the list…" to start.');
    }
    const problems = newsletterProblems_(n);
    if (problems.length) {
      return notify_("Sending is paused. Please fix:\n- " + problems.join("\n- ") +
        '\n\nIt will continue at the next 9am run, or run sendNewsletter from the editor.');
    }

    const log = newsletterLog_();
    const done = sentIds_(log, campaign);
    const recipients = newsletterRecipients_(n, table_());
    let sentNow = 0, failed = 0, stoppedEarly = false;

    for (const r of recipients) {
      const id = r.data.id || r.data.token;
      if (done.has(id)) continue;
      if (Date.now() - startedAt > NEWSLETTER_RUN_LIMIT_MS ||
          MailApp.getRemainingDailyQuota() <= NEWSLETTER_QUOTA_RESERVE) {
        stoppedEarly = true;
        break;
      }
      const m = renderNewsletter_(n, r.data);
      try {
        MailApp.sendEmail({ to: r.data.email, subject: m.subject, name: BRAND, body: m.text, htmlBody: m.html });
        sentNow++;
      } catch (err) {
        failed++; // logged without the address; marked done so one bad address can't block the rest
        console.error("Newsletter email failed: " + (err && err.message));
      }
      log.appendRow([campaign, id, new Date().toISOString()]);
      done.add(id);
    }

    const total = recipients.length;
    const reached = recipients.filter(r => done.has(r.data.id || r.data.token)).length;
    const failNote = failed ? " (" + failed + " could not be delivered; see Executions)" : "";

    if (!stoppedEarly) {
      setNewsletterField_(n, "Status", "Sent");
      setNewsletterField_(n, "Progress", "Sent to " + reached + " of " + total + failNote + " · finished " + stamp_());
      recordNewsletter_(n, reached);
      finishNewsletter_(log, campaign);
      notify_("Newsletter sent to " + reached + (reached === 1 ? " person" : " people") + failNote + ".");
    } else {
      setNewsletterField_(n, "Progress", reached + " of " + total + " sent so far" + failNote +
        " · continues tomorrow at 9am · updated " + stamp_());
      ensureNewsletterTrigger_();
      notify_("Sent " + sentNow + " today (" + reached + " of " + total + " so far). " +
        "Gmail's daily limit was reached, so the rest go out tomorrow at 9am.");
    }
  } finally {
    lock.releaseLock();
  }
}

/* Newsletter helpers ------------------------------------------------- */

function readNewsletter_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NEWSLETTER_SHEET);
  if (!sh) throw new Error('Missing "' + NEWSLETTER_SHEET + '" tab. Use Salem list → Set up Newsletter tab.');
  const values = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getDisplayValues();
  const f = {}, rows = {};
  values.forEach((r, i) => {
    const key = String(r[0]).trim();
    if (key) { f[key] = String(r[1]); rows[key] = i + 1; }
  });
  NEWSLETTER_FIELDS.forEach(x => {
    if (!(x[0] in f)) throw new Error('Missing row "' + x[0] + '" in the ' + NEWSLETTER_SHEET + " tab.");
  });
  const opt = key => String(f[key] || "").trim(); // Spanish rows are optional (older tabs don't have them)
  const es = {
    subject: opt("Subject (Español)"),
    heading: opt("Heading (Español)"),
    message: opt("Message (Español)").replace(/\r\n?/g, "\n"),
    buttonLabel: opt("Button label (Español)"),
    buttonLink: opt("Button link (Español)")
  };
  return {
    sh: sh,
    rows: rows,
    subject: f["Subject"].trim(),
    heading: f["Heading"].trim(),
    message: f["Message"].replace(/\r\n?/g, "\n").trim(),
    buttonLabel: f["Button label"].trim(),
    buttonLink: f["Button link"].trim(),
    sendTo: f["Send to"].trim() || "Everyone",
    status: f["Status"].trim().toLowerCase(),
    progress: f["Progress"].trim(),
    es: es,
    hasEs: Boolean(es.subject && es.message)
  };
}

function fieldRow_(key) {
  return NEWSLETTER_FIELDS.findIndex(x => x[0] === key) + 1;
}

function setNewsletterField_(n, key, value) {
  n.sh.getRange(n.rows[key], 2).setValue(value);
}

function newsletterProblems_(n) {
  const p = [];
  if (!n.subject) p.push("Add a Subject.");
  if (!n.message) p.push("Add a Message.");
  if (n.buttonLabel && !n.buttonLink) p.push("Add a Button link, or clear the Button label.");
  if (n.buttonLink && !n.buttonLabel) p.push("Add a Button label, or clear the Button link.");
  if (n.buttonLink && !/^https:\/\/\S+$/i.test(n.buttonLink)) p.push("The Button link must be a full https:// link.");
  if (NEWSLETTER_AUDIENCES.indexOf(n.sendTo) === -1) p.push('"Send to" must be Everyone or one of the interests.');
  if (n.es && Boolean(n.es.subject) !== Boolean(n.es.message)) {
    p.push('Fill in both "Subject (Español)" and "Message (Español)", or leave both empty to send everyone the English version.');
  }
  if (n.es && n.es.buttonLink && !/^https:\/\/\S+$/i.test(n.es.buttonLink)) p.push("The Button link (Español) must be a full https:// link.");
  return p;
}

function newsletterRecipients_(n, t) {
  const want = n.sendTo.toLowerCase();
  return t.rows.filter(r =>
    isActive_(r.data.status) && r.data.token && EMAIL_RE.test(r.data.email) &&
    (want === "everyone" || toList_(r.data.interests).some(i => i.toLowerCase() === want)));
}

// The newsletter for one subscriber, in their language when a Spanish version
// exists; otherwise the English version (with an English footer, so one email
// never mixes languages). Links still go to the subscriber's language pages.
function renderNewsletter_(n, rec) {
  const l = links_(rec);
  const lang = l.lang === "es" && n.hasEs ? "es" : "en";
  const S = strings_(lang);
  const v = lang === "es"
    ? { subject: n.es.subject, heading: n.es.heading, message: n.es.message,
        buttonLink: n.es.buttonLink || n.buttonLink,
        buttonLabel: n.es.buttonLabel || ((n.es.buttonLink || n.buttonLink) ? S.readMore : "") }
    : { subject: n.subject, heading: n.heading, message: n.message, buttonLink: n.buttonLink, buttonLabel: n.buttonLabel };

  const name = rec.firstName || S.friend;
  const fill = s => String(s || "").replace(/\{firstName\}/g, name);
  const paras = fill(v.message).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const heading = fill(v.heading);

  const inner =
    (heading ? '<h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.15;margin:10px 0 16px;">' + esc_(heading) + "</h1>" : "") +
    paras.map(p => '<p style="font-size:16px;line-height:1.6;">' + esc_(p).replace(/\n/g, "<br>") + "</p>").join("") +
    (v.buttonLink
      ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">' +
        button_(v.buttonLink, v.buttonLabel, true) + "</table>"
      : "") +
    '<p style="font-size:14px;line-height:1.6;margin-top:20px;">' + esc_(S.signoff) + '<br>&mdash; Salem</p>';

  const text =
    (heading ? heading + "\n\n" : "") + paras.join("\n\n") +
    (v.buttonLink ? "\n\n" + v.buttonLabel + ": " + v.buttonLink : "") +
    "\n\n" + S.signoff + " — Salem\n\n" + textFooter_(l, lang);

  return { subject: fill(v.subject), html: emailShell_(inner, l, lang), text: text, lang: lang };
}

// Starts a fresh send: new campaign id, empty progress log.
function startNewsletter_(n) {
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty("NEWSLETTER_CAMPAIGN");
  if (old) finishNewsletter_(newsletterLog_(), old);
  props.setProperty("NEWSLETTER_CAMPAIGN", Utilities.getUuid());
  props.setProperty("NEWSLETTER_STARTED", String(Date.now())); // for "took N days" in the history
  setNewsletterField_(n, "Status", "Sending");
  setNewsletterField_(n, "Progress", "Starting · " + stamp_());
}

// Removes the progress rows and the trigger once a send is finished.
function finishNewsletter_(log, campaign) {
  const last = log.getLastRow();
  if (last >= 1) {
    const ids = log.getRange(1, 1, last, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === campaign) log.deleteRow(i + 1);
    }
  }
  PropertiesService.getScriptProperties().deleteProperty("NEWSLETTER_CAMPAIGN");
  PropertiesService.getScriptProperties().deleteProperty("NEWSLETTER_STARTED");
  stopNewsletterTrigger_();
}

// One row per finished newsletter in the "Newsletter history" tab (subject and
// counts only), plus an Agent Log line. The monthly report reads this tab.
function recordNewsletter_(n, reached) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(NEWSLETTER_HISTORY_SHEET);
    if (!sh) {
      sh = ss.insertSheet(NEWSLETTER_HISTORY_SHEET);
      sh.getRange(1, 1, 1, 5).setValues([["Finished", "Subject", "Sent to", "People reached", "Days it took"]]).setFontWeight("bold");
      sh.setFrozenRows(1);
      sh.setColumnWidth(2, 360);
    }
    const started = Number(PropertiesService.getScriptProperties().getProperty("NEWSLETTER_STARTED") || 0);
    const days = started ? dayIndex_(new Date()) - dayIndex_(new Date(started)) + 1 : 1;
    sh.appendRow([new Date(), safeCell_(n.subject), n.sendTo, reached, days]);
    logAgent_("newsletter sent", 'Sent "' + n.subject + '" to ' + reached + " people (Send to: " + n.sendTo + ") over " + days + " day(s).");
  } catch (err) {
    console.error("Newsletter history write failed: " + (err && err.message));
  }
}

// Hidden tab: campaign id | subscriber id | sent at. Ids only, never names or emails.
function newsletterLog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(NEWSLETTER_LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(NEWSLETTER_LOG_SHEET);
    sh.hideSheet();
  }
  return sh;
}

function sentIds_(log, campaign) {
  const last = log.getLastRow();
  const set = new Set();
  if (last < 1) return set;
  log.getRange(1, 1, last, 2).getDisplayValues().forEach(r => {
    if (r[0] === campaign) set.add(r[1]);
  });
  return set;
}

function ensureNewsletterTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "sendNewsletter");
  if (!exists) ScriptApp.newTrigger("sendNewsletter").timeBased().everyDays(1).atHour(9).create();
}

function stopNewsletterTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "sendNewsletter")
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, h:mm a");
}

// Shows a message in the sheet when run from the menu; logs it when run from
// the editor or a trigger (where there is no sheet window to show it in).
function notify_(msg) {
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* no UI in this context */ }
}

/* ------------------------------------------------------------------ */
/* Automation: Settings, Agent Log, AI helper, triggers                */
/* ------------------------------------------------------------------ */
//
// Ground rules for every automated job:
//   - It drafts or reports. Anything sent to customers waits for Salem's OK.
//   - It never deletes subscriber rows and never emails the whole list.
//   - Only counts, totals and post titles go to the AI. Never names or emails.
//   - It writes one line to the "Agent Log" tab per run.

const SETTINGS_SHEET = "Settings";
const AGENT_LOG_SHEET = "Agent Log";
const AGENT_LOG_HEADERS = ["Time", "Job", "What it did", "Error"];
const AGENT_LOG_MAX_ROWS = 2000; // oldest lines are trimmed past this

// Key | starting value | note shown in column C. Salem edits column B.
const SETTINGS_FIELDS = [
  ["Owner email", "", "Where reports, alerts and previews go. Blank = the OWNER_EMAIL Script Property."],
  ["Report day", "1", "Day of the month the monthly report arrives (1–28). After changing it, run Salem list → Install automatic jobs."],
  ["Business voice", "Warm, humble and faith-driven. Plain, friendly words and short sentences. " +
    "A small Chicago studio that cares about the people and messages behind each shirt. " +
    "No hype or pressure. To order, people message Salem on Instagram.",
    "How AI-written drafts should sound. Edit freely."],
  ["FAQ: Minimum order", "", "Used for draft replies to customers. Leave blank until Salem decides."],
  ["FAQ: Pricing", "", "Price ranges, e.g. per-shirt price by quantity."],
  ["FAQ: Turnaround", "", "Usual time from approved design to pickup."],
  ["FAQ: Delivery area", "", "Pickup / delivery details."],
  // Seasonal tips: the monthly report shows the tip for the coming month (no AI needed).
  ["Tip: January", "New year, new plans. Check in with churches and youth groups planning spring retreats and ask what shirts they'll need.", "Shown in the report that arrives at the start of January. Edit freely."],
  ["Tip: February", "Easter is coming. Remind churches that Holy Week and Easter shirts should be ordered early.", ""],
  ["Tip: March", "Share an Easter order reminder post. Start conversations about VBS (Vacation Bible School) shirts for summer.", ""],
  ["Tip: April", "VBS and summer camp season is close. Invite churches to order VBS and youth camp shirts before the summer rush.", ""],
  ["Tip: May", "Graduations, end of the school year and family reunions. Last call for VBS and camp orders.", ""],
  ["Tip: June", "VBS and camps are running. Share photos of shirts in action (with permission) and thank the churches you served.", ""],
  ["Tip: July", "Back to school and fall church kickoffs are coming. Reach out to schools, teams and ministries now.", ""],
  ["Tip: August", "Back to school: teams, clubs and fall fundraisers. Ask about harvest festivals and fall church events.", ""],
  ["Tip: September", "Fall fundraisers, walks and runs. Start talking with churches about Christmas programs and year-end gifts.", ""],
  ["Tip: October", "Post a Christmas order reminder with the last day to order for Christmas pickup. Ask about staff and volunteer gifts.", ""],
  ["Tip: November", "Last call for Christmas orders. Year-end and Giving Tuesday fundraiser shirts.", ""],
  ["Tip: December", "Thank your customers and share a year-in-review post. Plan January outreach.", ""]
];

/** Creates the Settings tab, or adds any missing rows to it. Never overwrites Salem's values. */
function setupSettingsTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  const created = !sh;
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(2, 460);
    sh.setColumnWidth(3, 340);
  }
  const have = new Set(Object.keys(readSettings_()));
  const missing = SETTINGS_FIELDS.filter(f => !have.has(f[0]));
  if (missing.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, missing.length, 3).setValues(missing);
    sh.getRange(start, 1, missing.length, 1).setFontWeight("bold");
    sh.getRange(start, 2, missing.length, 1).setWrap(true).setNumberFormat("@");
    sh.getRange(start, 3, missing.length, 1).setFontColor("#5b6577").setWrap(true);
    sh.getRange(start, 1, missing.length, 3).setVerticalAlignment("top");
  }
  logAgent_("setup settings", created ? "Created the Settings tab." : "Added " + missing.length + " missing setting(s).");
  notify_(created
    ? 'Created the "' + SETTINGS_SHEET + '" tab. Fill in column B; leave FAQ answers blank until Salem decides them.'
    : missing.length ? "Added " + missing.length + " new setting(s) to the Settings tab." : "The Settings tab is already up to date.");
}

/** All settings as { key: value }. Returns {} if the tab doesn't exist yet. */
function readSettings_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 1) return out;
  sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues().forEach(r => {
    const k = String(r[0]).trim();
    if (k) out[k] = String(r[1]).trim();
  });
  return out;
}

/** One setting, or the fallback when it's missing or blank. */
function setting_(key, fallback) {
  const v = readSettings_()[key];
  return v ? v : (fallback == null ? "" : fallback);
}

/** Owner email: the Settings tab first, then the OWNER_EMAIL Script Property. */
function ownerEmail_() {
  const fromSheet = normEmail_(setting_("Owner email"));
  if (EMAIL_RE.test(fromSheet)) return fromSheet;
  return String(PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL") || "").trim();
}

/**
 * Writes one line to the Agent Log tab (creates it if needed).
 * Keep messages free of names, emails and phone numbers.
 */
function logAgent_(job, message, error) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(AGENT_LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(AGENT_LOG_SHEET);
      sh.getRange(1, 1, 1, AGENT_LOG_HEADERS.length).setValues([AGENT_LOG_HEADERS]).setFontWeight("bold");
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 150);
      sh.setColumnWidth(2, 160);
      sh.setColumnWidth(3, 460);
      sh.setColumnWidth(4, 320);
    }
    sh.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
      safeCell_(String(job || "")),
      safeCell_(String(message || "").slice(0, 1000)),
      safeCell_(String(error || "").slice(0, 500))
    ]);
    const extra = sh.getLastRow() - 1 - AGENT_LOG_MAX_ROWS;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (err) {
    // Logging must never break the job that called it.
    console.error("Agent Log write failed: " + (err && err.message));
  }
}

/**
 * Asks Claude for a short piece of writing. Returns the text, or null if the
 * API key is missing or anything goes wrong (the error goes to the Agent Log),
 * so the calling job can carry on without AI text.
 * Only send aggregates and public post text here, never subscriber details.
 */
function askClaude_(prompt, maxTokens, job) {
  const label = job || "ask claude";
  const key = String(PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY") || "").trim();
  if (!key) {
    // Running without AI is the normal, free setup. Note it once a month, not on every run.
    const props = PropertiesService.getScriptProperties();
    const month = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM");
    if (props.getProperty("AI_OFF_NOTED") !== month) {
      logAgent_(label, "AI is off (no ANTHROPIC_API_KEY), so jobs use their plain fallbacks. Noted once a month.");
      props.setProperty("AI_OFF_NOTED", month);
    }
    return null;
  }
  try {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: maxTokens || 1500,
        output_config: { effort: "low" }, // short, simple writing; keeps cost and time down
        messages: [{ role: "user", content: String(prompt) }]
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    let body = {};
    try { body = JSON.parse(res.getContentText() || "{}"); } catch (e) { /* non-JSON error page */ }

    if (code !== 200) {
      const e = body.error || {};
      logAgent_(label, "AI call failed.", "HTTP " + code + (e.type ? " " + e.type : "") + (e.message ? ": " + e.message : ""));
      return null;
    }
    if (body.stop_reason === "refusal") {
      logAgent_(label, "AI declined this request.", "stop_reason: refusal");
      return null;
    }
    if (body.stop_reason === "max_tokens") {
      // A cut-off draft is worse than the plain fallback, so don't use it.
      logAgent_(label, "AI answer was cut off; using the fallback instead.", "stop_reason: max_tokens (raise maxTokens)");
      return null;
    }
    // Only text blocks; the model can also return (empty) thinking blocks.
    const text = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) {
      logAgent_(label, "AI returned no text.", "stop_reason: " + body.stop_reason);
      return null;
    }
    return text;
  } catch (err) {
    logAgent_(label, "AI call failed.", (err && err.message) || String(err));
    return null;
  }
}

// Every scheduled job in one place. Each later phase adds its line here.
//   fn:   the function the trigger runs (must exist in this file)
//   when: builds the schedule on a ScriptApp trigger builder
// The newsletter's 9am "sendNewsletter" trigger is not listed: sendNewsletter
// adds and removes it by itself while a multi-day send is in progress.
function scheduledJobs_() {
  return [
    { fn: "checkBounces", label: "Bounced email check (Mondays, about 6am)",
      when: b => b.timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6) },
    { fn: "checkNewPost", label: "New journal post check (daily, about 8am)",
      when: b => b.timeBased().everyDays(1).atHour(8) },
    { fn: "checkOrderDeadlines", label: "Order deadline reminders (daily, about 7am; only emails when something is due)",
      when: b => b.timeBased().everyDays(1).atHour(7) },
    { fn: "runMonthlyReport", label: "Monthly report (day " + reportDay_() + " of each month, about 8am)",
      when: b => b.timeBased().onMonthDay(reportDay_()).atHour(8) }
  ];
}

// "Report day" from Settings, kept to 1–28 so it exists in every month.
function reportDay_() {
  const d = parseInt(setting_("Report day", "1"), 10);
  return Math.min(Math.max(isNaN(d) ? 1 : d, 1), 28);
}

/* Monthly counters --------------------------------------------------- */
// Numbers that can't be read back from the sheet later (unsubscribing deletes
// the row). Stored as STATS_yyyy-MM Script Properties: counts only, no people.

function countEvent_(name, n) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = "STATS_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM");
    const s = JSON.parse(props.getProperty(key) || "{}");
    s[name] = (Number(s[name]) || 0) + (n == null ? 1 : n);
    props.setProperty(key, JSON.stringify(s));
  } catch (err) {
    console.error("countEvent_ failed: " + (err && err.message));
  }
}

function monthStats_(monthKey) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty("STATS_" + monthKey) || "{}");
  } catch (err) {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Orders tab and deadline reminders (no AI)                           */
/* ------------------------------------------------------------------ */
//
// Salem keeps one row per order in the "Orders" tab. Every morning the script
// emails Salem a short list ONLY if an order is overdue or due in the next 7
// days and not yet picked up (or cancelled). Quiet days send nothing.
//
// Filled in automatically while Salem types (onEdit):
//   Order ID      - next S-0001 style number when a new row gets a customer
//   Picked up on  - today's date when Status is set to "Picked up"
// The monthly report uses "Picked up on" to count completed orders.

const ORDERS_SHEET = "Orders";
const ORDER_HEADERS = [
  "Order ID", "Customer", "Contact", "Description", "Quantity", "Ink colors",
  "Deadline", "Status", "Notes", "Picked up on"
];
const ORDER_STATUSES = ["Quote", "Confirmed", "Printing", "Ready", "Picked up", "Cancelled"];
const ORDER_CLOSED = ["picked up", "cancelled"];
const ORDER_REMINDER_DAYS = 7;

/** Creates the Orders tab, or adds missing columns to it. Never changes existing rows. */
function setupOrdersTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ORDERS_SHEET);
  const created = !sh;
  if (!sh) sh = ss.insertSheet(ORDERS_SHEET);

  const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim()) : [];
  const missing = ORDER_HEADERS.filter(h => have.indexOf(h) === -1);
  if (missing.length) {
    const start = have.filter(Boolean).length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
  const col = name => headers.indexOf(name) + 1;
  const rows = Math.max(sh.getMaxRows() - 1, 1); // every row of the tab below the header

  sh.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e9ecef");
  sh.setFrozenRows(1);
  sh.getRange(2, col("Status"), rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ORDER_STATUSES, true).setAllowInvalid(false).build());
  sh.getRange(2, col("Deadline"), rows, 1).setNumberFormat("ddd, mmm d, yyyy").setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
      .setHelpText("Enter a date, e.g. 12/20/2026").build());
  sh.getRange(2, col("Picked up on"), rows, 1).setNumberFormat("mmm d, yyyy");
  sh.getRange(2, col("Quantity"), rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false)
      .setHelpText("Number of shirts").build());
  sh.getRange(2, col("Order ID"), rows, 1).setFontColor("#5b6577");
  [["Order ID", 80], ["Customer", 170], ["Contact", 190], ["Description", 280], ["Quantity", 80],
   ["Ink colors", 140], ["Deadline", 140], ["Status", 110], ["Notes", 260], ["Picked up on", 110]]
    .forEach(w => { if (col(w[0])) sh.setColumnWidth(col(w[0]), w[1]); });

  logAgent_("setup orders", created ? "Created the Orders tab." : "Checked the Orders tab; added " + missing.length + " column(s).");
  notify_(created
    ? 'Created the "Orders" tab. Add one row per order. Order ID and "Picked up on" fill in by themselves.'
    : missing.length ? "Added " + missing.length + " column(s) to the Orders tab: " + missing.join(", ") : "The Orders tab is already set up.");
}

/** Open and closed orders as objects. Returns null when the tab doesn't exist. */
function readOrders_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET);
  if (!sh) return null;
  if (sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const headers = values[0].map(h => String(h).trim());
  const get = (r, name) => { const i = headers.indexOf(name); return i === -1 ? "" : r[i]; };
  const asDate = v => (v instanceof Date && !isNaN(v)) ? v : (v ? (d => isNaN(d) ? null : d)(new Date(v)) : null);
  return values.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    id: String(get(r, "Order ID")).trim(),
    customer: String(get(r, "Customer")).trim(),
    contact: String(get(r, "Contact")).trim(),
    description: String(get(r, "Description")).trim(),
    quantity: Number(get(r, "Quantity")) || 0,
    inks: String(get(r, "Ink colors")).trim(),
    deadline: asDate(get(r, "Deadline")),
    status: String(get(r, "Status")).trim(),
    notes: String(get(r, "Notes")).trim(),
    pickedUpOn: asDate(get(r, "Picked up on"))
  })).filter(o => o.customer || o.description);
}

function isOrderOpen_(o) {
  return ORDER_CLOSED.indexOf(o.status.toLowerCase()) === -1;
}

// Whole days between two dates in the script's time zone (deadline - today).
function dayIndex_(d) {
  const p = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-M-d").split("-").map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}

/** Daily trigger (and menu): emails Salem only when an open order is overdue or due within 7 days. */
function checkOrderDeadlines() {
  const job = "order reminders";
  try {
    const orders = readOrders_();
    if (orders === null) {
      logAgent_(job, "No Orders tab yet; nothing to check.");
      return notify_('There is no "Orders" tab yet. Use Salem list → Set up Orders tab.');
    }
    const today = dayIndex_(new Date());
    const open = orders.filter(isOrderOpen_);
    const due = open.filter(o => o.deadline)
      .map(o => Object.assign({ daysLeft: dayIndex_(o.deadline) - today }, o))
      .filter(o => o.daysLeft <= ORDER_REMINDER_DAYS)
      .sort((a, b) => a.daysLeft - b.daysLeft || b.quantity - a.quantity);
    const noDeadline = open.filter(o => !o.deadline).length;

    if (!due.length) {
      const msg = "Nothing overdue or due in the next " + ORDER_REMINDER_DAYS + " days (" + open.length + " open order(s)). No email sent.";
      logAgent_(job, msg);
      return notify_(msg);
    }
    const owner = ownerEmail_();
    if (!owner) {
      logAgent_(job, due.length + " order(s) due, but no owner email is set.", "Add Owner email in Settings.");
      return notify_('Add the "Owner email" in the Settings tab so reminders have somewhere to go.');
    }
    if (!canSend_()) {
      logAgent_(job, due.length + " order(s) due, but no email quota is left today.", "Daily email limit reached.");
      return notify_("Gmail's daily email limit is used up, so the reminder could not be sent today.");
    }

    const overdue = due.filter(o => o.daysLeft < 0).length;
    const subject = "Salem orders: " +
      [overdue ? overdue + " overdue" : "", due.length - overdue ? (due.length - overdue) + " due this week" : ""]
        .filter(Boolean).join(", ");
    const when = o => o.daysLeft < 0 ? "Overdue " + (-o.daysLeft) + (o.daysLeft === -1 ? " day" : " days")
      : o.daysLeft === 0 ? "Today" : o.daysLeft === 1 ? "Tomorrow" : "In " + o.daysLeft + " days";
    const fmt = d => Utilities.formatDate(d, Session.getScriptTimeZone(), "EEE, MMM d");

    const html = '<div style="font-family:Helvetica,Arial,sans-serif;color:#1c2a42;max-width:640px;">' +
      '<h2 style="font-family:Georgia,serif;margin:0 0 12px;">Orders coming up</h2>' +
      '<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px;width:100%;">' +
      '<tr style="background:#e9ecef;text-align:left;"><th>When</th><th>Customer</th><th>Qty</th><th>What</th><th>Status</th></tr>' +
      due.map(o => '<tr style="border-bottom:1px solid #d6dbe4;">' +
        '<td style="white-space:nowrap;' + (o.daysLeft < 0 ? "color:#a61b1b;font-weight:bold;" : "") + '">' +
          esc_(when(o)) + '<br><span style="color:#5b6577;font-size:12px;">' + esc_(fmt(o.deadline)) + "</span></td>" +
        "<td>" + esc_(o.customer) + (o.contact ? '<br><span style="color:#5b6577;font-size:12px;">' + esc_(o.contact) + "</span>" : "") + "</td>" +
        "<td>" + esc_(o.quantity || "—") + "</td>" +
        "<td>" + esc_(o.description) + (o.inks ? '<br><span style="color:#5b6577;font-size:12px;">Ink: ' + esc_(o.inks) + "</span>" : "") + "</td>" +
        "<td>" + esc_(o.status || "—") + "</td></tr>").join("") +
      "</table>" +
      (noDeadline ? '<p style="font-size:13px;color:#5b6577;">' + noDeadline + " open order(s) have no deadline yet.</p>" : "") +
      '<p style="font-size:13px;"><a href="' + esc_(SpreadsheetApp.getActiveSpreadsheet().getUrl()) +
      '" style="color:#2f5d8c;">Open the Orders tab</a></p></div>';
    const text = "Orders coming up\n\n" + due.map(o =>
      when(o) + " (" + fmt(o.deadline) + "): " + o.customer + " · " + (o.quantity || "?") + " · " + o.description + " · " + (o.status || "no status")
    ).join("\n") + (noDeadline ? "\n\n" + noDeadline + " open order(s) have no deadline yet." : "") +
      "\n\nSheet: " + SpreadsheetApp.getActiveSpreadsheet().getUrl();

    MailApp.sendEmail({ to: owner, subject: subject, name: "Salem website", body: text, htmlBody: html });
    const msg = "Emailed Salem about " + due.length + " order(s): " + subject.replace("Salem orders: ", "") + ".";
    logAgent_(job, msg);
    notify_(msg);
  } catch (err) {
    logAgent_(job, "Order reminder check did not finish.", (err && err.message) || String(err));
    notify_("The order check did not finish: " + ((err && err.message) || err));
  }
}

/**
 * Runs by itself whenever someone edits the sheet. Only acts on the Orders tab:
 * gives new orders an ID and stamps "Picked up on". Never blocks typing.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== ORDERS_SHEET || e.range.getLastRow() < 2) return;
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
    const c = name => headers.indexOf(name) + 1;
    if (!c("Order ID") || !c("Status")) return;
    const first = Math.max(e.range.getRow(), 2), last = e.range.getLastRow();
    for (let r = first; r <= last; r++) {
      const row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
      const filled = row[c("Customer") - 1] || row[c("Description") - 1];
      if (filled && !String(row[c("Order ID") - 1]).trim()) {
        sh.getRange(r, c("Order ID")).setValue(nextOrderId_(sh, c("Order ID")));
      }
      if (c("Picked up on") && String(row[c("Status") - 1]).trim().toLowerCase() === "picked up" && !row[c("Picked up on") - 1]) {
        const today = new Date();
        sh.getRange(r, c("Picked up on")).setValue(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
      }
    }
  } catch (err) {
    console.error("onEdit (Orders) failed: " + (err && err.message));
  }
}

function nextOrderId_(sh, idCol) {
  const ids = sh.getLastRow() < 2 ? [] : sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getDisplayValues();
  const max = ids.reduce((m, r) => {
    const n = Number((String(r[0]).match(/^S-(\d+)$/i) || [])[1] || 0);
    return Math.max(m, n);
  }, 0);
  return "S-" + String(max + 1).padStart(4, "0");
}

/* ------------------------------------------------------------------ */
/* Monthly report                                                      */
/* ------------------------------------------------------------------ */
//
// On "Report day" (Settings, default the 1st) around 8am, and from the menu,
// Salem gets one email about the previous calendar month:
//   1. headline numbers   2. summary + seasonal tip (AI summary only if a key is set)
//   3. site check + problems logged   4. orders due   5. a copy-paste prompt for free claude.ai
// One row per month also goes in the "Monthly Reports" tab (re-running a month
// replaces its row). Only counts and titles go into the prompt, never people.

const MONTHLY_REPORTS_SHEET = "Monthly Reports";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const REPORT_HEADERS = ["Month", "Active subscribers", "New", "Unsubscribed", "Bounced", "Net change",
  "Newsletters sent", "Orders picked up", "Shirts picked up", "Open orders", "Site issues",
  "Problems logged", "Summary", "Tip for next month", "Made"];

function runMonthlyReport() {
  const job = "monthly report";
  try {
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const inMonth = d => Boolean(d) && !isNaN(d) && d >= start && d < end;
    const why = err => (err && err.message) || String(err);

    const r = {
      key: Utilities.formatDate(start, tz, "yyyy-MM"),
      label: Utilities.formatDate(start, tz, "MMMM yyyy"),
      monthName: MONTH_NAMES[start.getMonth()],
      prevName: MONTH_NAMES[prevStart.getMonth()],
      nextName: MONTH_NAMES[end.getMonth()],
      notes: [] // parts that could not be checked
    };

    try { r.subs = subscriberStats_(inMonth, r.key); } catch (err) { r.notes.push("Subscribers: " + why(err)); }
    try { r.letters = newsletterStats_(inMonth); } catch (err) { r.notes.push("Newsletters: " + why(err)); }
    try { r.orders = orderStats_(inMonth, nextEnd); } catch (err) { r.notes.push("Orders: " + why(err)); }
    let posts = [];
    try { posts = readFeed_(); } catch (err) { r.notes.push("Journal feed: " + why(err)); }
    r.postsThisMonth = posts.filter(p => inMonth(p.date)).map(p => p.title);
    try { r.site = siteCheck_(posts, now); } catch (err) { r.notes.push("Site check: " + why(err)); }
    try { r.problems = agentProblems_(r.key); } catch (err) { r.notes.push("Agent Log: " + why(err)); }
    r.prev = previousReport_(Utilities.formatDate(prevStart, tz, "yyyy-MM"));
    r.tip = setting_("Tip: " + r.nextName, "");
    r.plain = plainSummary_(r);
    r.prompt = reportPrompt_(r);
    r.ai = askClaude_(r.prompt + "\n\nReply in plain text, no markdown, under 200 words.", 1500, job);

    saveReportRow_(r);
    cleanOldStats_(now);
    const emailed = sendReportEmail_(r);
    const msg = "Report for " + r.label + (emailed ? " emailed to Salem" : " saved, but not emailed (no owner email or no quota left)") +
      ". " + (r.site ? r.site.issues.length + " site issue(s), " : "") + (r.problems ? r.problems.count + " problem(s) logged." : "");
    logAgent_(job, msg, r.notes.join("; "));
    notify_(msg + (r.notes.length ? "\n\nCould not check:\n- " + r.notes.join("\n- ") : ""));
  } catch (err) {
    logAgent_(job, "The monthly report did not finish.", (err && err.message) || String(err));
    notify_("The monthly report did not finish: " + ((err && err.message) || err));
  }
}

/* Gathering numbers -------------------------------------------------- */

function subscriberStats_(inMonth, key) {
  const t = table_();
  const stats = monthStats_(key);
  const active = t.rows.filter(r => isActive_(r.data.status));
  // Rows of people who joined and then left are gone, so use the counter when it's higher.
  const joinedRows = t.rows.filter(r => inMonth(new Date(r.data.createdAt))).length;
  const joined = Math.max(Number(stats.joined) || 0, joinedRows);
  const left = Number(stats.unsubscribed) || 0;
  const bounced = Number(stats.bounced) || 0;

  const counts = {};
  NEWSLETTER_AUDIENCES.filter(a => a !== "Everyone").forEach(a => { counts[a] = 0; });
  active.forEach(r => toList_(r.data.interests).forEach(i => { counts[i] = (counts[i] || 0) + 1; }));
  const interests = Object.keys(counts).map(k => [k, counts[k]]).sort((a, b) => b[1] - a[1]);

  return {
    active: active.length, joined: joined, left: left, bounced: bounced,
    bouncedTotal: t.rows.filter(r => r.data.status === "bounced").length,
    net: joined - left - bounced, interests: interests
  };
}

function newsletterStats_(inMonth) {
  const sent = [];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NEWSLETTER_HISTORY_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(v => {
      const d = v[0] instanceof Date ? v[0] : new Date(v[0]);
      if (inMonth(d)) sent.push({ subject: String(v[1]), sendTo: String(v[2]), people: Number(v[3]) || 0, days: Number(v[4]) || 1 });
    });
  }
  let sendingNow = null;
  try {
    const n = readNewsletter_();
    if (n.status === "sending") sendingNow = n.subject;
  } catch (err) { /* no Newsletter tab */ }
  return { sent: sent, sendingNow: sendingNow };
}

function orderStats_(inMonth, nextEnd) {
  const orders = readOrders_();
  if (orders === null) return { hasTab: false };
  const done = orders.filter(o => o.status.toLowerCase() === "picked up" && inMonth(o.pickedUpOn));
  const open = orders.filter(isOrderOpen_);
  const sum = list => list.reduce((s, o) => s + (o.quantity || 0), 0);
  const upcoming = open.filter(o => o.deadline && o.deadline < nextEnd)
    .sort((a, b) => a.deadline - b.deadline || b.quantity - a.quantity);
  return {
    hasTab: true, completed: done.length, shirts: sum(done),
    open: open.length, openShirts: sum(open), upcoming: upcoming,
    noDeadline: open.filter(o => !o.deadline).length
  };
}

function agentProblems_(key) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AGENT_LOG_SHEET);
  const out = { count: 0, latest: [] };
  if (!sh || sh.getLastRow() < 2) return out;
  const tz = Session.getScriptTimeZone();
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(v => {
    const month = v[0] instanceof Date ? Utilities.formatDate(v[0], tz, "yyyy-MM") : String(v[0]).slice(0, 7);
    if (month !== key || !String(v[3]).trim()) return;
    out.count++;
    out.latest.push(String(v[1]) + ": " + String(v[3]).slice(0, 160));
  });
  out.latest = out.latest.slice(-5).reverse();
  return out;
}

function previousReport_(prevKey) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MONTHLY_REPORTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
  const row = rows.find(v => v[0] === prevKey);
  return row ? { active: Number(row[1]) || 0, joined: Number(row[2]) || 0 } : null;
}

/* Site check --------------------------------------------------------- */

function siteCheck_(posts, now) {
  const site = siteUrl_();
  const issues = [];
  const short = u => u.indexOf(site) === 0 ? (u.slice(site.length) || "/") : u;

  // 1. The home page and every post in the feed.
  const pages = [site + "/"].concat(posts.map(p => p.link));
  const pageRes = fetchAllSafe_(pages);
  const html = {};
  pages.forEach(u => {
    const r = pageRes[u];
    if (!r || r.code !== 200) issues.push("Page " + short(u) + " did not load (" + (r ? (r.code ? "HTTP " + r.code : r.error) : "no answer") + ").");
    else html[u] = r.text;
  });

  // 2. Every link and image on those pages that points to this website's server
  //    (external sites like Instagram often block automated checks, so they're skipped).
  const origin = (site.match(/^https?:\/\/[^\/]+/) || [site])[0];
  const links = new Map();
  Object.keys(html).forEach(page => {
    const re = /\b(?:href|src)\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(html[page]))) {
      const u = resolveUrl_(page, m[1]);
      if (u && u.indexOf(origin + "/") === 0 && pages.indexOf(u) === -1 && !links.has(u)) links.set(u, page);
    }
  });
  const linkList = Array.from(links.keys()).slice(0, 200);
  const linkRes = fetchAllSafe_(linkList);
  linkList.forEach(u => {
    const r = linkRes[u];
    if (!r || r.code !== 200) {
      issues.push("Broken link on " + short(links.get(u)) + ": " + short(u) + " (" + (r ? (r.code ? "HTTP " + r.code : r.error) : "no answer") + ").");
    }
  });

  // 3. Sales and featured months that have already passed.
  if (html[site + "/"]) stalePromos_(html[site + "/"], posts, now).forEach(x => issues.push(x));

  // 4. The signup system: the URL the website uses must answer.
  const cfg = fetchAllSafe_([site + "/assets/js/config.js"])[site + "/assets/js/config.js"];
  const api = cfg && cfg.code === 200 ? (cfg.text.match(/SALEM_API_URL\s*=\s*["']([^"']*)["']/) || [])[1] : null;
  if (!api) {
    issues.push("Could not read the signup system address from assets/js/config.js.");
  } else {
    const a = fetchAllSafe_([api])[api];
    let okJson = false;
    try { const j = JSON.parse(a.text); okJson = j.ok === true && j.service === "salem-subscribe"; } catch (err) { /* not JSON */ }
    if (!a || a.code !== 200 || !okJson) {
      issues.push("The signup system (Apps Script web app) did not answer correctly (" + (a && a.code ? "HTTP " + a.code : "no answer") +
        "). Signups, unsubscribes and preferences may be failing.");
    }
  }
  return { issues: issues, checked: pages.length + linkList.length + 2 };
}

// Fetches many URLs in parallel; never throws. { url: { code, text, error } }
function fetchAllSafe_(urls) {
  const out = {};
  for (let i = 0; i < urls.length; i += 40) {
    const batch = urls.slice(i, i + 40);
    try {
      UrlFetchApp.fetchAll(batch.map(u => ({ url: u, muteHttpExceptions: true, followRedirects: true })))
        .forEach((res, j) => { out[batch[j]] = { code: res.getResponseCode(), text: res.getContentText() }; });
    } catch (err) {
      // One bad URL fails the whole batch, so fall back to one at a time.
      batch.forEach(u => {
        try {
          const res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true });
          out[u] = { code: res.getResponseCode(), text: res.getContentText() };
        } catch (e) {
          out[u] = { code: 0, text: "", error: (e && e.message) || String(e) };
        }
      });
    }
  }
  return out;
}

// Turns a link found on a page into a full URL (or null for anchors, mailto:, etc.).
function resolveUrl_(base, href) {
  href = String(href || "").replace(/&amp;/g, "&").trim();
  if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return null;
  href = href.split("#")[0].split("?")[0];
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  const origin = (base.match(/^https?:\/\/[^\/]+/) || [""])[0];
  if (href.charAt(0) === "/") return origin + href;
  const dir = base.split("#")[0].split("?")[0].replace(/[^\/]*$/, "");
  const out = [];
  (dir.slice(origin.length) + href).split("/").forEach(p => {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  });
  return origin + ("/" + out.join("/")).replace(/^\/+/, "/");
}

// Sales or "Featured · <Month Year>" labels that are still showing after their month ended.
function stalePromos_(homeHtml, posts, now) {
  const current = now.getFullYear() * 12 + now.getMonth();
  const out = [];
  const text = plainText_(homeHtml.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "));
  const re = new RegExp("\\b(" + MONTH_NAMES.join("|") + ")\\s+(20\\d\\d)\\b", "g");
  const seen = new Set();
  let m;
  while ((m = re.exec(text))) {
    const when = Number(m[2]) * 12 + MONTH_NAMES.indexOf(m[1]);
    if (when < current && !seen.has(m[0])) {
      seen.add(m[0]);
      const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim();
      out.push('The home page still features "' + m[0] + '", which has passed ("…' + around + '…"). Update or remove that section.');
    }
  }
  posts.filter(p => (p.categories || []).some(c => /sale|promo|special|offer|deal/i.test(c))).forEach(p => {
    const words = p.title + " " + p.description;
    const posted = p.date.getFullYear() * 12 + p.date.getMonth();
    MONTH_NAMES.forEach((name, i) => {
      if (!new RegExp("\\b" + name + "\\b", "i").test(words)) return;
      let when = p.date.getFullYear() * 12 + i;
      if (when < posted) when += 12; // e.g. a December post about a January sale
      if (when < current) {
        out.push('Sale post "' + p.title + '" is about ' + name + ", which has passed, but it is still in the journal on the home page.");
      }
    });
  });
  return out;
}

/* Writing the report ------------------------------------------------- */

function plural_(n, one, many) { return n + " " + (n === 1 ? one : many); }

function plainSummary_(r) {
  const s = [];
  if (r.subs) {
    s.push("You have " + plural_(r.subs.active, "person", "people") + " on the Salem list. In " + r.monthName + ", " +
      r.subs.joined + " joined and " + r.subs.left + " left" +
      (r.subs.bounced ? ", and " + plural_(r.subs.bounced, "email address", "email addresses") + " stopped working" : "") + ".");
    if (r.prev) {
      const d = r.subs.joined - r.prev.joined;
      s.push(d > 0 ? "That's " + plural_(d, "more sign-up", "more sign-ups") + " than " + r.prevName + "."
        : d < 0 ? "That's " + plural_(-d, "fewer sign-up", "fewer sign-ups") + " than " + r.prevName + "."
        : "That's the same number of sign-ups as " + r.prevName + ".");
    }
  }
  if (r.orders && r.orders.hasTab) {
    s.push(plural_(r.orders.completed, "order", "orders") + " (" + plural_(r.orders.shirts, "shirt", "shirts") +
      ") were picked up, and " + r.orders.open + " " + (r.orders.open === 1 ? "is" : "are") + " still open.");
  }
  if (r.letters) {
    s.push(r.letters.sent.length ? plural_(r.letters.sent.length, "newsletter", "newsletters") + " went out."
      : "No newsletter went out this month. The tip below could make a good one.");
  }
  return s.join(" ");
}

// The same text is sent to the AI (when a key is set) and offered for copy-paste.
function reportPrompt_(r) {
  const L = [];
  L.push("I run Salem Custom Screen Printing, a small, faith-driven custom apparel shop in Chicago that serves " +
    "churches and the local community. I work on it part-time, and people order by messaging us on Instagram. " +
    "Here are my numbers for " + r.label + ":");
  if (r.subs) {
    L.push("- Email list: " + r.subs.active + " active subscribers; " + r.subs.joined + " joined, " + r.subs.left +
      " unsubscribed, " + r.subs.bounced + " bounced (net " + (r.subs.net >= 0 ? "+" : "") + r.subs.net + ")." +
      (r.prev ? " Previous month: " + r.prev.joined + " joined, " + r.prev.active + " active." : ""));
    L.push("- What subscribers are interested in: " + r.subs.interests.map(x => x[0] + " " + x[1]).join(", ") + ".");
  }
  if (r.letters) {
    L.push("- Newsletters sent: " + (r.letters.sent.length
      ? r.letters.sent.map(x => '"' + x.subject.replace(/\{firstName\}/g, "") + '" to ' + x.people + " people").join("; ")
      : "none") + ".");
  }
  L.push("- Journal posts published: " + (r.postsThisMonth.length ? r.postsThisMonth.map(t => '"' + t + '"').join(", ") : "none") + ".");
  if (r.orders && r.orders.hasTab) {
    L.push("- Orders: " + r.orders.completed + " picked up (" + r.orders.shirts + " shirts); " + r.orders.open +
      " still open (" + r.orders.openShirts + " shirts); " + r.orders.upcoming.length + " due by the end of " + r.nextName + ".");
  }
  L.push("");
  L.push("Please give me:");
  L.push("1. A 3-4 sentence summary in plain, friendly words.");
  L.push("2. 2-3 concrete ideas for " + r.nextName + " that fit a church and community outreach business. " +
    "Think about upcoming seasons such as Christmas, Easter, VBS and youth camps, and fundraisers.");
  L.push("3. One newsletter topic I could write about.");
  L.push("Keep it short: I have about 2 minutes to read it.");
  return L.join("\n");
}

function saveReportRow_(r) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MONTHLY_REPORTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MONTHLY_REPORTS_SHEET);
    sh.getRange(1, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange("A:A").setNumberFormat("@"); // keep "2026-11" as text, not a date
    sh.setColumnWidth(13, 420);
    sh.setColumnWidth(14, 320);
  }
  const s = r.subs || {}, o = r.orders || {};
  const line = [
    r.key, s.active, s.joined, s.left, s.bounced, s.net,
    r.letters ? r.letters.sent.length : "", o.hasTab ? o.completed : "", o.hasTab ? o.shirts : "", o.hasTab ? o.open : "",
    r.site ? r.site.issues.length : "", r.problems ? r.problems.count : "",
    safeCell_(r.ai || r.plain), safeCell_(r.tip), new Date()
  ].map(v => v == null ? "" : v);
  const keys = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(v => v[0]) : [];
  const at = keys.indexOf(r.key);
  const row = at === -1 ? sh.getLastRow() + 1 : at + 2;
  sh.getRange(row, 1, 1, line.length).setValues([line]);
}

// Monthly counters older than about a year are no longer needed.
function cleanOldStats_(now) {
  const props = PropertiesService.getScriptProperties();
  const cutoff = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 13, 1), Session.getScriptTimeZone(), "yyyy-MM");
  props.getKeys().filter(k => k.indexOf("STATS_") === 0 && k.slice(6) < cutoff).forEach(k => props.deleteProperty(k));
}

function sendReportEmail_(r) {
  const owner = ownerEmail_();
  if (!owner || !canSend_()) return false;
  const tz = Session.getScriptTimeZone();
  const h2 = t => '<h2 style="font-family:Georgia,serif;font-size:20px;margin:26px 0 8px;">' + esc_(t) + "</h2>";
  const p = t => '<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">' + t + "</p>";
  const li = items => '<ul style="font-size:14px;line-height:1.6;padding-left:20px;margin:0;">' +
    items.map(x => "<li>" + x + "</li>").join("") + "</ul>";
  const sign = n => (n > 0 ? "+" : "") + n;
  const text = [];

  // 1. Headline numbers
  const tiles = [];
  if (r.subs) {
    tiles.push(["On the list", r.subs.active, sign(r.subs.net) + " this month"]);
    tiles.push(["Joined", r.subs.joined, r.prev ? r.prev.joined + " in " + r.prevName : ""]);
    tiles.push(["Left", r.subs.left, r.subs.bounced ? r.subs.bounced + " bounced" : ""]);
  }
  if (r.letters) tiles.push(["Newsletters", r.letters.sent.length, r.letters.sendingNow ? "1 still sending" : ""]);
  if (r.orders && r.orders.hasTab) {
    tiles.push(["Orders picked up", r.orders.completed, plural_(r.orders.shirts, "shirt", "shirts")]);
    tiles.push(["Open orders", r.orders.open, plural_(r.orders.openShirts, "shirt", "shirts")]);
  }
  let html = '<div style="font-family:Helvetica,Arial,sans-serif;color:#1c2a42;max-width:640px;">' +
    '<div style="font-size:12px;letter-spacing:1px;color:#5b6577;">SALEM MONTHLY REPORT</div>' +
    '<h1 style="font-family:Georgia,serif;font-size:30px;margin:6px 0 16px;">' + esc_(r.label) + "</h1>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    tiles.map((t, i) => (i && i % 3 === 0 ? "</tr><tr>" : "") +
      '<td style="width:33%;padding:10px;background:#f1f3f5;border:4px solid #ffffff;vertical-align:top;">' +
      '<div style="font-size:12px;color:#5b6577;">' + esc_(t[0]) + "</div>" +
      '<div style="font-size:26px;font-weight:bold;">' + esc_(t[1]) + "</div>" +
      '<div style="font-size:12px;color:#5b6577;">' + esc_(t[2]) + "</div></td>").join("") +
    "</tr></table>";
  text.push("SALEM MONTHLY REPORT · " + r.label, "", tiles.map(t => t[0] + ": " + t[1] + (t[2] ? " (" + t[2] + ")" : "")).join("\n"));

  if (r.subs && r.subs.interests.length) {
    const list = r.subs.interests.map(x => esc_(x[0]) + " <strong>" + x[1] + "</strong>").join(" · ");
    html += p('<span style="color:#5b6577;">Interests:</span> ' + list);
    text.push("Interests: " + r.subs.interests.map(x => x[0] + " " + x[1]).join(", "));
  }
  if (r.letters && r.letters.sent.length) {
    html += li(r.letters.sent.map(x => "Newsletter “" + esc_(x.subject) + "” reached " + x.people + " people" +
      (x.days > 1 ? " over " + x.days + " days" : "")));
    text.push(r.letters.sent.map(x => 'Newsletter "' + x.subject + '": ' + x.people + " people" + (x.days > 1 ? " over " + x.days + " days" : "")).join("\n"));
  }

  // 2. Summary and ideas
  html += h2(r.ai ? "Summary and ideas" : "Summary");
  html += r.ai
    ? '<div style="font-size:15px;line-height:1.6;white-space:pre-wrap;">' + esc_(r.ai) + "</div>"
    : p(esc_(r.plain));
  text.push("", r.ai ? "SUMMARY AND IDEAS" : "SUMMARY", r.ai || r.plain);
  if (r.tip) {
    html += '<div style="background:#eef3f8;border-left:4px solid #2f5d8c;padding:12px 14px;margin-top:12px;">' +
      '<div style="font-size:12px;letter-spacing:1px;font-weight:bold;">IDEA FOR ' + esc_(r.nextName.toUpperCase()) + "</div>" +
      '<div style="font-size:15px;line-height:1.6;">' + esc_(r.tip) + "</div></div>";
    text.push("", "IDEA FOR " + r.nextName.toUpperCase(), r.tip);
  }

  // 3. Site check and problems
  html += h2("Website check");
  if (r.site) {
    html += r.site.issues.length ? li(r.site.issues.map(esc_))
      : p("Everything checked out (" + r.site.checked + " pages, links and images, plus the signup system).");
    text.push("", "WEBSITE CHECK", r.site.issues.length ? r.site.issues.map(x => "- " + x).join("\n") : "Everything checked out.");
  }
  if (r.problems && r.problems.count) {
    html += p("<strong>" + plural_(r.problems.count, "problem was", "problems were") + "</strong> logged by the automations this month. Latest:") +
      li(r.problems.latest.map(esc_)) + p('<span style="font-size:13px;color:#5b6577;">Details are in the Agent Log tab.</span>');
    text.push("Problems logged: " + r.problems.count + "\n" + r.problems.latest.map(x => "- " + x).join("\n"));
  }
  if (r.notes.length) {
    html += p('<span style="color:#a61b1b;">Could not check:</span> ' + esc_(r.notes.join("; ")));
    text.push("Could not check: " + r.notes.join("; "));
  }

  // 4. Orders coming up
  if (r.orders && r.orders.hasTab) {
    html += h2("Orders due by the end of " + r.nextName);
    const fmt = d => Utilities.formatDate(d, tz, "EEE, MMM d");
    if (r.orders.upcoming.length) {
      html += li(r.orders.upcoming.map(o => "<strong>" + esc_(fmt(o.deadline)) + "</strong> · " + esc_(o.customer) + " · " +
        esc_(o.quantity || "?") + " · " + esc_(o.description) + ' <span style="color:#5b6577;">(' + esc_(o.status || "no status") + ")</span>"));
    } else {
      html += p("Nothing due yet.");
    }
    if (r.orders.noDeadline) html += p('<span style="font-size:13px;color:#5b6577;">' + plural_(r.orders.noDeadline, "open order has", "open orders have") + " no deadline.</span>");
    text.push("", "ORDERS DUE BY THE END OF " + r.nextName.toUpperCase(),
      r.orders.upcoming.length ? r.orders.upcoming.map(o => fmt(o.deadline) + " · " + o.customer + " · " + (o.quantity || "?") + " · " + o.description).join("\n") : "Nothing due yet.");
  }

  // 5. Free AI help: a prompt to paste into claude.ai (only when the report had no AI section)
  if (!r.ai) {
    html += h2("Want more ideas?") +
      p("Copy everything in the box into a free chat at claude.ai. It has numbers only, no names or emails.") +
      '<pre style="white-space:pre-wrap;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5;background:#f1f3f5;padding:12px;border:1px solid #d6dbe4;">' +
      esc_(r.prompt) + "</pre>";
    text.push("", "WANT MORE IDEAS? Paste this into a free chat at claude.ai:", "", r.prompt);
  }

  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  html += p('<a href="' + esc_(sheetUrl) + '" style="color:#2f5d8c;">Open the Salem sheet</a>') + "</div>";
  text.push("", "Sheet: " + sheetUrl);

  MailApp.sendEmail({
    to: owner, name: "Salem website", subject: "Salem monthly report: " + r.label,
    body: text.join("\n"), htmlBody: html
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* New journal post → newsletter draft                                 */
/* ------------------------------------------------------------------ */
//
// Once a day, read the journal's RSS feed (SITE_URL/index.xml, made by Quarto).
// When a newer post appears, write a newsletter about it into the Newsletter
// tab (Status "Draft") and send Salem one short email. Nothing goes to the
// list: Salem previews and sends it from the menu as usual.
//
// It never replaces a newsletter Salem is writing by hand, or one that is
// sending. The draft is written by AI only when an API key is set; otherwise
// it is built from the post's title and description.
//
// Script Properties set by the script: LAST_POST_LINK, LAST_POST_DATE.

const POST_DRAFT_MARK = "DRAFT - not sent";

function feedUrl_() {
  return siteUrl_() + "/index.xml";
}

/** Posts in the feed, newest first: { title, link, description, date }. */
function readFeed_() {
  const res = UrlFetchApp.fetch(feedUrl_(), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("The journal feed returned HTTP " + res.getResponseCode() + " (" + feedUrl_() + ")");
  }
  const channel = XmlService.parse(res.getContentText()).getRootElement().getChild("channel");
  if (!channel) throw new Error("The journal feed has no <channel>.");
  return channel.getChildren("item").map(it => ({
    title: plainText_(it.getChildText("title")),
    link: String(it.getChildText("link") || "").trim(),
    description: plainText_(it.getChildText("description")),
    date: new Date(it.getChildText("pubDate") || 0),
    categories: it.getChildren("category").map(c => plainText_(c.getText()))
  })).filter(p => p.link).sort((a, b) => b.date - a.date);
}

// Feed text can carry HTML; keep just the words.
function plainText_(s) {
  return String(s || "").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

/** Daily trigger: drafts a newsletter when a new journal post appears. */
function checkNewPost() {
  const job = "new post check";
  try {
    const props = PropertiesService.getScriptProperties();
    const posts = readFeed_();
    if (!posts.length) return logAgent_(job, "The journal feed has no posts yet.");
    const latest = posts[0];
    const lastLink = props.getProperty("LAST_POST_LINK");
    const lastDate = Number(props.getProperty("LAST_POST_DATE") || 0);

    if (!lastLink) {
      rememberPost_(latest);
      return logAgent_(job, 'First run: now watching the journal. Latest post is "' + latest.title + '" (no draft made for it).');
    }
    if (latest.link === lastLink) return logAgent_(job, "No new post.");
    if (lastDate && latest.date.getTime() <= lastDate) {
      // e.g. a post was renamed or removed: not actually new.
      rememberPost_(latest);
      return logAgent_(job, 'The newest post changed to "' + latest.title + '" but it is not newer than the last one, so no draft was made.');
    }

    const result = draftFromPost_(latest, false);
    if (!result.waiting) rememberPost_(latest); // waiting = try again tomorrow
    if (result.drafted) {
      const emailed = sendDraftReadyEmail_(latest);
      result.message += emailed ? " Emailed Salem." : " (Salem was not emailed: no owner email or no quota left.)";
    } else if (result.kept) {
      sendDraftKeptEmail_(latest);
    }
    logAgent_(job, result.message);
  } catch (err) {
    logAgent_(job, "Could not check the journal feed.", (err && err.message) || String(err));
  }
}

/** Menu: "Draft newsletter from latest post". Asks before replacing an unsent hand-written draft. */
function draftNewsletterFromLatestPost() {
  const job = "draft from latest post";
  try {
    const posts = readFeed_();
    if (!posts.length) return notify_("The journal feed has no posts yet.");
    const latest = posts[0];
    const result = draftFromPost_(latest, true);
    if (result.drafted) rememberPost_(latest);
    logAgent_(job, result.message);
    notify_(result.message + (result.drafted ? "\n\nCheck the Newsletter tab, then use Salem list → Send me a preview." : ""));
  } catch (err) {
    logAgent_(job, "Could not make the draft.", (err && err.message) || String(err));
    notify_("Could not make the draft: " + ((err && err.message) || err));
  }
}

function rememberPost_(post) {
  PropertiesService.getScriptProperties().setProperties({
    LAST_POST_LINK: post.link,
    LAST_POST_DATE: String(post.date.getTime() || 0)
  });
}

// Writes the draft into the Newsletter tab when it's safe to.
// Returns { drafted | kept | waiting | cancelled: true, message }.
function draftFromPost_(post, fromMenu) {
  const lock = LockService.getDocumentLock(); // the same lock sendNewsletter holds
  if (!lock.tryLock(10000)) {
    return { waiting: true, message: 'A newsletter send is running, so the draft for "' + post.title + '" will wait.' };
  }
  try {
    if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NEWSLETTER_SHEET)) setupNewsletterTab();
    const n = readNewsletter_();
    if (n.status === "sending") {
      return { waiting: true, message: 'A newsletter is still sending, so the draft for "' + post.title + '" will wait until it finishes.' };
    }
    const replaceable = n.status === "sent" || (!n.subject && !n.message) || n.progress.indexOf(POST_DRAFT_MARK) === 0;
    if (!replaceable) {
      if (!fromMenu || !confirmReplaceDraft_(n, post)) {
        return fromMenu
          ? { cancelled: true, message: "Kept your current newsletter draft. Nothing was changed." }
          : { kept: true, message: 'New post "' + post.title + '", but Salem has an unsent newsletter draft, so it was kept and no draft was made.' };
      }
    }

    const d = composePostDraft_(post);
    setNewsletterField_(n, "Subject", d.subject);
    setNewsletterField_(n, "Heading", post.title);
    setNewsletterField_(n, "Message", d.message);
    setNewsletterField_(n, "Button label", "Read the full story");
    setNewsletterField_(n, "Button link", post.link);
    setNewsletterField_(n, "Send to", "Everyone");
    // Clear the Spanish rows: text left from an older newsletter must never go out with this one.
    NEWSLETTER_ES_FIELDS.forEach(f => { if (n.rows[f[0]]) setNewsletterField_(n, f[0], ""); });
    setNewsletterField_(n, "Status", "Draft");
    setNewsletterField_(n, "Progress", POST_DRAFT_MARK + " · " + (d.ai ? "written by AI" : "made from the post") +
      ' for "' + post.title + '" · ' + stamp_());
    return { drafted: true, message: 'Made a newsletter draft for "' + post.title + '" (' + (d.ai ? "AI-written" : "from the post's title and description") + ")." };
  } finally {
    lock.releaseLock();
  }
}

function confirmReplaceDraft_(n, post) {
  try {
    const ui = SpreadsheetApp.getUi();
    return ui.alert("Replace your newsletter draft?",
      'The Newsletter tab has an unsent draft ("' + (n.subject || "no subject") + '"). Replace it with a draft about "' +
      post.title + '"?', ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (err) {
    return false; // run from the editor: no window to ask in, so keep the draft
  }
}

// Subject + message for a post. Uses AI if a key is set, else a plain template.
function composePostDraft_(post) {
  const fallback = {
    ai: false,
    subject: "New on the Salem journal: " + post.title,
    message: "Hi {firstName},\n\nWe just shared something new on the Salem journal: \"" + post.title + "\"." +
      (post.description ? "\n\n" + post.description : "") +
      "\n\nWe'd love for you to take a look. If it sparks an idea for your church, team or event, " +
      "send us a message on Instagram and we'll help bring it to life.\n\nThank you for being part of the Salem circle."
  };

  const prompt =
    "Write a short newsletter email (80 to 140 words) for the Salem list, announcing a new post on the journal of " +
    BRAND + ", a small, faith-driven custom apparel shop in Chicago.\n\n" +
    "Voice: " + setting_("Business voice", "Warm, humble and plain.") + "\n\n" +
    "Post title: " + post.title + "\nPost summary: " + (post.description || "(none)") + "\n\n" +
    "Rules: start the message with exactly \"Hi {firstName},\" (the placeholder is filled in later). " +
    "Plain text only, no markdown, paragraphs separated by one blank line. Do not include a link, a sign-off " +
    "or a signature: a \"Read the full story\" button and Salem's sign-off are added automatically. " +
    "Never mention prices, discounts or dates unless they are in the summary. Ordering happens by messaging Salem on Instagram.\n\n" +
    'Reply with only JSON: {"subject": "...", "message": "..."}';
  const reply = askClaude_(prompt, 1500, "new post draft");
  if (!reply) return fallback;
  try {
    const j = JSON.parse((reply.match(/\{[\s\S]*\}/) || [""])[0]);
    const subject = String(j.subject || "").trim().slice(0, 120);
    const message = String(j.message || "").trim();
    if (!subject || !message) throw new Error("missing subject or message");
    return { ai: true, subject: subject, message: message };
  } catch (err) {
    logAgent_("new post draft", "AI reply was not usable; used the plain draft instead.", (err && err.message) || String(err));
    return fallback;
  }
}

function sendDraftReadyEmail_(post) {
  const owner = ownerEmail_();
  if (!owner || !canSend_()) return false;
  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  MailApp.sendEmail({
    to: owner, name: "Salem website",
    subject: 'Newsletter draft ready: "' + post.title + '"',
    body: 'A newsletter draft for "' + post.title + '" is ready. Preview it from the Salem list menu ' +
      "(Salem list → Send me a preview). Nothing has been sent to the list.\n\nOpen the sheet: " + sheetUrl
  });
  return true;
}

function sendDraftKeptEmail_(post) {
  const owner = ownerEmail_();
  if (!owner || !canSend_()) return;
  MailApp.sendEmail({
    to: owner, name: "Salem website",
    subject: 'New journal post: "' + post.title + '"',
    body: 'Your new post "' + post.title + '" is live. Your unsent newsletter draft was kept as it is. ' +
      "To replace it with a draft about the post, use Salem list → Draft newsletter from latest post.\n\n" +
      "Open the sheet: " + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  });
}

/* ------------------------------------------------------------------ */
/* List quality: bounced addresses (no AI)                             */
/* ------------------------------------------------------------------ */
//
// Once a week, look in this Gmail account for "message not delivered" replies
// from the last 8 days, and set matching subscribers to status "bounced".
// Newsletters only go to "active" rows, so bounced people are skipped.
// Rows are never deleted. To undo, change the status back to "active";
// signing up again on the website also makes the row active again.

const BOUNCE_QUERY = "(from:mailer-daemon OR from:postmaster) " +
  '(subject:"Delivery Status Notification" OR subject:"Address not found" OR subject:"Undeliverable" OR ' +
  'subject:"Mail delivery failed" OR subject:"Returned mail" OR subject:"Delivery failure") newer_than:8d';

function checkBounces() {
  const job = "bounce check";
  try {
    const threads = GmailApp.search(BOUNCE_QUERY, 0, 100);
    const failed = new Set();
    let messages = 0;
    threads.forEach(th => th.getMessages().forEach(m => {
      messages++;
      bouncedAddresses_(m).forEach(a => failed.add(a));
    }));

    let marked = 0, already = 0;
    if (failed.size) {
      // Same lock as the website: an unsubscribe deletes a row and shifts row numbers.
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        const t = table_();
        const now = new Date().toISOString();
        t.rows.forEach(r => {
          if (!failed.has(normEmail_(r.data.email))) return;
          if (r.data.status === "bounced") { already++; return; }
          if (!isActive_(r.data.status)) return;
          writeRow_(t, r.rowNumber, Object.assign({}, r.data, { status: "bounced", updatedAt: now }));
          marked++;
        });
        if (marked) countEvent_("bounced", marked);
      } finally {
        lock.releaseLock();
      }
    }

    const msg = "Read " + messages + " bounce message(s) from the last 8 days. Marked " + marked +
      " subscriber(s) as bounced" + (already ? " (" + already + " already marked)" : "") + ".";
    logAgent_(job, msg);
    notify_(msg + (marked ? '\n\nThey are now skipped by newsletters. Filter the Subscribers tab by status "bounced" to see them.' : ""));
  } catch (err) {
    logAgent_(job, "Bounce check did not finish.", (err && err.message) || String(err));
    notify_("The bounce check did not finish: " + ((err && err.message) || err));
  }
}

// The addresses a bounce message says failed. Prefers the X-Failed-Recipients
// header (Gmail adds it); otherwise reads only the explanation at the top of
// the message, never the quoted original email below it (an owner alert
// quotes a subscriber's address, which must not count as a bounce).
function bouncedAddresses_(m) {
  const out = new Set();
  const header = m.getHeader("X-Failed-Recipients");
  if (header) header.split(/[,\s]+/).forEach(a => { a = normEmail_(a); if (EMAIL_RE.test(a)) out.add(a); });
  if (!out.size) {
    const top = String(m.getPlainBody() || "")
      .split(/^.*(original message|forwarded message|message headers|reporting-mta:|^received:).*$/im)[0]
      .slice(0, 3000);
    (top.match(/[^\s<>"'(),;:\[\]]+@[^\s<>"'(),;:\[\]]+\.[a-z]{2,}/gi) || [])
      .forEach(a => out.add(normEmail_(a)));
  }
  // Never treat the shop's own addresses as bounced subscribers.
  [ownerEmail_(), Session.getEffectiveUser().getEmail()].forEach(a => out.delete(normEmail_(a)));
  Array.from(out).forEach(a => { if (/^(mailer-daemon|postmaster)@/i.test(a)) out.delete(a); });
  return out;
}

/**
 * Sets up every scheduled job. Safe to run again: it removes each job's old
 * trigger before adding it back, so there are never duplicates, and it picks
 * up changes such as a new "Report day" in Settings.
 */
function installTriggers() {
  const jobs = scheduledJobs_();
  const names = new Set(jobs.map(j => j.fn));
  let removed = 0;
  ScriptApp.getProjectTriggers()
    .filter(t => names.has(t.getHandlerFunction()))
    .forEach(t => { ScriptApp.deleteTrigger(t); removed++; });

  const done = [], failed = [];
  jobs.forEach(j => {
    try {
      if (typeof globalThis[j.fn] !== "function") throw new Error("function " + j.fn + " not found");
      j.when(ScriptApp.newTrigger(j.fn)).create();
      done.push(j.label || j.fn);
    } catch (err) {
      failed.push(j.fn + " (" + ((err && err.message) || err) + ")");
    }
  });

  const msg = jobs.length
    ? "Installed " + done.length + " automatic job(s)" + (done.length ? ":\n- " + done.join("\n- ") : ".") +
      (removed ? "\n\n(Replaced " + removed + " old trigger(s).)" : "")
    : "There are no automatic jobs to install yet.";
  logAgent_("install triggers", msg.replace(/\n+/g, " "), failed.join("; "));
  notify_(msg + (failed.length ? "\n\nCould not install:\n- " + failed.join("\n- ") : ""));
}

/* ------------------------------------------------------------------ */
/* Run these from the editor                                           */
/* ------------------------------------------------------------------ */

/** Run once after pasting this code, to grant Sheets + Gmail permissions. */
function authorizeOnce() {
  table_();
  console.log("Emails left today: " + MailApp.getRemainingDailyQuota());
  console.log("SITE_URL: " + siteUrl_());
  console.log("Owner email set (Settings or OWNER_EMAIL): " + Boolean(ownerEmail_()));
  console.log("ANTHROPIC_API_KEY set (optional): " +
    Boolean(PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY")));
  console.log("MAILING_ADDRESS set (optional): " + Boolean(mailingAddress_()));
  console.log("Gmail read access (bounce check): " + (GmailApp.getInboxUnreadCount() >= 0));
  console.log("Newsletter triggers: " + ScriptApp.getProjectTriggers().length); // asks for trigger permission
  CacheService.getScriptCache().put("auth_check", "1", 10);
  console.log("All set.");
}

/** Checks the AI connection with a tiny request. Sends no subscriber data. */
function testClaude() {
  const reply = askClaude_("Reply with one short, warm sentence greeting a small Chicago screen printing shop.", 300, "test claude");
  const msg = reply ? "AI is working. It said: " + reply : "AI did not answer. See the Agent Log tab for the reason.";
  logAgent_("test claude", reply ? "AI connection works." : "AI connection test failed (see the line above).");
  console.log(msg);
}

/** Optional: adds a test subscriber using the owner email, without the website. Delete the row afterwards. */
function testSubscribe() {
  testSubscribeAs_(ownerEmail_(), "en");
}

/**
 * Optional: adds a Spanish-speaking test subscriber at owner+es@… (Gmail
 * delivers "+" addresses to the same inbox). Delete the row afterwards.
 */
function testSubscribeSpanish() {
  testSubscribeAs_(ownerEmail_().replace("@", "+es@"), "es");
}

function testSubscribeAs_(email, lang) {
  const res = doPost({
    postData: {
      type: "text/plain",
      contents: JSON.stringify({
        action: "subscribe", firstName: lang === "es" ? "Prueba" : "Test", lastName: "Subscriber", email: email,
        interests: ["Individual shirts", "Church and youth events"], consent: true, lang: lang
      })
    }
  });
  console.log(res.getContent());
}
