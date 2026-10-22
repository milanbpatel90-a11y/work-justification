const WORK_LOG_HEADERS = [
  "Date",
  "Week (ISO)",
  "Month",
  "Time",
  "Phone number",
  "Name",
  "Duration (minutes)",
  "Start time (call start)",
  "End time (call end)"
];
const LEGACY_WORK_LOG_HEADERS = ["Date", "Calls (contact number)", "Call minutes", "Person name"];
const SPREADSHEET_ID_PROPERTY = "WORK_LOG_SPREADSHEET_ID";
const API_KEY_PROPERTY = "WORK_LOG_API_KEY";
const ACTIVITY_LOG_HEADERS = ["Date", "Application", "Active time (minutes)", "Active time (seconds)", "Last updated"];
const ACTIVITY_CATEGORIES = ["Gmail", "Google Sheets", "Tool", "Zoho", "WhatsApp", "WhatsApp Desktop"];

function setupWorkLogSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Open this script from the target Google Sheet, then run setupWorkLogSheet again.");
  }

  let sheet = spreadsheet.getSheetByName("Work Log");
  let archived = false;
  if (sheet && sheet.getLastRow() > 0) {
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
    if (LEGACY_WORK_LOG_HEADERS.every((header, index) => currentHeaders[index] === header)) {
      const legacyRows = sheet.getLastRow() > 1
        ? sheet.getRange(2, 1, sheet.getLastRow() - 1, LEGACY_WORK_LOG_HEADERS.length).getValues()
        : [];
      const migratedRows = legacyRows.map(row => {
        const date = formatDate_(row[0], spreadsheet.getSpreadsheetTimeZone());
        return [date, isoWeekKey_(date), monthKey_(date), "", row[1], row[3], row[2], "", ""];
      });
      sheet.clear();
      sheet.getRange(1, 1, 1, WORK_LOG_HEADERS.length).setValues([WORK_LOG_HEADERS]);
      if (migratedRows.length) {
        sheet.getRange(2, 1, migratedRows.length, WORK_LOG_HEADERS.length).setValues(migratedRows);
      }
    } else if (WORK_LOG_HEADERS.some((header, index) => currentHeaders[index] !== header)) {
      sheet.setName(`Work Log Archive ${Date.now()}`);
      sheet = null;
      archived = true;
    }
  }
  if (!sheet) sheet = spreadsheet.insertSheet("Work Log");

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, WORK_LOG_HEADERS.length).setValues([WORK_LOG_HEADERS]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, WORK_LOG_HEADERS.length).setFontWeight("bold");
  [120, 100, 130, 100, 160, 190, 140, 160, 160].forEach((width, index) => sheet.setColumnWidth(index + 1, width));

  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROPERTY, spreadsheet.getId());
  const archiveMessage = archived ? " The previous Work Log tab was preserved as an archive." : "";
  return `Ready: call logs will be saved in "${spreadsheet.getName()}" → Work Log.${archiveMessage}`;
}

function doGet() {
  return jsonResponse_({ ok: true, message: "Work Log API is running." });
}

function doPost(event) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
    if (!apiKey) throw new Error("Configure WORK_LOG_API_KEY in the Apps Script project settings.");

    const request = JSON.parse(event && event.postData ? event.postData.contents : "{}");
    if (!request.apiKey || request.apiKey !== apiKey) {
      throw new Error("Unauthorized request.");
    }

    let data;
    if (request.action === "getWorkLogs") {
      data = getWorkLogs();
    } else if (request.action === "saveCallLogs") {
      const args = Array.isArray(request.args) ? request.args : [];
      data = saveCallLogs(args[0]);
    } else if (request.action === "getActivityTotals") {
      data = getActivityTotals();
    } else if (request.action === "saveActivityTotals") {
      const args = Array.isArray(request.args) ? request.args : [];
      data = saveActivityTotals(args[0]);
    } else {
      throw new Error("Unsupported API action.");
    }
    return jsonResponse_({ ok: true, data });
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message || String(error) });
  }
}

