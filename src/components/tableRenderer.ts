// Funzioni per costruzione e rendering della tabella HTML
export function buildTable(rows: string[][], headerRows = 1): HTMLElement {
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

export function injectStyles() {
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
