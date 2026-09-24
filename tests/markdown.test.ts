import { describe, expect, it } from "vitest";
import { markdownToHtml, parseMarkdown } from "../src/lib/markdown.ts";

describe("parseMarkdown", () => {
  it("reconnaît titres, listes et tableaux", () => {
    const blocks = parseMarkdown(`# PV

Texte **gras**.

- un
- deux

1. a
2. b

| N° | Action |
|---|---|
| 1 | Renforcer |
`);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "table"]);
    expect(blocks[4]).toMatchObject({ header: ["N°", "Action"], rows: [["1", "Renforcer"]] });
  });

  it("échappe le HTML", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});
