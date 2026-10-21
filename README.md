# Call Log Dashboard

The Vercel frontend lives in `frontend/`. It sends requests to a Vercel serverless function, which forwards them to the Google Apps Script backend in `backend/Code.gs`. The Apps Script writes call records to a Google Sheet; screenshots are processed in the browser and are not uploaded.

## 1. Set up the Google Sheet backend

1. Create or open the Google Sheet that will store the call log.
2. Open **Extensions → Apps Script**, replace the editor contents with `backend/Code.gs`, and save.
3. In **Project Settings → Script properties**, add `WORK_LOG_API_KEY`. Use a long, randomly generated secret (at least 32 characters). Do not put it in frontend files or commit it.
4. Select and run `setupWorkLogSheet` once from the Apps Script editor. Review and grant the requested Sheets permissions.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to your account, and **Who has access** to **Anyone**. Deploy and copy the web app URL ending in `/exec`.

The endpoint is publicly reachable so Vercel can call it. Requests sent directly to Apps Script without the secret configured in step 3 are rejected. The Vercel API route itself is publicly reachable; the origin check is not user authentication. If the call logs are sensitive, protect the Vercel deployment with an authentication layer or Vercel Deployment Protection before sharing the URL.

## 2. Deploy the frontend to Vercel

1. Import this repository into Vercel.
2. Set the Vercel **Root Directory** to `frontend`.
3. Add these project environment variables:
   - `GOOGLE_APPS_SCRIPT_URL`: the deployed Apps Script `/exec` URL.
   - `GOOGLE_SHEETS_API_KEY`: exactly the secret stored as `WORK_LOG_API_KEY` in Apps Script.
   - `FRONTEND_ORIGIN`: the exact production origin, for example `https://your-project.vercel.app` (no trailing slash). Add a separate Vercel Preview environment value if previews need to access the sheet.
4. Redeploy after setting the environment variables.

The frontend is static HTML and requires no build command. Vercel serves `index.html` and deploys `api/sheet.js` as `/api/sheet`.

## Local preview

You can preview the static page locally, but its Sheets actions require the Vercel API route and environment variables. For full local integration testing, use the Vercel CLI with the same environment variables.
