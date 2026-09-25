/**
 * Analyseur Markdown minimal, suffisant pour les documents produits par MonMeeting
 * (titres, paragraphes, listes, tableaux, séparateurs, gras/italique).
 * Un même arbre alimente l'affichage HTML et l'export Word.
 */

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "quote"; text: string }
  | { type: "hr" };

export type Inline = { text: string; bold?: boolean; italic?: boolean };

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Ligne de séparation de tableau (|---|:--:|) ; vérification cellule par cellule, en temps linéaire. */
function isTableSep(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(line.replace(/\s/g, ""))) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push(m[2]);
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
        } else {
          break;
        }
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: parts.join(" ") });
      continue;
    }

    const parts: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*([-*+]|\d+[.)])\s+|>)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      parts.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: parts.join(" ") });
  }
  return blocks;
}

/** Découpe le texte en segments gras / italique. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) out.push({ text: m[4], italic: true });
    else out.push({ text: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(text: string): string {
  return parseInline(text)
    .map((part) => {
      const t = escapeHtml(part.text);
      if (part.bold) return `<strong>${t}</strong>`;
      if (part.italic) return `<em>${t}</em>`;
      return t;
    })
    .join("");
}

export function markdownToHtml(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
        case "paragraph":
          return `<p>${inlineHtml(b.text)}</p>`;
        case "quote":
          return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
        case "hr":
          return "<hr />";
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          return `<${tag}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</${tag}>`;
        }
        case "table":
          return `<div class="table-wrap"><table><thead><tr>${b.header
            .map((h) => `<th>${inlineHtml(h)}</th>`)
            .join("")}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`;
      }
    })
    .join("\n");
}
