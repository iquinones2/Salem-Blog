/* "You're on the list" page (subscribed.qmd and es/subscribed.qmd). Strings in TEXT, picked by <html lang>. */
document.addEventListener("DOMContentLoaded", function () {
  // Details handed over by the subscribe form (sessionStorage, never the URL).
  const welcome = SalemList.recall("welcome");
  if (!welcome) return; // generic confirmation

  const TEXT = SalemList.pick({
    en: {
      back: "Welcome back", again: "Good to see you again", welcome: "Welcome to Salem",
      backLede: TEXT.backLede,
      backCopy: TEXT.backCopy,
      returningCopy: TEXT.returningCopy
    },
    es: {
      back: "Qué gusto tenerle de vuelta", again: "Qué gusto verle de nuevo", welcome: "Le damos la bienvenida a Salem",
      backLede: "Su suscripción a Salem Custom Screen Printing está activa de nuevo.",
      backCopy: "Nos alegra que haya vuelto. Pronto le llegará un correo de bienvenida con enlaces nuevos para administrar sus correos.",
      returningCopy: "Le avisaremos cuando abramos pedidos personalizados, para que su próxima tanda de camisetas sea fácil. Pronto le llegará un correo de bienvenida."
    }
  });
  const name = (welcome.firstName || "").trim();
  const withName = function (text) { return name ? text + ", " + name + "." : text + "."; };
  const heading = document.getElementById("welcome-heading");
  const lede = document.getElementById("welcome-lede");
  const copy = document.getElementById("welcome-copy");

  if (welcome.status === "resubscribed") {
    heading.textContent = withName(TEXT.back);
    lede.textContent = TEXT.backLede;
    copy.textContent = TEXT.backCopy;
  } else if (welcome.audience === "returning") {
    heading.textContent = withName(TEXT.again);
    copy.textContent = TEXT.returningCopy;
  } else {
    heading.textContent = withName(TEXT.welcome);
  }
});
