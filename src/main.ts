import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
  Plugin,
  ButtonComponent,
} from "obsidian";
// @ts-ignore - bundled by esbuild
import Papa from "papaparse";
import { DEFAULT_SETTINGS, PluginSettings, AuthMethod } from "./settings";
import * as http from "http";
import * as crypto from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_SCOPES = "https://www.googleapis.com/auth/spreadsheets.readonly";

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256b64url(input: string) {
  return b64url(crypto.createHash("sha256").update(input).digest());
}


class GSheetSettingTab extends PluginSettingTab {
  plugin: GoogleSheetTablePlugin;
  constructor(app: App, plugin: GoogleSheetTablePlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Google Sheet → Table" });

    // Auth method
    new Setting(containerEl)
      .setName("Authentication method")
      .setDesc("How the plugin accesses Google Sheets.")
      .addDropdown(d => d
        .addOption("public-csv", "Public CSV")
        .addOption("oauth-desktop", "OAuth (Desktop, PKCE / loopback)")
        .setValue(this.plugin.settings.auth.authMethod)
        .onChange(async (v) => {
          this.plugin.settings.auth.authMethod = v as any;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    const isOAuth = this.plugin.settings.auth.authMethod === "oauth-desktop";

    // Client ID
    const cidRow = new Setting(containerEl)
      .setName("Google OAuth Client ID")
      .setDesc("Required for OAuth Desktop; use your Desktop or Web client ID.")
      .addText(t => t
        .setPlaceholder("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com")
        .setValue(this.plugin.settings.auth.clientId || "")
        .onChange(async v => { this.plugin.settings.auth.clientId = v.trim(); await this.plugin.saveSettings(); })
      );
    cidRow.settingEl.classList.toggle("mod-muted", !isOAuth);

    // Client Secret
    const csRow = new Setting(containerEl)
      .setName("Client secret")
      .setDesc("Only if your OAuth client requires it. Stored locally.")
      .addText(t => {
        t.inputEl.setAttribute("type", "password");
        t.setPlaceholder("••••••••••");
        t.setValue(this.plugin.settings.auth.clientSecret || "");
        t.onChange(async v => { this.plugin.settings.auth.clientSecret = v; await this.plugin.saveSettings(); });
      });
    csRow.settingEl.classList.toggle("mod-muted", !isOAuth);

    // Status + Sign in/out toggle
    const signed = this.plugin.isSignedIn();
    const row = new Setting(containerEl)
      .setName("Google account")
      .setDesc(signed ? "Signed in" : "Signed out");

    row.addButton((btn: ButtonComponent) => {
      btn
        .setButtonText(signed ? "Sign out" : "Sign in")
        .setCta()
        .onClick(async () => {
          btn.setDisabled(true);
          try {
            if (this.plugin.isSignedIn()) {
              await this.plugin.signOutGoogle();
              new Notice("Signed out.");
            } else {
              if (!isOAuth) return new Notice("Switch Auth method to OAuth (Desktop) first.");
              if (!this.plugin.settings.auth.clientId) return new Notice("Please set the Google OAuth Client ID.");

              await this.plugin.startDesktopAuthPKCE(); // will use clientSecret if set
              new Notice("Signed in.");
            }
          } catch (e:any) {
            console.error(e);
            new Notice(e?.message || "Auth error");
          } finally {
            btn.setDisabled(false);
            this.display();
          }
        });
    });

    // Optional: quick test
    if (isOAuth) {
      new Setting(containerEl)
        .setName("Connection")
        .setDesc("Verify access to Google Sheets API.")
        .addButton((b: ButtonComponent) =>
          b.setButtonText("Test connection").onClick(async () => {
            b.setDisabled(true);
            try { await this.plugin.ensureAccessToken(); new Notice("Google connection OK."); }
            catch (e:any) { console.error(e); new Notice("Connection failed: " + (e?.message || e)); }
            finally { b.setDisabled(false); }
          })
        );
    }
  }
}


/**
 * Google Sheet → Table (code block version)
 *
 * Usage:
 * ```gsheet
 * sheet: https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0
 * range: A1:D25
 * headers: 1
 * maxRows: 100
 * ```
 *
 * or one-line params:
 * ```gsheet
 * sheet=https://...;range=A1:D25;headers=1;maxRows=50
 * ```
 */

export default class GoogleSheetTablePlugin extends Plugin {
  settings!: PluginSettings;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  async startDesktopAuthPKCE(): Promise<void> {
    // Preconditions
    const a = this.settings.auth;
    if (!a) throw new Error("Plugin settings not initialized.");
    if (a.authMethod !== "oauth-desktop") {
      throw new Error(
        "Set Authentication method to 'OAuth (Desktop, PKCE)' first."
      );
    }
    const clientId = a.clientId?.trim();
    const secret = a.clientSecret?.trim();
    if (!clientId) throw new Error("Missing Google OAuth Client ID (Desktop).");

    // PKCE material
    const codeVerifier = b64url(crypto.randomBytes(48)); // 64 chars base64url
    const codeChallenge = await sha256b64url(codeVerifier);
    const state = b64url(crypto.randomBytes(16)); // CSRF protection

    // Loopback server on 127.0.0.1 using an ephemeral port
    const server = http.createServer();
    const port: number = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string")
          reject(new Error("Failed to bind loopback server"));
        else resolve(addr.port);
      });
    });
    const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;

