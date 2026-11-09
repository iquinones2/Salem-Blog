/*
 * Salem list client. Every call to the Apps Script API goes through here.
 * Contract: POST JSON as text/plain (no CORS preflight), { action, ... } → { ok, status | error }.
 * See apps-script/Code.gs for the server side.
 *
 * window.SalemList exposes:
 *   subscribe(data), unsubscribe(token), getPreferences(token),
 *   updateInterests(token, interests), resendLink(email)
 *   takeToken()      – reads ?token=, keeps it for this tab, removes it from the address bar
 *   takePrefill()    – email handed over from a homepage / post signup box
 *   remember(k, v) / recall(k) – small sessionStorage helpers (never the URL)
 *
 * Failures resolve to { ok:false, error:"timeout" | "network" | "bad_response" | ... }
 * so callers only need one code path. Never logs personal data.
 */
(function () {
  "use strict";

  var TIMEOUT_MS = 15000;
  var SESSION_PREFIX = "salem-list:";
  var LOCAL_DB_KEY = "salem-list-local-v1";

  function apiUrl() { return String(window.SALEM_API_URL || "").trim(); }

  /* ---------- session helpers (tab-scoped, never in the URL) ---------- */
  function remember(key, value) {
    try {
      if (value == null) sessionStorage.removeItem(SESSION_PREFIX + key);
      else sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(value));
    } catch (e) { /* storage blocked: the page still works, just without hand-off */ }
  }
  function recall(key) {
    try {
      var raw = sessionStorage.getItem(SESSION_PREFIX + key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  }

  /* ---------- transport ---------- */
  function post(payload) {
    if (!apiUrl()) return Promise.resolve(localApi(payload));

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);

    return fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.json().catch(function () { return { ok: false, error: "bad_response" }; });
      })
      .then(function (data) {
        return data && typeof data === "object" ? data : { ok: false, error: "bad_response" };
      })
      .catch(function (err) {
        return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "network" };
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ---------- localStorage stand-in (only when SALEM_API_URL is empty) ---------- */
  function localApi(p) {
    var db;
    try { db = JSON.parse(localStorage.getItem(LOCAL_DB_KEY) || "[]"); } catch (e) { db = []; }
    function save() { try { localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db)); } catch (e) {} }
    function byToken(t) { return db.filter(function (r) { return r.token === t && r.status === "active"; })[0]; }
    function uuid() {
      return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    }

    switch (p.action) {
      case "subscribe": {
        if (p.website) return { ok: true, status: "created" };
        var email = String(p.email || "").trim().toLowerCase();
        var row = db.filter(function (r) { return r.email === email; })[0];
        if (row && row.status === "active") return { ok: true, status: "exists" };
        var fresh = { token: uuid(), firstName: p.firstName, email: email, interests: p.interests || [], status: "active" };
        if (row) { Object.assign(row, fresh); save(); return { ok: true, status: "resubscribed" }; }
        db.push(fresh); save();
        return { ok: true, status: "created" };
      }
      case "unsubscribe": {
        var u = db.filter(function (r) { return r.token === p.token; })[0];
        if (!u) return { ok: true, status: "not_found" };
        u.status = "unsubscribed"; save();
        return { ok: true, status: "unsubscribed" };
      }
      case "unsubscribe_by_email": {
        var e = String(p.email || "").trim().toLowerCase();
        db = db.filter(function (r) {
          return !(r.email === e && String(r.firstName || "").toLowerCase() === String(p.firstName || "").trim().toLowerCase());
        });
        save();
        return { ok: true, status: "unsubscribed" };
      }
      case "get_preferences": {
        var g = byToken(p.token);
        return g ? { ok: true, status: "found", firstName: g.firstName, interests: g.interests } : { ok: true, status: "not_found" };
      }
      case "update_interests": {
        var m = byToken(p.token);
        if (!m) return { ok: true, status: "not_found" };
        m.interests = p.interests || []; save();
        return { ok: true, status: "updated" };
      }
      case "resend_link":
        return { ok: true, status: "ok" };
      default:
        return { ok: false, error: "unknown_action" };
    }
  }

  /* ---------- URL token hand-off ---------- */
  // Reads ?token=, keeps it in sessionStorage for this tab (so a reload still
  // works), and strips it from the address bar so it isn't bookmarked, shared,
  // or sent as a referrer.
  function takeToken() {
    var params = new URLSearchParams(window.location.search);
    var token = (params.get("token") || "").trim();
    if (token) {
      remember("token", token);
      params.delete("token");
      var query = params.toString();
      history.replaceState(null, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
      return token;
    }
    return recall("token") || "";
  }

  // Email typed into a homepage / post signup box (or an old ?email= link).
  function takePrefill() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get("email");
    if (fromUrl) {
      params.delete("email");
      var query = params.toString();
      history.replaceState(null, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    }
    var email = fromUrl || recall("prefill") || "";
    remember("prefill", null);
    return email;
  }

  // Homepage and post-footer "Count me in" boxes: carry the email to the
  // subscribe page in sessionStorage instead of the query string.
  function bindHandoffForms() {
    document.querySelectorAll("form[data-list-handoff]").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        var input = form.querySelector('input[type="email"]');
        if (!input || !input.checkValidity()) return; // let the browser show its message
        event.preventDefault();
        remember("prefill", input.value.trim());
        window.location.href = form.getAttribute("action");
      });
    });
  }

  // "Email me a fresh link" forms on the unsubscribe / preferences pages.
  // Expects an email input, a submit button, and a [role=status] element.
  function bindResendForm(form) {
    var input = form.querySelector('input[type="email"]');
    var button = form.querySelector('button[type="submit"]');
    var status = form.querySelector('[role="status"]');
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!input.checkValidity()) {
        input.setAttribute("aria-invalid", "true");
        status.textContent = "Enter a complete email address, such as you@example.com.";
        status.dataset.tone = "error";
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      button.disabled = true;
      status.dataset.tone = "info";
      status.textContent = "Sending…";
      resendLink(input.value.trim()).then(function (res) {
        button.disabled = false;
        status.dataset.tone = res.ok ? "info" : "error";
        status.textContent = res.ok
          ? "If that address is on the Salem list, a fresh link is on its way. It can take a few minutes."
          : errorMessage(res);
      });
    });
  }

  function resendLink(email) { return post({ action: "resend_link", email: email }); }

  // Friendly copy for a failed call.
  function errorMessage(res) {
    switch (res && res.error) {
      case "timeout": return "Salem didn’t answer in time. Please check your connection and try again.";
      case "network": return "We couldn’t reach Salem. Please check your connection and try again.";
      case "busy": return "Salem is busy right now. Please try again in a moment.";
      default: return (res && res.message) || "Something went wrong on our side. Please try again, or message Salem on Instagram.";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindHandoffForms);
  else bindHandoffForms();

  window.SalemList = {
    subscribe: function (data) { return post(Object.assign({ action: "subscribe" }, data)); },
    unsubscribe: function (token) { return post({ action: "unsubscribe", token: token }); },
    unsubscribeByEmail: function (data) { return post(Object.assign({ action: "unsubscribe_by_email" }, data)); },
    getPreferences: function (token) { return post({ action: "get_preferences", token: token }); },
    updateInterests: function (token, interests) { return post({ action: "update_interests", token: token, interests: interests }); },
    resendLink: resendLink,
    bindResendForm: bindResendForm,
    errorMessage: errorMessage,
    takeToken: takeToken,
    takePrefill: takePrefill,
    remember: remember,
    recall: recall,
    isLocal: function () { return !apiUrl(); }
  };
})();
