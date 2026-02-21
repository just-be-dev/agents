import { createServer, type Server } from "node:http";
import { buildManifest, getManifestFormUrl, type ManifestOptions } from "./manifest.ts";

export interface ServerResult {
  /** Temporary code from GitHub to exchange for credentials */
  code: string;
}

/**
 * Starts a temporary local HTTP server that:
 * 1. Serves a page with a form that POSTs the manifest to GitHub
 * 2. Waits for GitHub to redirect back with a temporary code
 * 3. Resolves with the code and shuts down
 */
export function startCallbackServer(options: {
  webhookUrl: string;
  org?: string;
}): Promise<{ url: string; result: Promise<ServerResult>; server: Server }> {
  return new Promise((resolveStart) => {
    let resolveResult: (value: ServerResult) => void;
    const resultPromise = new Promise<ServerResult>((resolve) => {
      resolveResult = resolve;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (url.pathname === "/") {
        // Serve the manifest form page
        const redirectUrl = `http://${req.headers.host}/callback`;
        const manifest = buildManifest({
          webhookUrl: options.webhookUrl,
          redirectUrl,
          org: options.org,
        });
        const formUrl = getManifestFormUrl(options.org);
        const state = crypto.randomUUID();

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(renderFormPage(formUrl, manifest, state));
        return;
      }

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Error: No code received from GitHub</h1></body></html>");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(renderSuccessPage());

        // Resolve and shut down
        resolveResult!({ code });
        server.close();
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("Failed to get server address");
      }
      const url = `http://127.0.0.1:${addr.port}`;
      resolveStart({ url, result: resultPromise, server });
    });
  });
}

function renderFormPage(
  formUrl: string,
  manifest: ReturnType<typeof buildManifest>,
  state: string
): string {
  const manifestJson = JSON.stringify(manifest);
  return `<!DOCTYPE html>
<html>
<head>
  <title>Create GitHub App</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
    h1 { font-size: 1.5em; }
    p { color: #666; line-height: 1.6; }
    .btn { background: #238636; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer; }
    .btn:hover { background: #2ea043; }
    .manifest { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; max-height: 300px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Register GitHub App</h1>
  <p>Click the button below to create your GitHub App. You'll be taken to GitHub to confirm the app name and create it.</p>
  <details>
    <summary>Manifest details</summary>
    <pre class="manifest">${escapeHtml(JSON.stringify(manifest, null, 2))}</pre>
  </details>
  <br>
  <form action="${escapeHtml(formUrl)}?state=${state}" method="post">
    <input type="hidden" name="manifest" value='${escapeHtml(manifestJson)}'>
    <button type="submit" class="btn">Create GitHub App on GitHub</button>
  </form>
  <script>document.querySelector('form').submit();</script>
</body>
</html>`;
}

function renderSuccessPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>GitHub App Created</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; text-align: center; }
    .check { font-size: 64px; }
    h1 { color: #238636; }
  </style>
</head>
<body>
  <div class="check">&#10003;</div>
  <h1>GitHub App Created!</h1>
  <p>You can close this tab and return to your terminal.</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
