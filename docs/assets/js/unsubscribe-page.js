/*
 * Unsubscribe page (unsubscribe.qmd and es/unsubscribe.qmd).
 * User-facing strings are in TEXT; the page's <html lang> picks en or es.
 */
document.addEventListener("DOMContentLoaded", function () {
  const TEXT = SalemList.pick({
    en: {
      button: "Unsubscribe me",
      working: "Unsubscribing…",
      wait: "Please wait.",
      firstMissing: "Enter your first name.",
      lastMissing: "Enter your last name.",
      byEmailDone: "If those details match someone on the Salem list, they’ve been removed and you won’t receive any further emails from us. Still getting emails? Use the “Unsubscribe” link at the bottom of any Salem email.",
      fields: null // the server's own (English) messages are used
    },
    es: {
      button: "Darme de baja",
      working: "Dando de baja…",
      wait: "Espere un momento.",
      firstMissing: "Escriba su nombre.",
      lastMissing: "Escriba su apellido.",
      byEmailDone: "Si esos datos coinciden con alguien en la lista de Salem, ya los eliminamos y no recibirá más correos de nuestra parte. ¿Sigue recibiendo correos? Use el enlace “Cancelar suscripción” al final de cualquier correo de Salem.",
      fields: { firstName: "Escriba su nombre.", lastName: "Escriba su apellido.", email: "Escriba un correo electrónico válido.", other: "Revise este campo." }
    }
  });
  const token = SalemList.takeToken(); // also removes ?token= from the address bar
  const button = document.getElementById("unsubscribe-button");
  const label = document.getElementById("unsubscribe-label");
  const status = document.getElementById("unsubscribe-status");
  let leaveFormBound = false; // declared before any bindLeaveForm() call

  function show(view, moveFocus) {
    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.hidden = el.dataset.view !== view;
    });
    if (moveFocus) document.querySelector('[data-view="' + view + '"] .list-status-heading').focus();
  }

  document.querySelectorAll("[data-resend-form]").forEach(SalemList.bindResendForm);
  document.getElementById("use-leave-form").addEventListener("click", function () {
    show("request", true);
    bindLeaveForm();
  });

  if (!token) {
    show("request");
    bindLeaveForm();
    return;
  }

  /* ---------- Unsubscribe with name + email (no link needed) ---------- */
  function bindLeaveForm() {
    if (leaveFormBound) return;
    leaveFormBound = true;
    const form = document.getElementById("leave-form");
    const leaveButton = document.getElementById("leave-button");
    const leaveLabel = document.getElementById("leave-label");
    const leaveStatus = document.getElementById("leave-status");
    const inputs = {
      firstName: document.getElementById("leave-first"),
      lastName: document.getElementById("leave-last"),
      email: document.getElementById("leave-email")
    };

    function setError(input, message) {
      const id = input.id + "-error";
      let msg = document.getElementById(id);
      if (message) {
        if (!msg) {
          msg = document.createElement("p");
          msg.id = id;
          msg.className = "field-error";
          input.closest(".form-field").insertAdjacentElement("afterend", msg);
        }
        msg.textContent = message;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", id);
      } else {
        if (msg) msg.remove();
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      }
    }

    form.addEventListener("input", function (event) {
      if (event.target.getAttribute("aria-invalid") && event.target.checkValidity()) setError(event.target, "");
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      let firstBad = null;
      Object.keys(inputs).forEach(function (key) {
        const input = inputs[key];
        input.value = input.value.trim();
        const message = input.checkValidity() ? "" :
          key === "email" ? SalemList.text("emailInvalid") :
          (key === "firstName" ? TEXT.firstMissing : TEXT.lastMissing);
        setError(input, message);
        if (message && !firstBad) firstBad = input;
      });
      if (firstBad) { firstBad.focus(); return; }

      leaveButton.disabled = true;
      leaveLabel.textContent = TEXT.working;
      leaveStatus.setAttribute("role", "status");
      leaveStatus.dataset.tone = "info";
      leaveStatus.textContent = TEXT.wait;

      SalemList.unsubscribeByEmail({
        firstName: inputs.firstName.value,
        lastName: inputs.lastName.value,
        email: inputs.email.value,
        website: document.getElementById("leave-website").value
      }).then(function (res) {
        leaveButton.disabled = false;
        leaveLabel.textContent = TEXT.button;
        leaveStatus.textContent = "";

        if (res.ok) {
          document.getElementById("done-lede").textContent =
            TEXT.byEmailDone;
          show("done", true);
        } else if (res.error === "validation" && res.fields) {
          let first = null;
          Object.keys(res.fields).forEach(function (key) {
            if (!inputs[key]) return;
            setError(inputs[key], TEXT.fields ? (TEXT.fields[key] || TEXT.fields.other) : res.fields[key]);
            if (!first) first = inputs[key];
          });
          if (first) first.focus();
        } else {
          leaveStatus.dataset.tone = "error";
          leaveStatus.setAttribute("role", "alert");
          leaveStatus.textContent = SalemList.errorMessage(res);
        }
      });
    });
  }

  button.addEventListener("click", function () {
    button.disabled = true;
    label.textContent = TEXT.working;
    status.setAttribute("role", "status");
    status.dataset.tone = "info";
    status.textContent = TEXT.wait;

    SalemList.unsubscribe(token).then(function (res) {
      button.disabled = false;
      label.textContent = TEXT.button;
      status.textContent = "";

      if (res.ok && res.status === "unsubscribed") {
        SalemList.remember("token", null); // the link is spent
        show("done", true);
      } else if (res.ok && res.status === "not_found") {
        SalemList.remember("token", null);
        show("missing", true);
      } else {
        status.dataset.tone = "error";
        status.setAttribute("role", "alert");
        status.textContent = SalemList.errorMessage(res);
      }
    });
  });
});
