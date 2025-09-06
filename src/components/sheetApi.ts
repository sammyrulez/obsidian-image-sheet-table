// Funzioni per costruzione URL, fetch dati da Google Sheets (API e CSV)
import * as Papa from "papaparse";

export function buildUrls(sheetUrl: string, range?: string, sheetName?: string, explicitGid?: string): { csvUrl: string; editUrl: string } {
  try {
    const u = new URL(sheetUrl);
    const id = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
    const gidFromHash = u.hash.match(/[?&#]gid=(\d+)/)?.[1];
    const gidFromQuery = u.searchParams.get("gid") ?? undefined;
    const gid = explicitGid || gidFromHash || gidFromQuery || undefined;
    let editUrl = sheetUrl;
    if (id) {
      editUrl = `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `#gid=${gid}` : ""}`;
    }
    if (
      u.pathname.includes("/export") &&
      u.searchParams.get("format") === "csv"
    ) {
      if (range) u.searchParams.set("range", range);
      return { csvUrl: u.toString(), editUrl };
    }
    if (u.pathname.includes("/gviz/tq")) {
      u.searchParams.set("tqx", "out:csv");
      if (range) u.searchParams.set("range", range);
      if (sheetName && !u.searchParams.get("sheet"))
        u.searchParams.set("sheet", sheetName);
      return { csvUrl: u.toString(), editUrl };
    }
    if (id && gid) {
      const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
      return {
        csvUrl: range ? `${base}&range=${encodeURIComponent(range)}` : base,
        editUrl,
      };
    }
    if (id) {
      const gviz = new URL(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq`);
      gviz.searchParams.set("tqx", "out:csv");
      if (range) gviz.searchParams.set("range", range);
      if (sheetName) gviz.searchParams.set("sheet", sheetName);
      else gviz.searchParams.set("gid", "0");
      return { csvUrl: gviz.toString(), editUrl };
    }
    return { csvUrl: sheetUrl, editUrl: sheetUrl };
  } catch {
    return { csvUrl: sheetUrl, editUrl: sheetUrl };
  }
}

export async function fetchCsvRows(csvUrl: string, token?: string): Promise<string[][]> {
  const headers: Record<string, string> = {
    Accept: "text/csv,text/plain,*/*",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(csvUrl, { method: "GET", headers });
  const text = await res.text();
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok || /<html|<!doctype/i.test(text)) {
    if (res.status === 401) {
      throw new Error("Unauthorized: Please check your access token.");
    } else if (res.status === 403) {
      throw new Error("Forbidden: You do not have permission to access this sheet.");
    } else {
      throw new Error(`Got ${res.status} ${res.statusText}; not CSV (is the sheet shared with this account?)`);
    }
  }
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

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

export async function fetchRowsViaSheetsAPI(
  spreadsheetId: string,
  range?: string,
  gid?: string,
  sheetName?: string,
  token?: string
): Promise<string[][]> {
  if (!token) throw new Error("Missing access token for protected sheet");
  // Resolve sheet title if needed
  const title = await resolveSheetTitle(spreadsheetId, token, gid, sheetName);
  const a1 = buildA1(title, range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(a1)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return (data.values || []) as string[][];
}

export async function resolveSheetTitle(
  spreadsheetId: string,
  token: string,
  gid?: string,
  sheetName?: string
): Promise<string> {
  if (sheetName && sheetName.trim()) return sheetName.trim();
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
  const res = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await res.json();
  const sheets: any[] = meta.sheets || [];
  if (gid) {
    const hit = sheets.find((s) => String(s?.properties?.sheetId) === String(gid));
    if (hit?.properties?.title) return hit.properties.title as string;
  }
  return sheets[0]?.properties?.title || "Sheet1";
}

export function buildA1(title: string, range?: string): string {
  const needsQuotes = /[\s:!]/.test(title);
  const base = needsQuotes ? `'${title}'` : title;
  return range ? `${base}!${range}` : base;
}
