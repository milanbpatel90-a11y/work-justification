const API_URL = "https://work-justification.vercel.app/api/sheet";
const IDLE_THRESHOLD_SECONDS = 300;
const TICK_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 60;
const APP_NAMES = ["Gmail", "Google Sheets", "Tool", "Zoho", "WhatsApp"];

const localDate = timestamp => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const classifyUrl = value => {
  let url;
  try { url = new URL(value); } catch { return ""; }
  const host = url.hostname.toLowerCase();
  if (host === "mail.google.com") return "Gmail";
  if (host === "docs.google.com" && url.pathname.startsWith("/spreadsheets/")) return "Google Sheets";
  if (host === "training-hub-rust.vercel.app" && (url.pathname === "/tl" || url.pathname.startsWith("/tl/"))) return "Tool";
  if (host === "web.whatsapp.com") return "WhatsApp";
  if (/^(?:[a-z0-9-]+\.)*zoho\.(?:com|in|eu|com\.au)$/.test(host)) return "Zoho";
  return "";
};

const getActiveContext = async () => {
  const [focusedWindow, tabs, idleState] = await Promise.all([
    chrome.windows.getLastFocused(),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    new Promise(resolve => chrome.idle.queryState(IDLE_THRESHOLD_SECONDS, resolve))
  ]);
  const tab = tabs[0];
  return {
    application: tab ? classifyUrl(tab.url || "") : "",
    windowFocused: Boolean(focusedWindow?.focused),
    idleState
  };
};

const getLocalState = async () => chrome.storage.local.get({
  enabled: true,
  totals: {},
  currentApplication: "",
  windowFocused: false,
  idleState: "idle",
  lastTickAt: Date.now(),
  lastSyncAt: 0,
  lastSyncAttemptAt: 0,
  lastSyncError: ""
});

const buildSyncRows = totals => {
  const dates = Object.keys(totals).sort().slice(-14);
  return dates.flatMap(date => APP_NAMES
    .filter(application => Number(totals[date]?.[application]) > 0)
    .map(application => ({ date, application, activeSeconds: Math.floor(totals[date][application]) })));
};

const syncTotals = async totals => {
  const entries = buildSyncRows(totals);
  if (!entries.length) return;
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "saveActivityTotals", args: [entries] })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `Sync failed (HTTP ${response.status}).`);
};

let workQueue = Promise.resolve();
const reconcile = () => {
  workQueue = workQueue.then(async () => {
    const now = Date.now();
    const state = await getLocalState();
    const elapsed = Math.min(MAX_INTERVAL_SECONDS, Math.max(0, Math.floor((now - state.lastTickAt) / 1000)));
    let totals = state.totals || {};
    const wasWorking = state.enabled && state.windowFocused && state.idleState === "active" && APP_NAMES.includes(state.currentApplication);
    if (wasWorking && elapsed > 0) {
      const date = localDate(state.lastTickAt);
      totals = { ...totals, [date]: { ...(totals[date] || {}) } };
      totals[date][state.currentApplication] = (Number(totals[date][state.currentApplication]) || 0) + elapsed;
    }

    const context = await getActiveContext();
    const patch = {
      totals,
      currentApplication: context.application,
      windowFocused: context.windowFocused,
      idleState: context.idleState,
      lastTickAt: now
    };
    await chrome.storage.local.set(patch);

    const shouldSync = Object.keys(totals).length > 0 && (now - Number(state.lastSyncAttemptAt || 0) >= 60_000);
    if (shouldSync) {
      await chrome.storage.local.set({ lastSyncAttemptAt: now });
      try {
        await syncTotals(totals);
        await chrome.storage.local.set({ lastSyncAt: now, lastSyncError: "" });
      } catch (error) {
        await chrome.storage.local.set({ lastSyncError: error.message || String(error) });
      }
    }
  }).catch(error => console.error("Activity timer update failed:", error));
  return workQueue;
};

const scheduleAlarm = () => chrome.alarms.create("activity-tick", { periodInMinutes: 0.5 });
chrome.runtime.onInstalled.addListener(() => { scheduleAlarm(); reconcile(); });
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); reconcile(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "activity-tick") reconcile(); });
chrome.tabs.onActivated.addListener(reconcile);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.url || changeInfo.status === "complete") reconcile(); });
chrome.windows.onFocusChanged.addListener(reconcile);
chrome.idle.onStateChanged.addListener(reconcile);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-status") {
    getLocalState().then(sendResponse);
    return true;
  }
  if (message?.type === "set-enabled") {
    reconcile().then(async () => {
      await chrome.storage.local.set({ enabled: Boolean(message.enabled), lastTickAt: Date.now() });
      await reconcile();
      sendResponse({ ok: true });
    }).catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "sync-now") {
    getLocalState().then(async state => {
      try {
        await syncTotals(state.totals || {});
        await chrome.storage.local.set({ lastSyncAt: Date.now(), lastSyncError: "" });
        sendResponse({ ok: true });
      } catch (error) {
        await chrome.storage.local.set({ lastSyncError: error.message || String(error) });
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    });
    return true;
  }
  return false;
});

scheduleAlarm();
reconcile();