    // Build the authorization URL
    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", OAUTH_SCOPES);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline"); // get refresh_token
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent"); // force refresh_token in testing
    authUrl.searchParams.set("state", state);

    window.open(authUrl.toString(), "_blank", "noopener");

    // Wait for the browser callback once (with timeout)
    const authCode: string = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          server.close();
        } catch {}
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
          try {
            server.close();
          } catch {}
          return reject(new Error("Missing code or bad state."));
        }

        // Friendly success page
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<html><body style='font-family:sans-serif'>You can close this window and return to Obsidian.</body></html>"
        );

        clearTimeout(timeout);
        try {
          server.close();
        } catch {}
        resolve(code);
      });
    });

    // Exchange authorization code → tokens (PKCE; no client_secret for Desktop clients)
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: secret, // no client_secret for Desktop clients
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: redirectUri, // must match exactly the one used above
      code_verifier: codeVerifier,
    });

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const raw = await resp.text();
    let tok: any = {};
    try {
      tok = JSON.parse(raw);
    } catch {}

    if (!resp.ok) {
      console.log("Token exchange failed:", raw);
      // Map frequent misconfigurations to clearer hints
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

    // Persist tokens
    a.accessToken = tok.access_token;
    a.refreshToken = tok.refresh_token; // present on first consent
    a.tokenExpiry = Date.now() + Number(tok.expires_in) * 1000;
    await this.saveSettings();

    // Optional: notify the settings tab to re-render (if you wired a listener)
    this.app.workspace.trigger("gst-auth-changed");

    new Notice("Google authorization completed.");
  }

  /** Build both a CSV export URL and a canonical "edit" URL for the sheet. */
  private buildUrls(
    sheetUrl: string,
    range?: string,
    sheetName?: string,
    explicitGid?: string
  ): { csvUrl: string; editUrl: string } {
    try {
      const u = new URL(sheetUrl);
      const id = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];

      // gid can live in hash or query; allow explicit override
      const gidFromHash = u.hash.match(/[?&#]gid=(\d+)/)?.[1];
      const gidFromQuery = u.searchParams.get("gid") ?? undefined;
      const gid = explicitGid || gidFromHash || gidFromQuery || undefined;

      // --- Build edit URL (open in browser) ---
      let editUrl = sheetUrl;
      if (id) {
        editUrl = `https://docs.google.com/spreadsheets/d/${id}/edit${
          gid ? `#gid=${gid}` : ""
        }`;
      }

      // --- Build CSV URL (used by the table) ---
      // Case 1: already export CSV
      if (
        u.pathname.includes("/export") &&
        u.searchParams.get("format") === "csv"
      ) {
        if (range) u.searchParams.set("range", range);
        return { csvUrl: u.toString(), editUrl };
      }

      // Case 2: gviz → out:csv
      if (u.pathname.includes("/gviz/tq")) {
        u.searchParams.set("tqx", "out:csv");
        if (range) u.searchParams.set("range", range);
        if (sheetName && !u.searchParams.get("sheet"))
          u.searchParams.set("sheet", sheetName);
        return { csvUrl: u.toString(), editUrl };
      }

      // Case 3: generic Sheets link → export CSV (prefer gid when available)
      if (id && gid) {
        const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
        return {
          csvUrl: range ? `${base}&range=${encodeURIComponent(range)}` : base,
          editUrl,
        };
      }

      if (id) {
        // Fallback: gviz CSV with either named sheet or gid=0
        const gviz = new URL(
          `https://docs.google.com/spreadsheets/d/${id}/gviz/tq`
        );
        gviz.searchParams.set("tqx", "out:csv");
        if (range) gviz.searchParams.set("range", range);
        if (sheetName) gviz.searchParams.set("sheet", sheetName);
        else gviz.searchParams.set("gid", "0");
        return { csvUrl: gviz.toString(), editUrl };
      }

      // Not a recognized Sheets URL → return as-is
      return { csvUrl: sheetUrl, editUrl };
    } catch {
      return { csvUrl: sheetUrl, editUrl: sheetUrl };
    }
  }

  private async fetchCsvRows(
    csvUrl: string,
    token?: string
  ): Promise<string[][]> {
    const headers: Record<string, string> = {
      Accept: "text/csv,text/plain,*/*",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(csvUrl, { method: "GET", headers });
    const text = await res.text();
    const ctype = (res.headers.get("content-type") || "").toLowerCase();

    // Guard: HTML → probabilmente 401/403 o login page
    if (!res.ok || /<html|<!doctype/i.test(text)) {
      console.log("Fetch CSV failed:", res.status, res.statusText, text, ctype);
      if (res.status === 401) {
        throw new Error("Unauthorized: Please check your access token.");
      } else if (res.status === 403) {
        throw new Error(
          "Forbidden: You do not have permission to access this sheet."
        );
      } else {
        throw new Error(
          `Got ${res.status} ${res.statusText}; not CSV (is the sheet shared with this account?)`
        );
      }
    }

    // Parse (Papaparse)
    const parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
      delimitersToGuess: [",", ";", "\t", "|", ":"],
      quoteChar: '"',
      escapeChar: '"',
    });
    if (parsed.errors?.length)
      throw new Error(parsed.errors[0].message || "CSV parse failed");
    return parsed.data as unknown as string[][];
  }

  async onload() {
    this.addSettingTab(new GSheetSettingTab(this.app, this));
    await this.loadSettings();
    this.injectStyles();

    // Register a Markdown code block processor for ```gsheet
    this.registerMarkdownCodeBlockProcessor(
      "gsheet",
      async (source, el, _ctx) => {
        const cfg = this.parseConfig(source);
        if (!cfg.sheet) {
          el.createEl("div", {
            text: "Missing `sheet` URL in gsheet block.",
          }).addClass("gst-error");
          return;
        }

        const placeholder = el.createEl("div", {
          text: "Loading data from Google Sheet…",
        });
        placeholder.addClass("gst-loading");

        try {
          // Before: const csvUrl = this.buildCsvUrl(cfg.sheet, cfg.range);
          // After:
          const { csvUrl, editUrl } = this.buildUrls(
            cfg.sheet,
            cfg.range,
            cfg.sheetName,
            cfg.gid
          );

          // Actions toolbar (appears above the table)
          const actions = el.createEl("div", { cls: "gst-actions" });
          const openLink = actions.createEl("a", {
            text: "Open in Google Sheets",
          });
          openLink.href = editUrl || cfg.sheet;
          openLink.target = "_blank";
          openLink.rel = "noopener";

          let rows: string[][];
          const sheetUrl: string = cfg.sheet;
          const spreadsheetId = sheetUrl.match(
            /\/spreadsheets\/d\/([^/]+)/
          )?.[1];

          if (this.settings.auth.authMethod === "oauth-desktop") {
            if (!spreadsheetId)
              throw new Error(
                "Invalid Google Sheet URL (missing spreadsheetId)."
              );
            // 👉 Usa direttamente la Sheets API: niente pagina login/cookie
            rows = await this.fetchRowsViaSheetsAPI(
              spreadsheetId,
              cfg.range,
              cfg.gid,
              cfg.sheetName
            );
          } else {
            // public-csv: mantieni l’export CSV
            const { csvUrl } = this.buildUrls(
              sheetUrl,
              cfg.range,
              cfg.sheetName,
              cfg.gid
            );
            rows = await this.fetchCsvRows(csvUrl); // senza token (o con token se proprio vuoi)
          }
          const headers = Number(cfg.headers ?? 1);
          const maxRows = cfg.maxRows ? Number(cfg.maxRows) : undefined;
          if (maxRows && rows.length > maxRows + headers)
            rows = rows.slice(0, maxRows + headers);

          const table = this.buildTable(rows, headers);
          placeholder.replaceWith(table);
        } catch (err: any) {
          placeholder.setText(`Error loading sheet: ${err?.message || err}`);
          placeholder.addClass("gst-error");
        }
      }
    );
  }

  // -------- Helpers --------

  private async apiGet(url: string, token: string): Promise<any> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const msg = json?.error?.message || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return json;
  }

  /** Map a numeric gid → sheet title using Sheets API metadata. */
  private async resolveSheetTitle(
    spreadsheetId: string,
    token: string,
    gid?: string,
    sheetName?: string
  ): Promise<string> {
    if (sheetName && sheetName.trim()) return sheetName.trim();
    // Fetch sheet list (title + sheetId)
    const meta = await this.apiGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
      token
    );
    const sheets: any[] = meta.sheets || [];
    if (gid) {
      const hit = sheets.find(
        (s) => String(s?.properties?.sheetId) === String(gid)
      );
      if (hit?.properties?.title) return hit.properties.title as string;
    }
    // Fallback to first sheet title or "Sheet1"
    return sheets[0]?.properties?.title || "Sheet1";
  }

  /** Build an A1 range like `'Sheet Title'!A1:D25` */
  private buildA1(title: string, range?: string): string {
    const needsQuotes = /[\s:!]/.test(title);
    const base = needsQuotes ? `'${title}'` : title;
    return range ? `${base}!${range}` : base;
  }

  /** Fetch rows via Sheets API (majorDimension=ROWS). */
  private async fetchRowsViaSheetsAPI(
    spreadsheetId: string,
    range?: string,
    gid?: string,
    sheetName?: string
  ): Promise<string[][]> {
    const token = await this.ensureAccessToken(); // usa il tuo ensureAccessToken (PKCE)
    const title = await this.resolveSheetTitle(
      spreadsheetId,
      token,
      gid,
      sheetName
    );
    const a1 = this.buildA1(title, range);
    const data = await this.apiGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        a1
      )}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      token
    );
    return (data.values || []) as string[][];
  }

  // Dentro la classe GoogleSheetTablePlugin

  isSignedIn(): boolean {
    const a = this.settings.auth;
    if (a.authMethod !== "oauth-desktop") return false;
    // consideriamo valido se c’è un refresh_token, oppure un access_token ancora valido
    const hasFresh = !!(
      a.accessToken &&
      a.tokenExpiry &&
      Date.now() < a.tokenExpiry - 60_000
    );
    return !!a.refreshToken || hasFresh;
  }

  async signOutGoogle() {
    this.settings.auth.accessToken = undefined;
    this.settings.auth.refreshToken = undefined;
    this.settings.auth.tokenExpiry = undefined;
    await this.saveSettings();
  }

  // Inside your plugin class:
  private refreshInFlight?: Promise<string>;

  /**
   * Ensures a valid access token for Desktop OAuth (PKCE + loopback).
   * - Reuses valid token (with 60s clock skew).
   * - Refreshes using refresh_token + client_id (no client_secret).
   * - Throws in public-csv mode (no auth).
   */
  async ensureAccessToken(): Promise<string> {
    const a = this.settings.auth;

    // 1) Reuse if still valid
    if (a.accessToken && a.tokenExpiry && Date.now() < a.tokenExpiry - 60_000) {
      return a.accessToken;
    }

    // 2) Must be desktop OAuth mode
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

    // Coalesce concurrent refreshes
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const body = new URLSearchParams({
        client_id: a.clientId,
        client_secret: a.clientSecret,
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
      await this.saveSettings();

      this.refreshInFlight = undefined;
      return a.accessToken!;
    })();

    return this.refreshInFlight;
  }

  /** Parse YAML-ish or "key=value;key=value" config into an object */
  private parseConfig(source: string): Record<string, string> {
    const out: Record<string, string> = {};
    const trimmed = source.trim();

    // Try simple key=value;key=value first
    if (
      /[:=]/.test(trimmed) &&
      trimmed.includes("=") &&
      !trimmed.includes("\n")
    ) {
      for (const part of trimmed.split(/;|\s\|\s/)) {
        const m = part.trim().match(/^([\w-]+)\s*=\s*(.+)$/);
        if (!m) continue;
        const key = m[1].trim();
        let val = m[2].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        out[key] = val;
      }
      return out;
    }

    // Fallback: very light YAML parser (line-based key: value)
    for (const line of trimmed.split("\n")) {
      const m = line.match(/^([\w-]+)\s*:\s*(.+)$/);
      if (!m) continue;
      const key = m[1].trim();
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  }

  /**
   * Convert various Google Sheets URLs to a CSV export URL.
   * Supports /export?format=csv, /gviz/tq, and /edit#gid=... forms.
   */
  private buildCsvUrl(
    sheetUrl: string,
    range?: string,
    sheetName?: string,
    explicitGid?: string
  ): string {
    try {
      const u = new URL(sheetUrl);

      // Case A: already an export CSV URL
      if (
        u.pathname.includes("/export") &&
        u.searchParams.get("format") === "csv"
      ) {
        if (range) u.searchParams.set("range", range);
        return u.toString();
      }

      // Case B: gviz/tq → force CSV
      if (u.pathname.includes("/gviz/tq")) {
        u.searchParams.set("tqx", "out:csv");
        if (range) u.searchParams.set("range", range);
        if (sheetName && !u.searchParams.get("sheet"))
          u.searchParams.set("sheet", sheetName);
        return u.toString();
      }

      // Generic Google Sheets URL
      const id = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];

      // gid can be in hash OR in query (?gid=)
      const gidFromHash = u.hash.match(/[?&#]gid=(\d+)/)?.[1];
      const gidFromQuery = u.searchParams.get("gid") ?? undefined;
      const gid = explicitGid || gidFromHash || gidFromQuery;
      console.log("Parsed sheet ID:", id, "gid:", gid);

      if (id && gid) {
        const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
        return range ? `${base}&range=${encodeURIComponent(range)}` : base;
      }

      if (id) {
        // Fallback: use gviz CSV with either sheet name or gid=0
        const gviz = new URL(
          `https://docs.google.com/spreadsheets/d/${id}/gviz/tq`
        );
        gviz.searchParams.set("tqx", "out:csv");
        if (range) gviz.searchParams.set("range", range);
        if (sheetName) gviz.searchParams.set("sheet", sheetName);
        else gviz.searchParams.set("gid", "0");
        return gviz.toString();
      }

      // Not a recognized Sheets URL → return as-is
      return sheetUrl;
    } catch {
      return sheetUrl;
    }
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  }

  /** Build a plain HTML table element */
  private buildTable(rows: string[][], headerRows = 1): HTMLElement {
    const table = document.createElement("table");
    table.className = "gst-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);

    const head = rows.slice(0, headerRows);
    const body = rows.slice(headerRows);

    for (const hr of head) {
      const tr = document.createElement("tr");
      for (const cell of hr) {
        const th = document.createElement("th");
        th.textContent = cell ?? "";
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    }

    for (const br of body) {
      const tr = document.createElement("tr");
      for (const cell of br) {
        const td = document.createElement("td");
        td.textContent = cell ?? "";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    return table;
  }

  /** Inject minimal styles for the table and messages */
  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
.gst-loading { font-size: 0.9em; opacity: 0.8; margin: 0.25rem 0 0.75rem; }
.gst-error { color: var(--color-red, #c22); font-size: 0.9em; }
.gst-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.25rem 0 1rem 0;
  font-size: 0.95em;
}
.gst-table th, .gst-table td {
  border: 1px solid var(--background-modifier-border);
  padding: 6px 8px;
}
.gst-table thead th {
  background: var(--background-modifier-form-field);
  position: sticky; top: 0; z-index: 1;
}
  .gst-actions {
  margin: 0.25rem 0 0.5rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.gst-actions a {
  font-size: 0.9em;
  text-decoration: underline;
  opacity: 0.85;
}
.gst-actions a:hover { opacity: 1; }
.gst-actions button {
  font-size: 0.85em;
  padding: 2px 8px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  border-radius: 6px;
  cursor: pointer;
}
.gst-actions button:hover { filter: brightness(0.98); }
`;
    document.head.appendChild(style);
  }
}
