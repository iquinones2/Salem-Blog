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
 * Script Properties used: SITE_URL, OWNER_EMAIL, MAILING_ADDRESS (optional)
 * (NEWSLETTER_CAMPAIGN is set and cleared by the script while a newsletter sends.)
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
    esc_(mailingAddress_() || "Chicago, Illinois") + ' &middot; Custom shirts, made with care.<br><br>' +
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
    .addToUi();
}

/** Creates the "Newsletter" tab with its labels. Safe to run again: it won't overwrite a draft. */
function setupNewsletterTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(NEWSLETTER_SHEET)) {
    notify_('The "' + NEWSLETTER_SHEET + '" tab already exists. Nothing was changed.');
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
  notify_('Created the "' + NEWSLETTER_SHEET + '" tab. Write the email in column B, then use Salem list → Send me a preview.');
}

/** Sends one copy of the current newsletter to OWNER_EMAIL, so Salem can check it first. */
function previewNewsletter() {
  const owner = PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL");
  if (!owner) return notify_("Set the OWNER_EMAIL Script Property first, so the preview has somewhere to go.");
  const n = readNewsletter_();
  if (!n.subject && !n.message) return notify_("Write a Subject and Message in the Newsletter tab first.");
  if (!canSend_()) return notify_("Gmail's daily email limit is used up. Try again tomorrow.");

  // Preview links use a fake token: they open the right pages but won't change anything.
  const m = renderNewsletter_(n, { firstName: "Friend", token: "preview" });
  MailApp.sendEmail({ to: owner, subject: "[Preview] " + m.subject, name: BRAND, body: m.text, htmlBody: m.html });

  const problems = newsletterProblems_(n);
  notify_("Preview sent to OWNER_EMAIL." +
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

  const count = newsletterRecipients_(n, table_()).length;
  if (!count) return notify_('Nobody on the list matches "Send to: ' + n.sendTo + '". Nothing was sent.');

  const again = n.status === "sent" ? "\n\nThis newsletter was already sent once. Sending again emails everyone a second time." : "";
  const days = Math.ceil(count / 90);
  const timing = days > 1 ? "\n\nGmail's daily limit means this takes about " + days + " days. It continues each morning at 9am." : "";
  let answer;
  try {
    answer = ui.alert("Send the Salem newsletter?",
      'Send "' + n.subject + '" to ' + count + (count === 1 ? " person" : " people") +
      (n.sendTo === "Everyone" ? "" : " interested in " + n.sendTo) + "?" + again + timing,
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
  return {
    sh: sh,
    rows: rows,
    subject: f["Subject"].trim(),
    heading: f["Heading"].trim(),
    message: f["Message"].replace(/\r\n?/g, "\n").trim(),
    buttonLabel: f["Button label"].trim(),
    buttonLink: f["Button link"].trim(),
    sendTo: f["Send to"].trim() || "Everyone",
    status: f["Status"].trim().toLowerCase()
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
  return p;
}

function newsletterRecipients_(n, t) {
  const want = n.sendTo.toLowerCase();
  return t.rows.filter(r =>
    isActive_(r.data.status) && r.data.token && EMAIL_RE.test(r.data.email) &&
    (want === "everyone" || toList_(r.data.interests).some(i => i.toLowerCase() === want)));
}

function renderNewsletter_(n, rec) {
  const name = rec.firstName || "friend";
  const fill = s => s.replace(/\{firstName\}/g, name);
  const l = links_(rec);
  const paras = fill(n.message).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const heading = fill(n.heading);

  const inner =
    (heading ? '<h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.15;margin:10px 0 16px;">' + esc_(heading) + "</h1>" : "") +
    paras.map(p => '<p style="font-size:16px;line-height:1.6;">' + esc_(p).replace(/\n/g, "<br>") + "</p>").join("") +
    (n.buttonLink
      ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">' +
        button_(n.buttonLink, n.buttonLabel, true) + "</table>"
      : "") +
    '<p style="font-size:14px;line-height:1.6;margin-top:20px;">Made with care. Worn with purpose.<br>&mdash; Salem</p>';

  const text =
    (heading ? heading + "\n\n" : "") + paras.join("\n\n") +
    (n.buttonLink ? "\n\n" + n.buttonLabel + ": " + n.buttonLink : "") +
    "\n\nMade with care. Worn with purpose. — Salem\n\n" +
    BRAND + "\n" + (mailingAddress_() || "Chicago, Illinois") + "\n" +
    "You're receiving this because you joined the Salem list.\n" +
    "Update interests: " + l.preferences + "\nUnsubscribe: " + l.unsubscribe;

  return { subject: fill(n.subject), html: emailShell_(inner, l), text: text };
}

// Starts a fresh send: new campaign id, empty progress log.
function startNewsletter_(n) {
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty("NEWSLETTER_CAMPAIGN");
  if (old) finishNewsletter_(newsletterLog_(), old);
  props.setProperty("NEWSLETTER_CAMPAIGN", Utilities.getUuid());
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
  stopNewsletterTrigger_();
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
/* Run these from the editor                                           */
/* ------------------------------------------------------------------ */

/** Run once after pasting this code, to grant Sheets + Gmail permissions. */
function authorizeOnce() {
  table_();
  console.log("Emails left today: " + MailApp.getRemainingDailyQuota());
  console.log("SITE_URL: " + siteUrl_());
  console.log("OWNER_EMAIL set: " + Boolean(PropertiesService.getScriptProperties().getProperty("OWNER_EMAIL")));
  console.log("MAILING_ADDRESS set (optional): " + Boolean(mailingAddress_()));
  console.log("Newsletter triggers: " + ScriptApp.getProjectTriggers().length); // asks for trigger permission
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
