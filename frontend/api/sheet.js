const ALLOWED_METHODS = new Set(["getWorkLogs", "saveCallLogs", "getActivityTotals", "saveActivityTotals"]);
const ACTIVITY_EXTENSION_ORIGIN = "chrome-extension://onikhhamabfliiacphlpdeippigikmmj";

export default async function handler(request, response) {
  const origin = request.headers.origin;
  const allowedOrigin = origin === process.env.FRONTEND_ORIGIN || origin === ACTIVITY_EXTENSION_ORIGIN;
  if (request.method === "OPTIONS") {
    if (!allowedOrigin) return response.status(403).end();
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
    response.setHeader("Vary", "Origin");
    return response.status(204).end();
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const frontendOrigin = process.env.FRONTEND_ORIGIN;
  if (!frontendOrigin || (origin !== frontendOrigin && origin !== ACTIVITY_EXTENSION_ORIGIN)) {
    return response.status(403).json({ ok: false, error: "Request origin is not allowed." });
  }
  if (origin === ACTIVITY_EXTENSION_ORIGIN) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!scriptUrl || !apiKey) {
    return response.status(500).json({ ok: false, error: "Google Sheets integration is not configured." });
  }

  let endpoint;
  try {
    endpoint = new URL(scriptUrl);
  } catch {
    return response.status(500).json({ ok: false, error: "Google Apps Script URL is invalid." });
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "script.google.com" ||
    !/^\/(?:a\/)?macros\/(?:[^/]+\/)?s\/[^/]+\/exec$/.test(endpoint.pathname)
  ) {
    return response.status(500).json({ ok: false, error: "Use the deployed Google Apps Script /exec URL." });
  }

  const { method, args = [] } = request.body || {};
  if (!ALLOWED_METHODS.has(method) || !Array.isArray(args)) {
    return response.status(400).json({ ok: false, error: "Invalid Sheets API request." });
  }
  if ((method === "getWorkLogs" && args.length !== 0) ||
      (method === "saveCallLogs" && (args.length !== 1 || !Array.isArray(args[0]))) ||
      (method === "getActivityTotals" && args.length !== 0) ||
      (method === "saveActivityTotals" && (args.length !== 1 || !Array.isArray(args[0])))) {
    return response.status(400).json({ ok: false, error: "Invalid arguments for Sheets API request." });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: method, args, apiKey }),
      signal: AbortSignal.timeout(15000)
    });
    if (upstream.redirected && /\/ServiceLogin\/?$/.test(new URL(upstream.url).pathname)) {
      return response.status(502).json({
        ok: false,
        error: "Google Apps Script requires sign-in. Redeploy it as a web app with access set to Anyone."
      });
    }
    const result = await upstream.json();
    if (!upstream.ok || !result.ok) {
      return response.status(502).json({
        ok: false,
        error: result.error || "Google Apps Script could not complete the request."
      });
    }
    return response.status(200).json({ ok: true, data: result.data });
  } catch (error) {
    console.error("Google Sheets request failed:", error);
    return response.status(502).json({
      ok: false,
      error: "Could not reach Google Apps Script. Check its deployment and try again."
    });
  }
}

