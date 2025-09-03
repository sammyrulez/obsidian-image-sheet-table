import { Plugin } from "obsidian";
// @ts-ignore - bundled by esbuild
import Papa from "papaparse";

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
  async onload() {
    this.injectStyles();

    // Register a Markdown code block processor for ```gsheet
    this.registerMarkdownCodeBlockProcessor("gsheet", async (source, el, _ctx) => {
      const cfg = this.parseConfig(source);
      if (!cfg.sheet) {
        el.createEl("div", { text: "Missing `sheet` URL in gsheet block." }).addClass("gst-error");
        return;
      }

      const placeholder = el.createEl("div", { text: "Loading data from Google Sheet…" });
      placeholder.addClass("gst-loading");

      try {
        const csvUrl = this.buildCsvUrl(cfg.sheet, cfg.range);
        const csv = await this.fetchText(csvUrl);
        const parsed = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true });
        if (parsed.errors?.length) throw new Error(parsed.errors.map((e: Papa.ParseError) => e.message).join("; "));

        let rows = parsed.data as unknown as string[][];
        const headers = Number(cfg.headers ?? 1);
        const maxRows = cfg.maxRows ? Number(cfg.maxRows) : undefined;
        if (maxRows && rows.length > maxRows + headers) rows = rows.slice(0, maxRows + headers);

        const table = this.buildTable(rows, headers);
        placeholder.replaceWith(table);
      } catch (err: any) {
        placeholder.setText(`Error loading sheet: ${err?.message || err}`);
        placeholder.addClass("gst-error");
      }
    });
  }

  // -------- Helpers --------

  /** Parse YAML-ish or "key=value;key=value" config into an object */
  private parseConfig(source: string): Record<string, string> {
    const out: Record<string, string> = {};
    const trimmed = source.trim();

    // Try simple key=value;key=value first
    if (/[:=]/.test(trimmed) && trimmed.includes("=") && !trimmed.includes("\n")) {
      for (const part of trimmed.split(/;|\s\|\s/)) {
        const m = part.trim().match(/^([\w-]+)\s*=\s*(.+)$/);
        if (!m) continue;
        const key = m[1].trim();
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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
  private buildCsvUrl(sheetUrl: string, range?: string): string {
    try {
      const u = new URL(sheetUrl);

      // Already an export CSV URL
      if (u.pathname.includes("/export") && u.searchParams.get("format") === "csv") {
        if (range) u.searchParams.set("range", range);
        return u.toString();
      }

      // gviz → out:csv
      if (u.pathname.includes("/gviz/tq")) {
        u.searchParams.set("tqx", "out:csv");
        if (range) u.searchParams.set("range", range);
        return u.toString();
      }

      // edit#gid=... → export CSV
      const m = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
      const id = m?.[1];
      const gid = u.hash.match(/gid=(\d+)/)?.[1];
      if (id && gid) {
        const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
        return range ? `${base}&range=${encodeURIComponent(range)}` : base;
      }

      // Fallback: return original (could be a direct CSV)
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
`;
    document.head.appendChild(style);
  }
}
