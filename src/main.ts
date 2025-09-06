import {
  App,
  Plugin,
} from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings } from "./settings";
import { GSheetSettingTab } from "./components/settingsTab";
import { GoogleAuth } from "./components/auth";
import { buildUrls, fetchCsvRows } from "./components/sheetApi";
import { buildTable, injectStyles } from "./components/tableRenderer";
import { parseConfig } from "./components/utils";

export default class GoogleSheetTablePlugin extends Plugin {
  settings!: PluginSettings;
  auth!: GoogleAuth;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.auth = new GoogleAuth(this.settings.auth);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onload() {
    this.addSettingTab(new GSheetSettingTab(this.app, this));
    await this.loadSettings();
    injectStyles();
    this.registerMarkdownCodeBlockProcessor(
      "gsheet",
      async (source, el, _ctx) => {
        const cfg = parseConfig(source);
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
          const { csvUrl, editUrl } = buildUrls(
            cfg.sheet,
            cfg.range,
            cfg.sheetName,
            cfg.gid
          );
          const actions = el.createEl("div", { cls: "gst-actions" });
          const openLink = actions.createEl("a", {
            text: "Open in Google Sheets",
          });
          openLink.href = editUrl || cfg.sheet;
          openLink.target = "_blank";
          openLink.rel = "noopener";
          let rows: string[][];
          if (this.settings.auth.authMethod === "oauth-desktop") {
            rows = await fetchCsvRows(csvUrl, await this.auth.ensureAccessToken());
          } else {
            rows = await fetchCsvRows(csvUrl);
          }
          const headers = Number(cfg.headers ?? 1);
          const maxRows = cfg.maxRows ? Number(cfg.maxRows) : undefined;
          if (maxRows && rows.length > maxRows + headers)
            rows = rows.slice(0, maxRows + headers);
          const table = buildTable(rows, headers);
          placeholder.replaceWith(table);
        } catch (err: any) {
          placeholder.setText(`Error loading sheet: ${err?.message || err}`);
          placeholder.addClass("gst-error");
        }
      }
    );
  }

  isSignedIn(): boolean {
    return this.auth.isSignedIn();
  }

  async signOutGoogle() {
    await this.auth.signOutGoogle();
  }

  async startDesktopAuthPKCE(): Promise<void> {
    await this.auth.startDesktopAuthPKCE();
    await this.saveSettings();
    this.app.workspace.trigger("gst-auth-changed");
  }

  async ensureAccessToken(): Promise<string> {
    return await this.auth.ensureAccessToken();
  }
}
