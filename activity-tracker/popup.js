const names = ["Gmail", "Google Sheets", "Tool", "Zoho", "WhatsApp"];
const today = (() => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
})();
const formatTime = seconds => `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} sec`;

const render = async () => {
  const state = await chrome.runtime.sendMessage({ type: "get-status" });
  const values = state.totals?.[today] || {};
  document.getElementById("date-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  document.getElementById("enabled").checked = Boolean(state.enabled);
  const rows = document.getElementById("rows");
  rows.replaceChildren();
  let total = 0;
  names.forEach(name => {
    const seconds = Math.floor(Number(values[name]) || 0);
    total += seconds;
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = name;
    const value = document.createElement("span");
    value.textContent = formatTime(seconds);
    row.append(label, value);
    rows.append(row);
  });
  document.getElementById("total").textContent = formatTime(total);
  const message = document.getElementById("message");
  message.classList.toggle("error", Boolean(state.lastSyncError));
  message.textContent = state.lastSyncError || "Time syncs to the Activity Log tab automatically.";
};

document.getElementById("enabled").addEventListener("change", async event => {
  await chrome.runtime.sendMessage({ type: "set-enabled", enabled: event.target.checked });
  await render();
});
document.getElementById("sync").addEventListener("click", async () => {
  const message = document.getElementById("message");
  message.classList.remove("error");
  message.textContent = "Syncing daily totals…";
  const result = await chrome.runtime.sendMessage({ type: "sync-now" });
  message.textContent = result.ok ? "Daily totals synced to the Activity Log tab." : result.error;
  message.classList.toggle("error", !result.ok);
});
render();

