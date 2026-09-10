"use strict";

chrome.runtime.sendMessage("status", (res) => {
  const row = document.getElementById("status");
  const text = document.getElementById("text");
  const hint = document.getElementById("hint");

  if (!res || !res.helper) {
    row.className = "row bad";
    text.textContent = "Helper not running";
    hint.innerHTML = 'Run <code>Twitch Watch Sync Setup.exe</code> once, then reopen this.';
    return;
  }
  row.className = "row ok";
  text.textContent = `${res.tabs} channel${res.tabs === 1 ? "" : "s"} shared`;
  hint.textContent = res.clients
    ? `${res.clients} widget${res.clients === 1 ? "" : "s"} connected.`
    : "Helper is up, but no widget is listening yet.";
});
