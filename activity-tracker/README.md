# Work Justification Activity Timer

This tracker counts foreground time only on the work sites selected for this task. It stores application name, local date, and elapsed seconds. It does not read page text, message contents, email subjects, screenshots, window titles, or full URLs.

Tracked browser pages:

- Gmail: `mail.google.com`
- Google Sheets: spreadsheets under `docs.google.com`
- Tool: `training-hub-rust.vercel.app/tl`
- Zoho: Zoho `.com`, `.in`, `.eu`, and `.com.au` sites
- WhatsApp Web: `web.whatsapp.com`

Time accrues only while Chrome is focused, a matching tab is active, and the computer reports user activity. Tracking pauses when the browser loses focus or the computer has been idle for five minutes. The extension stores totals locally and syncs the last 14 days to the Work Justification spreadsheet through the dashboard API. Repeated syncs replace the same date/application total, so they do not create duplicate rows.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `activity-tracker` folder.
4. Pin the extension and leave tracking enabled.

The extension requires access to the listed work-site domains and the dashboard API. Install it only in the Chrome profile you want to track. WhatsApp desktop usage is not visible to a browser extension; this covers WhatsApp Web.

## Sheet/API deployment

The source changes add an `Activity Log` tab to the same spreadsheet on first successful sync. The updated Apps Script backend must be deployed as a new web-app version, and the updated Vercel API must be deployed before automatic sync works.