function getActivityTotals() {
  const sheet = getActivityLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, ACTIVITY_LOG_HEADERS.length).getDisplayValues()
    .map((row, index) => ({
      rowIndex: index + 2,
      date: String(row[0] || ""),
      application: String(row[1] || ""),
      activeMinutes: Number(row[2]) || 0,
      activeSeconds: Number(row[3]) || 0,
      lastUpdated: String(row[4] || "")
    }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && ACTIVITY_CATEGORIES.includes(row.application))
    .sort((a, b) => b.date.localeCompare(a.date) || a.application.localeCompare(b.application));
}

function saveActivityTotals(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) {
    throw new Error("Provide between 1 and 100 daily activity totals.");
  }
  const rows = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Activity total ${index + 1} is invalid.`);
    const date = validateDate_(entry.date);
    const application = String(entry.application || "");
    if (!ACTIVITY_CATEGORIES.includes(application)) throw new Error(`Activity total ${index + 1} has an unsupported application.`);
    const activeSeconds = Number(entry.activeSeconds);
    if (!Number.isSafeInteger(activeSeconds) || activeSeconds < 0 || activeSeconds > 86400) {
      throw new Error(`Activity total ${index + 1} must contain 0 to 86,400 whole active seconds.`);
    }
    return { date, application, activeSeconds };
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getActivityLogSheet_();
    const lastRow = sheet.getLastRow();
    const existing = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();
    const rowByKey = new Map(existing.map((row, index) => [`${row[0]}|${row[1]}`, index + 2]));
    const now = new Date().toISOString();
    rows.forEach(entry => {
      const rowIndex = rowByKey.get(`${entry.date}|${entry.application}`) || sheet.getLastRow() + 1;
      rowByKey.set(`${entry.date}|${entry.application}`, rowIndex);
      sheet.getRange(rowIndex, 1, 1, 2).setNumberFormat("@");
      sheet.getRange(rowIndex, 1, 1, ACTIVITY_LOG_HEADERS.length).setValues([[
        entry.date,
        entry.application,
        Math.round(entry.activeSeconds / 60 * 100) / 100,
        entry.activeSeconds,
        now
      ]]);
    });
  } finally {
    lock.releaseLock();
  }
  return getActivityTotals();
}

function getActivityLogSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY);
  if (!spreadsheetId) throw new Error("Work-log sheet is not configured. Run setupWorkLogSheet first.");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName("Activity Log");
  if (!sheet) {
    sheet = spreadsheet.insertSheet("Activity Log");
    sheet.getRange(1, 1, 1, ACTIVITY_LOG_HEADERS.length).setValues([ACTIVITY_LOG_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, ACTIVITY_LOG_HEADERS.length).setFontWeight("bold");
    [120, 150, 170, 170, 220].forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  }
  const headers = sheet.getRange(1, 1, 1, ACTIVITY_LOG_HEADERS.length).getDisplayValues()[0];
  if (ACTIVITY_LOG_HEADERS.some((header, index) => headers[index] !== header)) {
    throw new Error('The "Activity Log" tab has an unexpected layout. Rename or repair its header row before syncing.');
  }
  return sheet;
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function getWorkLogs() {
  const sheet = getWorkLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, WORK_LOG_HEADERS.length).getDisplayValues()
    .map((row, index) => ({
      rowIndex: index + 2,
      date: formatDate_(row[0]),
      week: String(row[1] || ""),
      month: String(row[2] || ""),
      callTime: String(row[3] || ""),
      contact: String(row[4] || ""),
      personName: String(row[5] || ""),
      callMinutes: Number(row[6]) || 0,
      startTime: String(row[7] || ""),
      endTime: String(row[8] || "")
    }))
    .filter(record => record.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function saveCallLogs(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 1000) {
    throw new Error("Provide between 1 and 1,000 call entries to save.");
  }
  const rows = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Call ${index + 1} is invalid.`);
    const date = validateDate_(entry.date);
    const callTime = validateTime_(entry.callTime, `Call ${index + 1} time`);
    const contact = String(entry.contact || "").trim().slice(0, 80);
    const personName = String(entry.personName || "").trim().slice(0, 200);
    if (!contact && !personName) throw new Error(`Call ${index + 1} needs a contact number or person name.`);
    const callMinutes = validateMinutes_(entry.callMinutes, `Call ${index + 1} minutes`);
    const startTime = validateTime_(entry.startTime, `Call ${index + 1} start time`);
    const endTime = validateTime_(entry.endTime, `Call ${index + 1} end time`);
    const rowIndex = entry.rowIndex === undefined || entry.rowIndex === null || entry.rowIndex === ""
      ? null
      : Number(entry.rowIndex);
    if (rowIndex !== null && (!Number.isSafeInteger(rowIndex) || rowIndex < 2)) {
      throw new Error(`Call ${index + 1} has an invalid saved-row reference.`);
    }
    return { date, callTime, contact, callMinutes, personName, startTime, endTime, rowIndex };
  });
  const sheet = getWorkLogSheet_();
  let nextRow = sheet.getLastRow() + 1;
  const saved = rows.map(row => {
    const rowIndex = row.rowIndex === null ? nextRow++ : row.rowIndex;
    if (rowIndex > sheet.getLastRow() && row.rowIndex !== null) {
      throw new Error("A saved call row no longer exists. Refresh the dashboard before updating it.");
    }
    return { ...row, rowIndex };
  });
  saved.forEach(row => {
    sheet.getRange(row.rowIndex, 1, 1, WORK_LOG_HEADERS.length).setNumberFormat("@");
    sheet.getRange(row.rowIndex, 1, 1, WORK_LOG_HEADERS.length).setValues([[
      row.date, isoWeekKey_(row.date), monthKey_(row.date), row.callTime, row.contact,
      row.personName, row.callMinutes, row.startTime, row.endTime
    ]]);
  });
  return saved.map(({ date, callTime, contact, callMinutes, personName, startTime, endTime, rowIndex }) => ({
    date, callTime, contact, callMinutes, personName, startTime, endTime, rowIndex
  }));
}

function getWorkLogSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY);
  if (!spreadsheetId) throw new Error("Work-log sheet is not configured. Run setupWorkLogSheet first.");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName("Work Log");
  if (!sheet) throw new Error('The "Work Log" tab is missing. Run setupWorkLogSheet again.');
  const headers = sheet.getRange(1, 1, 1, WORK_LOG_HEADERS.length).getDisplayValues()[0];
  if (WORK_LOG_HEADERS.some((header, index) => headers[index] !== header)) {
    throw new Error('The "Work Log" tab has an older layout. Run setupWorkLogSheet from the Apps Script editor to update the columns.');
  }
  return sheet;
}

function validateDate_(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter a valid work date.");
  const parsed = Utilities.parseDate(date, "UTC", "yyyy-MM-dd");
  if (Utilities.formatDate(parsed, "UTC", "yyyy-MM-dd") !== date) throw new Error("Enter a valid work date.");
  return date;
}

function validateMinutes_(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000) {
    throw new Error(`${label} must be a number zero or greater.`);
  }
  return Math.round(number * 100) / 100;
}

function validateTime_(value, label) {
  const time = String(value || "").trim();
  if (!time) return "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new Error(`${label} must use 24-hour time, for example 14:35 or 14:35:20.`);
  }
  return time;
}

function isoWeekKey_(dateValue) {
  const date = new Date(`${validateDate_(dateValue)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey_(dateValue) {
  return validateDate_(dateValue).slice(0, 7);
}

function formatDate_(value, timezone) {
  if (value instanceof Date) {
    const zone = timezone || getWorkLogSheet_().getParent().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, zone, "yyyy-MM-dd");
  }
  return String(value || "").trim();
}

