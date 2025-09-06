// UI delle impostazioni (classe GSheetSettingTab)
import { PluginSettingTab, Setting, Notice, ButtonComponent, App } from "obsidian";
import { AuthSettings, GoogleAuth } from "./auth";

export class GSheetSettingTab extends PluginSettingTab {
  plugin: any;
  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Google Sheet → Table" });
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
    const cidRow = new Setting(containerEl)
      .setName("Google OAuth Client ID")
      .setDesc("Required for OAuth Desktop; use your Desktop or Web client ID.")
      .addText(t => t
        .setPlaceholder("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com")
        .setValue(this.plugin.settings.auth.clientId || "")
        .onChange(async v => { this.plugin.settings.auth.clientId = v.trim(); await this.plugin.saveSettings(); })
      );
    cidRow.settingEl.classList.toggle("mod-muted", !isOAuth);
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
              await this.plugin.startDesktopAuthPKCE();
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
