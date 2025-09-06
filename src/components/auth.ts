import * as crypto from "crypto";
import * as http from "http";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_SCOPES = "https://www.googleapis.com/auth/spreadsheets.readonly";

export function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256b64url(input: string): Promise<string> {
  return b64url(crypto.createHash("sha256").update(input).digest());
}

export interface AuthSettings {
  authMethod: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

export class GoogleAuth {
  settings: AuthSettings;
  constructor(settings: AuthSettings) {
    this.settings = settings;
  }

  isSignedIn(): boolean {
    const a = this.settings;
    if (a.authMethod !== "oauth-desktop") return false;
    const hasFresh = !!(
      a.accessToken &&
      a.tokenExpiry &&
      Date.now() < a.tokenExpiry - 60_000
    );
    return !!a.refreshToken || hasFresh;
  }

  async signOutGoogle() {
    this.settings.accessToken = undefined;
    this.settings.refreshToken = undefined;
    this.settings.tokenExpiry = undefined;
  }

  private refreshInFlight?: Promise<string>;

  async ensureAccessToken(): Promise<string> {
    const a = this.settings;
    if (a.accessToken && a.tokenExpiry && Date.now() < a.tokenExpiry - 60_000) {
      return a.accessToken;
    }
    if (a.authMethod !== "oauth-desktop") {
      throw new Error(
        "No access token in public-csv mode. Switch to OAuth (Desktop) and sign in."
      );
    }
    if (!a.refreshToken) {
      throw new Error("Not authorized. Please use 'Sign in to Google' first.");
    }
    if (!a.clientId) {
      throw new Error("Missing OAuth Client ID.");
    }
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const body = new URLSearchParams({
        client_id: a.clientId!,
        client_secret: a.clientSecret || "",
        grant_type: "refresh_token",
        refresh_token: a.refreshToken ?? "",
      });
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const tok = await res.json();
      if (!res.ok) {
        this.refreshInFlight = undefined;
        throw new Error(
          tok.error_description || tok.error || `Refresh failed (${res.status})`
        );
      }
      a.accessToken = tok.access_token;
      a.tokenExpiry = Date.now() + Number(tok.expires_in) * 1000;
      this.refreshInFlight = undefined;
      return a.accessToken!;
    })();
    return this.refreshInFlight;
  }

  async startDesktopAuthPKCE(): Promise<void> {
    const a = this.settings;
    if (!a) throw new Error("Plugin settings not initialized.");
    if (a.authMethod !== "oauth-desktop") {
      throw new Error(
        "Set Authentication method to 'OAuth (Desktop, PKCE)' first."
      );
    }
    const clientId = a.clientId?.trim();
    const secret = a.clientSecret?.trim();
    if (!clientId) throw new Error("Missing Google OAuth Client ID (Desktop).");
    const codeVerifier = b64url(crypto.randomBytes(48));
    const codeChallenge = await sha256b64url(codeVerifier);
    const state = b64url(crypto.randomBytes(16));
    const server = http.createServer();
    const port: number = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string")
          reject(new Error("Failed to bind loopback server"));
        else resolve((addr as any).port);
      });
    });
    const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", OAUTH_SCOPES);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    window.open(authUrl.toString(), "_blank", "noopener");
    const authCode: string = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { server.close(); } catch {}
        reject(new Error("Auth timeout (no callback received)."));
      }, 3 * 60_000);
      server.on("request", (req, res) => {
        const url = new URL(req.url || "", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/oauth2/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const gotState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (!code || gotState !== state) {
          res.statusCode = 400;
          res.end("Invalid request");
          clearTimeout(timeout);
          try { server.close(); } catch {}
          return reject(new Error("Missing code or bad state."));
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end("<html><body style='font-family:sans-serif'>You can close this window and return to Obsidian.</body></html>");
        clearTimeout(timeout);
        try { server.close(); } catch {}
        resolve(code);
      });
    });
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: secret || "",
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const raw = await resp.text();
    let tok: any = {};
    try { tok = JSON.parse(raw); } catch {}
    if (!resp.ok) {
      const msg = (
        tok?.error_description ||
        tok?.error ||
        `Token exchange failed (${resp.status})`
      ).toString();
      if (/client_secret/i.test(msg) || /invalid_client/i.test(msg)) {
        throw new Error(
          "Looks like a Web OAuth client. Create a **Desktop app** client for PKCE (no client_secret)."
        );
      }
      if (/redirect_uri_mismatch/i.test(msg)) {
        throw new Error(
          "Redirect URI mismatch. Use the same loopback URI (http://127.0.0.1:<port>) for both steps."
        );
      }
      throw new Error(msg);
    }
    a.accessToken = tok.access_token;
    a.refreshToken = tok.refresh_token;
    a.tokenExpiry = Date.now() + Number(tok.expires_in) * 1000;
  }
}
