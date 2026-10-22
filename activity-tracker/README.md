# Work Justification Activity Timer

This tracker counts foreground time only on the work sites selected for this task. It stores application name, local date, and elapsed seconds. It does not read page text, message contents, email subjects, screenshots, window titles, or full URLs.

Tracked browser pages:

- Gmail: `mail.google.com`
- Google Sheets: spreadsheets under `docs.google.com`
- Tool: `training-hub-rust.vercel.app/tl`
- Zoho: Zoho `.com`, `.in`, `.eu`, and `.com.au` sites
- WhatsApp Web: `web.whatsapp.com`
- WhatsApp Desktop: start `Start-WhatsAppDesktopTimer.cmd` in Windows while working.
- WhatsApp Desktop: run `Track-WhatsAppDesktop.ps1` in Windows PowerShell while working. It identifies the foreground packaged-app process and records the separate `WhatsApp Desktop` category.

Time accrues only while Chrome is focused, a matching tab is active, and the computer reports user activity. Tracking pauses when the browser loses focus or the computer has been idle for five minutes. The extension stores totals locally and syncs the last 14 days to the Work Justification spreadsheet through the dashboard API. Repeated syncs replace the same date/application total, so they do not create duplicate rows.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `activity-tracker` folder.
4. Pin the extension and leave tracking enabled.

The Chrome extension requires access to the listed work-site domains and dashboard API. Install it only in the Chrome profile you want to track. For WhatsApp Desktop, double-click `Start-WhatsAppDesktopTimer.cmd`; leave its PowerShell window running during work and press Ctrl+C when finished. It counts only while WhatsApp Desktop is the foreground app and Windows input has been active in the last five minutes. The helper reads process/package identity only, never the window title or chat content. It saves a local daily total and syncs a separate `WhatsApp Desktop` category to the same Activity Log. The script uses the dashboard API and needs an internet connection to sync; it retains the daily total locally and retries later if the connection is unavailable.

## Sheet/API deployment

The source changes add an `Activity Log` tab to the same spreadsheet on first successful sync. The updated Apps Script backend must be deployed as a new web-app version, and the updated Vercel API must be deployed before automatic sync works.

