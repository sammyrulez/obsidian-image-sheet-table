import { Plugin, MarkdownPostProcessorContext } from "obsidian";
// @ts-ignore - esbuild bundler includes papaparse
import Papa from "papaparse";

/**
 * Plugin che trova <img title="sheet=...;range=..."> e inserisce una tabella
 * con i dati del Google Sheet sotto l'immagine.
 */
export default class ImageSheetTablePlugin extends Plugin {
  async onload() {
    this.injectStyles();

    this.registerMarkdownPostProcessor(async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const imgs = el.querySelectorAll<HTMLImageElement>("img[title]");
      for (const img of Array.from(imgs)) {
        // Evita doppio rendering in Live Preview
        if (img.closest(".image-sheet-rendered")) continue;

        const params = this.parseParams(img.title || "");
        if (!params.sheet) continue;

        // Contenitore per isolare stili/rerender
        const wrapper = document.createElement("div");
        wrapper.classList.add("image-sheet-rendered");
        img.insertAdjacentElement("afterend", wrapper);

        // Sposta l'immagine dentro il wrapper (così immagine e tabella stanno insieme)
        wrapper.appendChild(img.cloneNode(true));
        // Nascondi l'originale (non lo rimuovo per non rompere mapping interno)
        img.style.display = "none";

        // Placeholder loading
        const loading = document.createElement("div");
        loading.className = "image-sheet-loading";
        loading.textContent = "Carico dati dal Google Sheet…";
        wrapper.appendChild(loading);

        try {
          const csvUrl = this.buildCsvUrl(params.sheet, params.range);
          const csv = await this.fetchText(csvUrl);
          const parsed = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true });
          if (parsed.errors?.length) {
            throw new Error(parsed.errors.map((e: { message: any; }) => e.message).join("; "));
          }
          let rows: string[][] = (parsed.data as unknown as string[][]);

          const headers = Number(params.headers ?? 1);
          const maxRows = params.maxRows ? Number(params.maxRows) : undefined;
          if (maxRows && rows.length > maxRows + headers) {
            rows = rows.slice(0, maxRows + headers);
          }

          const table = this.buildTable(rows, headers);
          loading.replaceWith(table);
        } catch (err: any) {
          loading.textContent = `Errore nel caricare il foglio: ${err?.message || err}`;
          loading.classList.add("image-sheet-error");
        }
      }
    });
  }

  // --- helpers ---

  /** title parser: "key=val;key2=val2" → { key: val, ... } */
  private parseParams(title: string): Record<string, string> {
    const out: Record<string, string> = {};
    // Consenti che ci siano altri testi nel title: estrai solo coppie key=val
    const parts = title.split(/;|\s\|\s/);
    for (const part of parts) {
      const m = part.trim().match(/^([\w-]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const key = m[1].trim();
      let val = m[2].trim();
      // rimuovi eventuali doppi apici attorno al valore
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  }

  /**
   * Dato un link a Google Sheet, costruisce un URL CSV.
   * Supporta:
   * - export CSV già pronto (lo usa così com'è)
   * - link "edit#gid=..." → convertito in export CSV
   * - link gviz/tq → forzato out:csv
   */
  private buildCsvUrl(sheetUrl: string, range?: string): string {
    try {
      const u = new URL(sheetUrl);
      // Caso 1: già export CSV
      if (u.pathname.includes("/export") && u.searchParams.get("format") === "csv") {
        if (range) u.searchParams.set("range", range);
        return u.toString();
      }
      // Caso 2: gviz → out:csv
      if (u.pathname.includes("/gviz/tq")) {
        u.searchParams.set("tqx", "out:csv");
        if (range) u.searchParams.set("range", range);
        return u.toString();
      }
      // Caso 3: edit#gid=... → export CSV
      const m = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
      const id = m?.[1];
      const gid = u.hash.match(/gid=(\d+)/)?.[1];
      if (id && gid) {
        const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
        return range ? `${base}&range=${encodeURIComponent(range)}` : base;
      }
      // Fallback: restituisci l'originale (magari è un CSV http esterno)
      return sheetUrl;
    } catch {
      return sheetUrl; // se non è una URL valida, passa così com'è
    }
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  }

  private buildTable(rows: string[][], headerRows = 1): HTMLElement {
    const table = document.createElement("table");
    table.className = "image-sheet-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);

    const headers = rows.slice(0, headerRows);
    const body = rows.slice(headerRows);

    for (const hr of headers) {
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

  private injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
.image-sheet-rendered { margin-top: 0.5rem; }
.image-sheet-rendered > img { display: block; margin-bottom: 0.5rem; }
.image-sheet-loading { font-size: 0.9em; opacity: 0.8; }
.image-sheet-error { color: var(--color-red, #c22); }
.image-sheet-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.25rem 0 1rem 0;
  font-size: 0.9em;
}
.image-sheet-table th, .image-sheet-table td {
  border: 1px solid var(--background-modifier-border);
  padding: 6px 8px;
}
.image-sheet-table thead th {
  background: var(--background-modifier-form-field);
  position: sticky; top: 0; z-index: 1;
}
`;
    document.head.appendChild(style);
  }
}
