/* Offscreen document: reads the clipboard for a content script.
 *
 * A page opened from make.powerapps.com inherits that site's permissions
 * policy, which does not let pages read the clipboard - navigator.clipboard
 * .readText() is refused there however the user answers. An extension page
 * with the clipboardRead permission may paste into a textarea of its own, so
 * background.js opens this document on demand and asks it. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'DB_OFFSCREEN_READ_CLIPBOARD') return;
  const ta = document.getElementById('clip');
  ta.value = '';
  ta.focus();
  const ok = document.execCommand('paste');
  reply({ ok: ok, text: ok ? ta.value : '' });
  ta.value = '';
});
