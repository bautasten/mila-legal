// Mila's pages with an action (a buddy or group invite, the support form) are never shown inside another site's frame (clickjacking).
// GitHub Pages sends no frame-ancestors header and a meta policy cannot carry one, so each such page starts hidden (the style with id
// "antiClickjack" in its head) and is shown here only when it is the top window; framed, it asks to become the top window instead.
if (window.self === window.top) {
  var hide = document.getElementById("antiClickjack");
  if (hide) hide.parentNode.removeChild(hide);
} else {
  try { window.top.location = window.self.location.href; } catch (e) { /* stays hidden */ }
}
