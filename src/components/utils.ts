// Funzioni di utilità: base64url, sha256, parsing config
import * as crypto from "crypto";

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

export function parseConfig(source: string): Record<string, string> {
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
