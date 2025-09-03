# Google Sheet → Table (Obsidian Plugin)

Render tables from **Google Sheets** directly inside your notes — no image needed.
Use a fenced code block:

````md
```gsheet
sheet=https://docs.google.com/spreadsheets/d/ID/edit#gid=0;range=A1:D25;headers=1;maxRows=50
```
````

The plugin supports **public CSV** links out-of-the-box, and **private sheets** via **Google OAuth Device Flow** (no server, no secrets stored in code).

---

## Features

* 🚀 Render a Sheet range as an HTML table inside Markdown
* 🔗 “**Open in Google Sheets**” link above each table
* 📋 “**Copy CSV URL**” quick action (helpful for debugging)
* 🧭 Flexible URL handling: `export?format=csv`, `gviz/tq?tqx=out:csv`, or standard `/edit#gid=…`
* 🧩 Optional parameters: `range`, `headers`, `maxRows`, `gid`, `sheetName`
* 🔐 **Private sheets** support (OAuth Device Flow) with Sheets/Drive API
* 🛡️ Idempotent rendering (no lingering “Loading…” on re-render)

---

## Requirements

* **Obsidian** v1.5+ (recommended 1.6+)
* **Node.js LTS** (for dev builds)
* Internet access to fetch Sheets data

---

## Installation

### Option A — Quick local install

1. Build the plugin:

   ```bash
   npm install
   npm run build
   ```
2. Copy the build outputs into your vault:

   ```
   <YOUR_VAULT>/.obsidian/plugins/google-sheet-table/
   ```

   Files to include: `manifest.json`, `main.js` (and `styles.css` if present).
3. In Obsidian:

   * Settings → **Community plugins** → disable **Restricted mode** (if enabled)
   * **Installed plugins** → enable **Google Sheet → Table**

### Option B — Dev workflow (symlink + watch)

1. Create a symlink from your project folder into the vault plugins folder.

   * macOS/Linux:

     ```bash
     ln -s /path/to/project /path/to/<YOUR_VAULT>/.obsidian/plugins/google-sheet-table
     ```
   * Windows (PowerShell):

     ```powershell
     New-Item -ItemType SymbolicLink `
       -Path "C:\<YOUR_VAULT>\.obsidian\plugins\google-sheet-table" `
       -Target "C:\path\to\project"
     ```
2. Start watch build:

   ```bash
   npm run dev
   ```
3. In Obsidian: Command Palette → **Reload app** (or toggle the plugin off/on).

---

## Usage

Add a fenced code block with language `gsheet`.

### Compact (single-line) format

````md
```gsheet
sheet=https://docs.google.com/spreadsheets/d/ID/edit#gid=0;range=A1:D25;headers=1;maxRows=50
```
````

### YAML-like (multi-line) format

````md
```gsheet
sheet: https://docs.google.com/spreadsheets/d/ID/edit#gid=0
range: A1:D25
headers: 1
maxRows: 50
```
````

> **Note:** If your link is like `/edit?usp=sharing` and **has no `gid`**, either add `gid=<number>` or set `sheetName: <tab-title>`. The plugin can also convert standard URLs to CSV automatically.

---

## Parameters

| Key         | Type   | Required | Description                                                                     |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `sheet`     | string | ✅        | Google Sheets URL. Supports `/export?format=csv`, `/gviz/tq`, or `/edit#gid=…`. |
| `range`     | string | ❌        | A1 range, e.g. `A1:D25`.                                                        |
| `headers`   | number | ❌        | Number of header rows at the top (default **1**).                               |
| `maxRows`   | number | ❌        | Limit body rows (excludes header rows).                                         |
| `gid`       | string | ❌        | Sheet tab id (numeric). Useful if your URL lacks `#gid=`.                       |
| `sheetName` | string | ❌        | Sheet tab title (used when `gid` is missing or for private sheets via API).     |

Above the rendered table you’ll see:

* **Open in Google Sheets** → opens your sheet in the default browser
* **Copy CSV URL** → copies the effective CSV URL used to fetch data

---

## Private Sheets (OAuth Device Flow)

You can render **private** (non-public) sheets without a server by authorizing the plugin with your Google account.

### 1) Create an OAuth Client (one-time)

1. Go to **Google Cloud Console** → **APIs & Services** → **Credentials**.
2. Create **OAuth client ID** → **Desktop app**. Copy the **Client ID**.
3. In **OAuth consent screen**, add your account as a **Test user**.
4. Ensure APIs are enabled (Sheets API, Drive API).

### 2) Plugin Settings

