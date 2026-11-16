/* Preferences page (preferences.qmd and es/preferences.qmd). Strings in TEXT, picked by <html lang>. */
document.addEventListener("DOMContentLoaded", function () {
  const TEXT = SalemList.pick({
    en: {
      hi: function (name) { return "Hi, " + name + "."; }, heading: "Update your interests.",
      saving: "Saving…", savingStatus: "Saving your interests…", save: "Save my interests",
      saved: "Saved. We’ll keep you posted on what you picked.",
      savedNone: "Saved. You’re still on the list for general Salem news."
    },
    es: {
      hi: function (name) { return "Hola, " + name + "."; }, heading: "Actualice sus intereses.",
      saving: "Guardando…", savingStatus: "Guardando sus intereses…", save: "Guardar mis intereses",
      saved: "Listo. Le avisaremos sobre lo que eligió.",
      savedNone: "Listo. Sigue en la lista para las noticias generales de Salem."
    }
  });
  const token = SalemList.takeToken(); // also removes ?token= from the address bar
  const form = document.getElementById("prefs-form");
  const saveButton = document.getElementById("prefs-save");
  const saveLabel = document.getElementById("prefs-save-label");
  const status = document.getElementById("prefs-status");
  const boxes = form.querySelectorAll('input[name="interest"]');
  const langRadios = form.querySelectorAll('input[name="lang"]');

  function show(view, moveFocus) {
    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.hidden = el.dataset.view !== view;
    });
    if (moveFocus) document.querySelector('[data-view="' + view + '"] .list-status-heading').focus();
  }

  document.querySelectorAll("[data-resend-form]").forEach(SalemList.bindResendForm);

  function load() {
    show("loading");
    SalemList.getPreferences(token).then(function (res) {
      if (res.ok && res.status === "found") {
        const chosen = (res.interests || []).map(function (x) { return String(x).toLowerCase(); });
        boxes.forEach(function (box) { box.checked = chosen.indexOf(box.value.toLowerCase()) !== -1; });
        langRadios.forEach(function (radio) { radio.checked = radio.value === (res.lang === "es" ? "es" : "en"); });
        const name = (res.firstName || "").trim();
        document.getElementById("prefs-heading").textContent = name ? TEXT.hi(name) : TEXT.heading;
        show("edit", true);
      } else if (res.ok && res.status === "not_found") {
        SalemList.remember("token", null);
        show("missing", true);
      } else {
        document.getElementById("load-error-copy").textContent = SalemList.errorMessage(res);
        show("error", true);
      }
    });
  }

  document.getElementById("prefs-retry").addEventListener("click", load);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const interests = Array.from(boxes).filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    const chosenLang = form.querySelector('input[name="lang"]:checked');
    const lang = chosenLang ? chosenLang.value : "";

    saveButton.disabled = true;
    saveLabel.textContent = TEXT.saving;
    status.setAttribute("role", "status");
    status.dataset.tone = "info";
    status.textContent = TEXT.savingStatus;

    SalemList.updateInterests(token, interests, lang).then(function (res) {
      saveButton.disabled = false;
      saveLabel.textContent = TEXT.save;
      if (res.ok && res.status === "updated") {
        status.textContent = interests.length
          ? TEXT.saved
          : TEXT.savedNone;
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

  if (!token) show("missing");
  else load();
});
