/*
 * Join the Salem list form (subscribe.qmd and es/subscribe.qmd).
 * Every user-facing string is in TEXT below; the page's <html lang> picks en or es.
 * Values sent to the sheet stay in English on both pages (interests, birthday month,
 * "heard about"), so the sheet and newsletter audiences don't depend on the language.
 */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  const TEXT = SalemList.pick({
    en: {
      audience: {
        new: { heading: "Join the Salem list.", intro: "Name and email are required. Everything else is optional.", submit: "Join the Salem list" },
        returning: { heading: "Welcome back.", intro: "Thanks for printing with us. Stay close for reorder openings, seasonal offers, and new designs.", submit: "Keep me in the loop" }
      },
      required: "This field is required.",
      emailFormat: "Enter a complete email address, such as you@example.com.",
      monthMissing: "Please select a birthday month.",
      dayMissing: "Please enter a birthday day.",
      dayTooBig: function (month, days) { return month + " has only " + days + " days. Please enter a valid day."; },
      phone: "Enter a full phone number, or leave it blank.",
      consent: "Please agree to receive emails so we can add you to the list.",
      optional: "(optional)",
      sending: "Sending…",
      sendingTitle: "Sending your request…",
      sendingCopy: "Please wait. The form is temporarily disabled.",
      existsTitle: "You’re already on the list.",
      existsCopy: "No need to sign up twice. We can email you a link to update your interests.",
      checkTitle: "Please check the highlighted fields.",
      checkCopy: "Fix the fields marked below, then send again.",
      failTitle: "We couldn’t add you just yet.",
      resendButton: "Email me my preferences link",
      resentTitle: "Check your inbox.",
      resentCopy: "If that address is on the Salem list, a link to update your interests is on its way.",
      resendFailTitle: "We couldn’t send the link.",
      fields: null // the server's own (English) messages are used
    },
    es: {
      audience: {
        new: { heading: "Únase a la lista de Salem.", intro: "El nombre y el correo son obligatorios. Todo lo demás es opcional.", submit: "Unirme a la lista de Salem" },
        returning: { heading: "Qué gusto verle de nuevo.", intro: "Gracias por imprimir con nosotros. Entérese primero cuando abramos pedidos, de las ofertas de temporada y de los diseños nuevos.", submit: "Quiero estar al tanto" }
      },
      required: "Este campo es obligatorio.",
      emailFormat: "Escriba un correo electrónico completo, por ejemplo usted@ejemplo.com.",
      monthMissing: "Seleccione el mes de su cumpleaños.",
      dayMissing: "Escriba el día de su cumpleaños.",
      dayTooBig: function (month, days) { return month + " solo tiene " + days + " días. Escriba un día válido."; },
      phone: "Escriba un número de teléfono completo o deje el campo vacío.",
      consent: "Acepte recibir correos para que podamos agregarle a la lista.",
      optional: "(opcional)",
      sending: "Enviando…",
      sendingTitle: "Enviando su solicitud…",
      sendingCopy: "Espere un momento. El formulario está desactivado mientras tanto.",
      existsTitle: "Usted ya está en la lista.",
      existsCopy: "No hace falta registrarse dos veces. Podemos enviarle un enlace para actualizar sus intereses.",
      checkTitle: "Revise los campos marcados.",
      checkCopy: "Corrija los campos marcados abajo y vuelva a enviar.",
      failTitle: "Todavía no pudimos agregarle.",
      resendButton: "Enviarme mi enlace de preferencias",
      resentTitle: "Revise su correo.",
      resentCopy: "Si ese correo está en la lista de Salem, le enviamos un enlace para actualizar sus intereses.",
      resendFailTitle: "No pudimos enviar el enlace.",
      // The server answers in English; these replace its per-field messages.
      fields: {
        firstName: "Escriba su nombre.",
        lastName: "Escriba su apellido.",
        email: "Escriba un correo electrónico válido.",
        phone: "Escriba un número de teléfono completo o deje el campo vacío.",
        consent: "Acepte recibir correos para que podamos agregarle a la lista.",
        other: "Revise este campo."
      }
    }
  });

  const form = document.getElementById("sub-form");
  if (!form) return;
  const monthInput = document.getElementById("bmonth");
  const dayInput = document.getElementById("bday");
  const phoneInput = document.getElementById("phone");
  const emailInput = document.getElementById("email");
  const errorBox = document.getElementById("form-error");
  const submitLabel = document.getElementById("signup-submit-label");
  const notice = document.getElementById("list-notice");
  const noticeActions = document.getElementById("list-notice-actions");
  const resendButton = document.getElementById("resend-link");
  const audienceRadios = document.querySelectorAll('input[name="audience"]');

  // Server field names → input ids
  const FIELD_IDS = { firstName: "first", lastName: "last", email: "email", phone: "phone", consent: "consent" };

  function currentAudience() {
    return form.closest(".signup-card").querySelector('input[name="audience"]:checked').value;
  }

  function applyAudience() {
    const audience = currentAudience();
    const copy = TEXT.audience[audience];
    document.getElementById("signup-heading").textContent = copy.heading;
    document.getElementById("signup-intro").textContent = copy.intro;
    submitLabel.textContent = copy.submit;
    form.querySelectorAll("[data-audience]").forEach(function (field) {
      field.hidden = field.dataset.audience !== audience;
    });
  }

  audienceRadios.forEach(function (radio) {
    radio.addEventListener("change", applyAudience);
  });

  // Email typed on the homepage or a post (handed over without using the URL)
  const prefill = SalemList.takePrefill();
  if (prefill) emailInput.value = prefill;

  /* ---------- Notice: loading / error / already subscribed ---------- */
  function showNotice(tone, title, copy, options) {
    options = options || {};
    notice.dataset.tone = tone;
    notice.setAttribute("role", tone === "error" ? "alert" : "status");
    document.getElementById("list-notice-title").textContent = title;
    document.getElementById("list-notice-copy").textContent = copy;
    noticeActions.hidden = !options.actions;
    if (options.focus) notice.focus();
  }

  function clearNotice() {
    notice.dataset.tone = "none";
    noticeActions.hidden = true;
  }

  /* ---------- Per-field messages (aria-describedby) ---------- */
  function setFieldError(input, message) {
    const id = input.id + "-error";
    let msg = document.getElementById(id);
    const describedBy = (input.getAttribute("aria-describedby") || "").split(" ").filter(function (x) { return x && x !== id; });
    if (message) {
      if (!msg) {
        msg = document.createElement("p");
        msg.id = id;
        msg.className = "field-error";
        const anchor = input.closest(".consent-check") || input.closest(".form-field") || input;
        anchor.insertAdjacentElement("afterend", msg);
      }
      msg.textContent = message;
      describedBy.push(id);
      input.setAttribute("aria-invalid", "true");
    } else {
      if (msg) msg.remove();
      input.removeAttribute("aria-invalid");
    }
    if (describedBy.length) input.setAttribute("aria-describedby", describedBy.join(" "));
    else input.removeAttribute("aria-describedby");
  }

  function clearFieldErrors() {
    form.querySelectorAll("[aria-invalid]").forEach(function (input) { setFieldError(input, ""); });
  }

  // A message in the page's language (the browser's own would follow the browser's language).
  function messageFor(input) {
    if (input.id === "consent") return TEXT.consent;
    if (input.validity.customError) return input.validationMessage;
    if (input.validity.valueMissing) return TEXT.required;
    if (input.validity.typeMismatch && input.type === "email") return TEXT.emailFormat;
    return input.validationMessage;
  }

  /* ---------- Client validation ---------- */
  function validateBirthday() {
    const month = monthInput.value;
    const day = dayInput.value;
    monthInput.setCustomValidity("");
    dayInput.setCustomValidity("");

    // Birthday is optional if both fields are empty.
    if (month === "" && day === "") return true;

    // If one field is filled, require the other.
    if (month === "") {
      monthInput.setCustomValidity(TEXT.monthMissing);
      return false;
    }
    if (day === "") {
      dayInput.setCustomValidity(TEXT.dayMissing);
      return false;
    }

    // Use a non-leap year, so February has 28 days.
    const daysInMonth = new Date(2001, monthInput.selectedIndex, 0).getDate();
    const dayNumber = Number(day);
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > daysInMonth) {
      const monthName = monthInput.options[monthInput.selectedIndex].text; // shown in the page's language
      dayInput.setCustomValidity(TEXT.dayTooBig(monthName, daysInMonth));
      return false;
    }
    return true;
  }

  // Same rule as the server: 10–15 digits once a leading US "1" is dropped.
  function validatePhone() {
    let digits = phoneInput.value.replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    phoneInput.setCustomValidity(
      phoneInput.value.trim() && (digits.length < 10 || digits.length > 15) ? TEXT.phone : ""
    );
  }

  monthInput.addEventListener("change", validateBirthday);
  dayInput.addEventListener("input", validateBirthday);
  phoneInput.addEventListener("input", validatePhone);

  // Drop a field's message as soon as it's fixed.
  ["input", "change"].forEach(function (type) {
    form.addEventListener(type, function (event) {
      const input = event.target;
      if (input.getAttribute && input.getAttribute("aria-invalid") && input.checkValidity()) {
        setFieldError(input, "");
      }
    });
  });

  /* ---------- Loading state ---------- */
  function setBusy(busy) {
    form.setAttribute("aria-busy", busy ? "true" : "false");
    form.querySelectorAll("input, select, textarea, button").forEach(function (control) {
      if (control.id !== "website") control.disabled = busy;
    });
    audienceRadios.forEach(function (radio) { radio.disabled = busy; });
    form.classList.toggle("is-sending", busy);
    submitLabel.textContent = busy ? TEXT.sending : TEXT.audience[currentAudience()].submit;
  }

  function collect() {
    const audience = currentAudience();
    return {
      firstName: document.getElementById("first").value.trim(),
      lastName: document.getElementById("last").value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      birthdayMonth: monthInput.value, // English month name (the option's value) on both pages
      birthdayDay: dayInput.value ? String(Number(dayInput.value)) : "",
      interests: Array.from(form.querySelectorAll('input[name="interest"]:checked')).map(function (box) { return box.value; }),
      heardAbout: audience === "new" ? document.getElementById("source").value : "",
      consent: document.getElementById("consent").checked,
      website: document.getElementById("website").value
    };
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;

    clearFieldErrors();
    clearNotice();
    validateBirthday();
    validatePhone();
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector("input:invalid, select:invalid");
      const label = firstInvalid.labels && firstInvalid.labels.length
        ? firstInvalid.labels[0].textContent.replace(TEXT.optional, "").trim()
        : firstInvalid.getAttribute("aria-label");
      const message = messageFor(firstInvalid);
      errorBox.textContent = firstInvalid.id === "consent" ? message : label + ": " + message;
      setFieldError(firstInvalid, message);
      form.classList.add("was-submitted");
      firstInvalid.focus();
      return;
    }
    errorBox.textContent = "";

    const data = collect();
    setBusy(true);
    showNotice("info", TEXT.sendingTitle, TEXT.sendingCopy);

    SalemList.subscribe(data).then(function (res) {
      setBusy(false);

      if (res.ok && (res.status === "created" || res.status === "resubscribed")) {
        // Hand the welcome details to the next page without using the URL.
        SalemList.remember("welcome", {
          firstName: data.firstName,
          status: res.status,
          audience: currentAudience()
        });
        window.location.href = "subscribed.html";
        return;
      }

      if (res.ok && res.status === "exists") {
        showNotice("info", TEXT.existsTitle, TEXT.existsCopy, { actions: true, focus: true });
        return;
      }

      if (res.error === "validation" && res.fields) {
        let firstInput = null;
        Object.keys(res.fields).forEach(function (name) {
          const input = document.getElementById(FIELD_IDS[name] || name);
          if (!input) return;
          setFieldError(input, TEXT.fields ? (TEXT.fields[name] || TEXT.fields.other) : res.fields[name]);
          if (!firstInput) firstInput = input;
        });
        showNotice("error", TEXT.checkTitle, TEXT.checkCopy);
        form.classList.add("was-submitted");
        if (firstInput) firstInput.focus();
        return;
      }

      showNotice("error", TEXT.failTitle, SalemList.errorMessage(res), { focus: true });
    });
  });

  /* ---------- "Email me my preferences link" ---------- */
  resendButton.addEventListener("click", function () {
    resendButton.disabled = true;
    resendButton.textContent = TEXT.sending;
    SalemList.resendLink(emailInput.value.trim()).then(function (res) {
      resendButton.disabled = false;
      resendButton.textContent = TEXT.resendButton;
      if (res.ok) {
        showNotice("info", TEXT.resentTitle, TEXT.resentCopy, { focus: true });
      } else {
        showNotice("error", TEXT.resendFailTitle, SalemList.errorMessage(res), { actions: true, focus: true });
      }
    });
  });

  applyAudience();
});
