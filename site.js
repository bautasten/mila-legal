// The support form: posts to Mila's support function, which e-mails the message; one language per page (sv, en, de).
const T = {
  sv: { sending: "Skickar…", sent: "Tack! Meddelandet är skickat.", busy: "Du har skickat flera meddelanden nyss. Försök igen om en stund.", bad: "Kunde inte skicka. Kontrollera meddelandet (minst 10 tecken) och försök igen.", fail: "Kunde inte skicka. Försök igen." },
  en: { sending: "Sending…", sent: "Thank you! Your message has been sent.", busy: "You've sent several messages just now. Please try again later.", bad: "Couldn't send. Check your message (at least 10 characters) and try again.", fail: "Couldn't send. Please try again." },
  de: { sending: "Wird gesendet…", sent: "Danke! Deine Nachricht wurde gesendet.", busy: "Du hast gerade mehrere Nachrichten gesendet. Bitte versuch es später noch einmal.", bad: "Senden fehlgeschlagen. Prüfe deine Nachricht (mindestens 10 Zeichen) und versuch es noch einmal.", fail: "Senden fehlgeschlagen. Bitte versuch es noch einmal." },
};
for (const f of document.querySelectorAll("form.support")) f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const lang = T[document.documentElement.lang] ? document.documentElement.lang : "en", t = T[lang], m = f.querySelector(".msg"), b = f.querySelector("button");
  b.disabled = true; m.textContent = t.sending;
  const d = Object.fromEntries(new FormData(f)); d.lang = lang;
  try {
    const r = await fetch("https://vfjofaniwtudzvadxpsd.supabase.co/functions/v1/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
    if (r.ok) { f.reset(); m.textContent = t.sent; }
    else m.textContent = r.status === 429 ? t.busy : t.bad;
  } catch { m.textContent = t.fail; }
  b.disabled = false;
});