Add a settings UI (or directly edit your plugin settings object) with:

* **Auth method**: `public-csv` (default) or `oauth-device`
* **Google OAuth Client ID**: your client id
* **Sign in to Google** button

Click **Sign in to Google**, follow the verification URL, enter the user code, and approve.
The plugin stores:

* `accessToken` (short-lived),
* `refreshToken` (long-lived),
* `tokenExpiry` (epoch ms).

> Tokens are stored in Obsidian’s plugin data (local to your machine). You can revoke access from your Google Account security page at any time.

### 3) Using private sheets

With `Auth method = oauth-device`, the plugin calls the **Sheets API** to fetch values:

* It resolves your target tab using `gid` or `sheetName` (falls back to `"Sheet1"` if missing).
* It builds an **A1 notation** like `'Sheet1'!A1:D25` and calls:

  ```
  GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{A1_RANGE}
  Authorization: Bearer <access_token>
  ```
* For standard public CSV mode, it still uses the CSV export URLs.

---

## Examples

**Simple (public sheet):**

````md
```gsheet
sheet=https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0;range=A1:C20;headers=1
```
````

**Private sheet with named tab (OAuth):**

````md
```gsheet
sheet=https://docs.google.com/spreadsheets/d/ID/edit
sheetName: KPI
range: A2:F200
headers: 1
```
````

**URL without `gid` but explicit `gid` param:**

````md
```gsheet
sheet=https://docs.google.com/spreadsheets/d/ID/edit?usp=sharing;gid=123456789;range=A1:D25;headers=1
```
````

---

## Troubleshooting

### “Loading data from Google Sheet…” never disappears

* Make sure you’re on the latest build of the plugin (the renderer is **idempotent** and removes the placeholder).
* Use Command Palette → **Reload app** after updating the plugin.

### “Trailing quote on quoted field is malformed”

* You probably fetched **HTML instead of CSV** (login/forbidden).
  Use a proper CSV link:
  `.../export?format=csv&gid=<GID>&range=A1:D25`
  or `.../gviz/tq?tqx=out:csv&gid=<GID>&range=A1:D25`.
* Ensure sharing is **Anyone with the link → Viewer** (for public mode).
* The plugin also tries multiple delimiters (`,`, `;`, `\t`, `|`, `:`) and normalizes quotes.

### `gid` is `undefined`

* Your link lacks `#gid=`. Add `gid=<number>` or provide `sheetName: <tab-title>`.
* The plugin can fall back to `gviz` with `sheetName`, or `gid=0`.

### Nothing renders (code block stays visible)

* Confirm the block uses **triple backticks** and language `gsheet`.
* Ensure `sheet:` and the URL are on the **same line** (in YAML-like mode).
* Switch to **Reading view** to test rendering.
* Open Developer Tools → **Console** to see errors (macOS `⌘⌥I`, Win/Linux `Ctrl+Shift+I`).

---

## Developer Notes

### Logging & Sourcemaps

Add simple helpers:

```ts
const LOG = (...a:any[]) => console.log("[GSheetTable]", ...a);
```

Enable sourcemaps in `package.json`:

```json
"scripts": {
  "dev": "esbuild src/main.ts --bundle --outfile=main.js --format=cjs --platform=node --external:obsidian --watch --sourcemap=inline",
  "build": "esbuild src/main.ts --bundle --outfile=main.js --format=cjs --platform=node --external:obsidian --sourcemap"
}
```

### Styling

Minimal styles are injected at runtime. You can override them via a theme snippet:

```css
.gst-table { font-size: 0.95em; }
.gst-actions a { color: var(--text-accent); }
```

---

## Security & Privacy

* **Public CSV mode:** data is fetched anonymously from Google’s public CSV endpoints.
* **OAuth mode:** access/refresh tokens are stored locally in Obsidian’s plugin data.
  Scopes used:

  * `spreadsheets.readonly`
  * `drive.readonly` (to resolve sheet metadata like tab title from `gid`)
* Revoke access anytime from your Google Account → **Security** → **Third-party access**.

---

## Roadmap (nice-to-have)

* Column formatting (dates/numbers)
* Per-note refresh command
* In-memory caching & background refresh
* Service Account auth (JWT) as an alternative to OAuth

---

## License

MIT — see `LICENSE`.

---

## Changelog (highlights)

* **0.2.0** — Code block `gsheet`, actions toolbar, robust URL handling, OAuth Device Flow support, idempotent rendering.
* **0.1.x** — Initial image-title prototype (deprecated in favor of code block).
