// The support form: posts to Mila's support function, which e-mails the message; one language per page (sv, en, de, nb, da, fi, fr, es).
const T = {
  sv: { sending: "Skickar…", sent: "Tack! Meddelandet är skickat.", busy: "Du har skickat flera meddelanden nyss. Försök igen om en stund.", full: "Formuläret tar emot väldigt många meddelanden just nu. Försök igen senare, eller mejla support@milacoach.app.", bad: "Kunde inte skicka. Kontrollera meddelandet (minst 10 tecken) och försök igen.", fail: "Kunde inte skicka. Försök igen." },
  en: { sending: "Sending…", sent: "Thank you! Your message has been sent.", busy: "You've sent several messages just now. Please try again later.", full: "The form is receiving a great many messages right now. Please try again later, or e-mail support@milacoach.app.", bad: "Couldn't send. Check your message (at least 10 characters) and try again.", fail: "Couldn't send. Please try again." },
  de: { sending: "Wird gesendet…", sent: "Danke! Deine Nachricht wurde gesendet.", busy: "Du hast gerade mehrere Nachrichten gesendet. Bitte versuch es später noch einmal.", full: "Das Formular erhält gerade sehr viele Nachrichten. Bitte versuch es später noch einmal oder schreib an support@milacoach.app.", bad: "Senden fehlgeschlagen. Prüfe deine Nachricht (mindestens 10 Zeichen) und versuch es noch einmal.", fail: "Senden fehlgeschlagen. Bitte versuch es noch einmal." },
  nb: { sending: "Sender…", sent: "Takk! Meldingen er sendt.", busy: "Du har sendt flere meldinger akkurat nå. Prøv igjen om litt.", full: "Skjemaet tar imot veldig mange meldinger akkurat nå. Prøv igjen senere, eller send e-post til support@milacoach.app.", bad: "Kunne ikke sende. Sjekk meldingen (minst 10 tegn) og prøv igjen.", fail: "Kunne ikke sende. Prøv igjen." },
  da: { sending: "Sender…", sent: "Tak! Beskeden er sendt.", busy: "Du har sendt flere beskeder lige nu. Prøv igen om lidt.", full: "Formularen modtager rigtig mange beskeder lige nu. Prøv igen senere, eller skriv til support@milacoach.app.", bad: "Kunne ikke sende. Tjek din besked (mindst 10 tegn), og prøv igen.", fail: "Kunne ikke sende. Prøv igen." },
  fi: { sending: "Lähetetään…", sent: "Kiitos! Viestisi on lähetetty.", busy: "Lähetit juuri useita viestejä. Yritä hetken päästä uudelleen.", full: "Lomakkeelle tulee juuri nyt hyvin paljon viestejä. Yritä myöhemmin uudelleen tai lähetä sähköpostia osoitteeseen support@milacoach.app.", bad: "Lähetys epäonnistui. Tarkista viestisi (vähintään 10 merkkiä) ja yritä uudelleen.", fail: "Lähetys epäonnistui. Yritä uudelleen." },
  fr: { sending: "Envoi…", sent: "Merci ! Ton message a été envoyé.", busy: "Tu viens d’envoyer plusieurs messages. Réessaie un peu plus tard.", full: "Le formulaire reçoit énormément de messages en ce moment. Réessaie plus tard ou écris à support@milacoach.app.", bad: "Envoi impossible. Vérifie ton message (au moins 10 caractères) et réessaie.", fail: "Envoi impossible. Réessaie." },
  es: { sending: "Enviando…", sent: "¡Gracias! Tu mensaje se ha enviado.", busy: "Acabas de enviar varios mensajes. Inténtalo de nuevo dentro de un rato.", full: "El formulario está recibiendo muchísimos mensajes ahora mismo. Inténtalo más tarde o escribe a support@milacoach.app.", bad: "No se ha podido enviar. Revisa tu mensaje (al menos 10 caracteres) e inténtalo de nuevo.", fail: "No se ha podido enviar. Inténtalo de nuevo." },
};
// "Rapportera" on a shared page, a race page or in the app opens the form with ?topic=report&ref=<what it is about>: the topic is chosen
// and the page goes with the message (a hidden field), so the report says what it concerns. A race page's "Arrangör eller
// rättighetsinnehavare?" opens it with ?topic=rights the same way. Only a topic the page's own list holds is chosen (the whitelist).
const q = new URLSearchParams(location.search);
for (const f of document.querySelectorAll("form.support")) {
  const sel = f.querySelector("select[name=topic]"), ref = f.querySelector("input[name=ref]");
  if (sel && [...sel.options].some((o) => o.value === q.get("topic"))) sel.value = q.get("topic");
  if (ref && q.get("ref")) ref.value = q.get("ref").slice(0, 300);
  if (q.get("topic")) document.getElementById("kontakt")?.scrollIntoView();
}
for (const f of document.querySelectorAll("form.support")) f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const lang = T[document.documentElement.lang] ? document.documentElement.lang : "en", t = T[lang], m = f.querySelector(".msg"), b = f.querySelector("button");
  b.disabled = true; m.textContent = t.sending;
  const d = Object.fromEntries(new FormData(f)); d.lang = lang;
  try {
    const r = await fetch("https://vfjofaniwtudzvadxpsd.supabase.co/functions/v1/support?forceFunctionRegion=eu-west-1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
    if (r.ok) { f.reset(); m.textContent = t.sent; }
    // 429: the sender's own limit ("limit"), or a day so full that only new senders get through ("busy")
    else if (r.status === 429) m.textContent = (await r.json().catch(() => ({}))).error === "busy" ? t.full : t.busy;
    else m.textContent = t.bad;
  } catch { m.textContent = t.fail; }
  b.disabled = false;
});
