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
 * Script Properties used: SITE_URL, OWNER_EMAIL
 */

const SHEET_NAME = "Subscribers";
const HEADERS = [
  "id", "token", "firstName", "lastName", "email", "phone",
  "birthdayMonth", "birthdayDay", "interests", "heardAbout",
  "consent", "consentAt", "status", "createdAt", "updatedAt", "unsubscribedAt"
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BRAND = "Salem Custom Screen Printing";

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
    trySend_("welcome", () => sendWelcome_(merged));
    return { ok: true, status: "resubscribed" };
  }

  const record = Object.assign({ id: Utilities.getUuid(), createdAt: now }, fresh);
  writeRow_(t, t.sh.getLastRow() + 1, record);
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
  if (row) t.sh.deleteRow(row.rowNumber);
  return done;
}

function getPreferences_(b) {
  const row = findActiveByToken_(table_(), b.token);
  if (!row) return { ok: true, status: "not_found" };
  return { ok: true, status: "found", firstName: row.data.firstName, interests: toList_(row.data.interests) };
}

function updateInterests_(b) {
  const t = table_();
  const row = findActiveByToken_(t, b.token);
  if (!row) return { ok: true, status: "not_found" };
  writeRow_(t, row.rowNumber, Object.assign({}, row.data, {
    interests: toList_(b.interests).join(", "),
    updatedAt: new Date().toISOString()
  }));
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
  const rows = values.slice(1).map((r, i) => {
    const data = {};
    headers.forEach((h, j) => { if (h) data[h] = String(r[j]); });
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
function links_(rec) {
  const site = siteUrl_();
  const tok = encodeURIComponent(rec.token);
  return {
    site: site,
    journal: site + "/index.html#journal",
    shop: site + "/shop.html",
    unsubscribe: site + "/unsubscribe.html?token=" + tok,
    preferences: site + "/preferences.html?token=" + tok
  };
}

function button_(href, label, primary) {
  const style = primary
    ? "background:#2f5d8c;color:#ffffff;border:1px solid #2f5d8c;"
    : "background:#ffffff;color:#1c2a42;border:1px solid #1c2a42;";
  return '<tr><td style="padding:6px 0;"><a href="' + esc_(href) + '" style="display:block;text-align:center;' +
    style + 'padding:12px 16px;border-radius:4px;font-size:15px;text-decoration:none;">' + esc_(label) + ' &#8599;</a></td></tr>';
}

function emailShell_(inner, l) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#e9ecef;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9ecef;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#f6f5f1;font-family:Helvetica,Arial,sans-serif;color:#1c2a42;">' +
    '<tr><td style="padding:28px 28px 8px;">' +
    '<span style="font-family:Georgia,serif;font-size:26px;letter-spacing:1px;">SALEM</span>' +
    '<span style="font-size:11px;letter-spacing:1px;padding-left:10px;">CUSTOM SCREEN PRINTING</span>' +
    '<div style="font-size:12px;letter-spacing:1px;color:#5b6577;padding-top:8px;">CHICAGO, ILLINOIS</div></td></tr>' +
    '<tr><td style="padding:16px 28px 28px;">' + inner + '</td></tr>' +
    '<tr><td style="background:#1c2a42;color:#d6dbe4;padding:24px 28px;font-size:12px;line-height:1.6;">' +
    '<strong style="color:#ffffff;font-size:14px;">' + BRAND + '</strong><br>' +
    'Chicago, Illinois &middot; Custom shirts, made with care.<br><br>' +
    "You're receiving this because you joined the Salem list.<br>" +
    '<a href="' + esc_(l.unsubscribe) + '" style="color:#ffffff;">Unsubscribe</a> &nbsp;&nbsp; ' +
    '<a href="' + esc_(l.preferences) + '" style="color:#ffffff;">Update interests</a>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function sendWelcome_(rec) {
  if (!canSend_()) return;
  const l = links_(rec);
  const interests = toList_(rec.interests);
  const interestHtml = interests.length
    ? '<div style="background:#e9ecef;padding:16px 18px;margin:20px 0;"><div style="font-size:12px;letter-spacing:1px;font-weight:bold;padding-bottom:8px;">YOUR INTERESTS</div>' +
      interests.map(i => '<div style="font-size:14px;padding:3px 0;">&#10003; ' + esc_(i) + '</div>').join("") + '</div>'
    : "";

  const inner =
    '<div style="font-size:12px;letter-spacing:1px;font-weight:bold;">GOOD THINGS, IN YOUR INBOX</div>' +
    '<h1 style="font-family:Georgia,serif;font-size:34px;line-height:1.15;margin:14px 0;">Welcome to the Salem circle.</h1>' +
    '<p style="font-size:16px;line-height:1.6;">Hello, ' + esc_(rec.firstName) + '. Thanks for joining the Salem list. ' +
    "We're a small, faith-driven custom apparel business in Chicago, and we're glad you're here.</p>" +
    '<p style="font-size:14px;line-height:1.6;">Expect studio stories, seasonal offers, and a little inspiration. ' +
    'Every shirt we print carries more than ink &mdash; it carries a message.</p>' +
    interestHtml +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    button_(l.journal, "Explore the Salem journal", true) +
    button_(l.shop, "Start a shirt idea", false) + '</table>' +
    '<p style="font-size:14px;line-height:1.6;margin-top:20px;">Made with care. Worn with purpose.<br>&mdash; Salem</p>';

  const text =
    "Welcome to the Salem circle.\n\nHello, " + rec.firstName + ". Thanks for joining the Salem list. " +
    "We're a small, faith-driven custom apparel business in Chicago, and we're glad you're here.\n\n" +
    (interests.length ? "Your interests: " + interests.join(", ") + "\n\n" : "") +
    "Explore the Salem journal: " + l.journal + "\nStart a shirt idea: " + l.shop + "\n\n" +
    "Made with care. Worn with purpose. — Salem\n\n" +
    "Update interests: " + l.preferences + "\nUnsubscribe: " + l.unsubscribe;

  MailApp.sendEmail({
    to: rec.email, subject: "Welcome to the Salem circle", name: BRAND,
    body: text, htmlBody: emailShell_(inner, l)
  });
}

function sendLinks_(rec) {
  if (!canSend_()) return;
  const l = links_(rec);
  const inner =
    '<h1 style="font-family:Georgia,serif;font-size:28px;margin:10px 0 14px;">Your Salem list links</h1>' +
    '<p style="font-size:15px;line-height:1.6;">Hi ' + esc_(rec.firstName) +
    ", you're already on the Salem list. Use these links to update what you hear about, or to leave the list.</p>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    button_(l.preferences, "Update my interests", true) +
    button_(l.unsubscribe, "Unsubscribe", false) + '</table>';
  const text = "Hi " + rec.firstName + ", you're already on the Salem list.\n\nUpdate interests: " +
    l.preferences + "\nUnsubscribe: " + l.unsubscribe;
  MailApp.sendEmail({
    to: rec.email, subject: "Your Salem list links", name: BRAND,
    body: text, htmlBody: emailShell_(inner, l)
  });
}

function sendOwnerAlert_(rec) {
  const owner = PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL");
  if (!owner || !canSend_()) return;
  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const lines = [
    ["Name", rec.firstName + " " + rec.lastName],
    ["Email", rec.email],
    ["Phone", rec.phone || "—"],
    ["Interests", rec.interests || "—"],
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
/* Run these from the editor                                           */
/* ------------------------------------------------------------------ */

/** Run once after pasting this code, to grant Sheets + Gmail permissions. */
function authorizeOnce() {
  table_();
  console.log("Emails left today: " + MailApp.getRemainingDailyQuota());
  console.log("SITE_URL: " + siteUrl_());
  console.log("OWNER_EMAIL set: " + Boolean(PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL")));
  CacheService.getScriptCache().put("auth_check", "1", 10);
  console.log("All set.");
}

/** Optional: adds a test subscriber using OWNER_EMAIL, without the website. Delete the row afterwards. */
function testSubscribe() {
  const owner = PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL");
  const res = doPost({
    postData: {
      type: "text/plain",
      contents: JSON.stringify({
        action: "subscribe", firstName: "Test", lastName: "Subscriber", email: owner,
        interests: ["Individual shirts", "Church & youth events"], consent: true
      })
    }
  });
  console.log(res.getContent());
}
