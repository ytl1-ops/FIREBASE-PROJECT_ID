// Export Word, chargé à la demande (la bibliothèque docx est volumineuse).
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { CLASSIFICATION_LABELS, type Classification } from "../../shared/types.ts";
import type { Meeting } from "./db.ts";
import { parseInline, parseMarkdown } from "./markdown.ts";

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function runs(text: string, base: { bold?: boolean; color?: string } = {}): TextRun[] {
  return parseInline(text).map(
    (p) => new TextRun({ text: p.text, bold: p.bold || base.bold, italics: p.italic, color: base.color }),
  );
}

function classificationBanner(classification: Classification): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: CLASSIFICATION_LABELS[classification].toUpperCase(),
        bold: true,
        size: 18,
        color: classification === "non_protege" ? "555555" : "B42318",
      }),
    ],
  });
}

export async function buildDocx(markdown: string, meeting: Meeting): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];
  let listInstance = 0;

  for (const block of parseMarkdown(markdown)) {
    switch (block.type) {
      case "heading":
        children.push(
          new Paragraph({ heading: HEADINGS[block.level - 1], children: runs(block.text) }),
        );
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runs(block.text), spacing: { after: 120 } }));
        break;
      case "quote":
        children.push(
          new Paragraph({
            children: runs(block.text),
            indent: { left: 400 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "0F2A44", space: 8 } },
          }),
        );
        break;
      case "hr":
        children.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } },
          }),
        );
        break;
      case "list":
        listInstance += 1;
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: runs(item),
              ...(block.ordered
                ? { numbering: { reference: "numerotation", level: 0, instance: listInstance } }
                : { bullet: { level: 0 } }),
            }),
          );
        }
        break;
      case "table": {
        const cell = (text: string, header: boolean) =>
          new TableCell({
            children: [new Paragraph({ children: runs(text, header ? { bold: true, color: "FFFFFF" } : {}) })],
            shading: header ? { type: ShadingType.CLEAR, color: "auto", fill: "0F2A44" } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
          });
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ tableHeader: true, children: block.header.map((h) => cell(h, true)) }),
              ...block.rows.map(
                (r) =>
                  new TableRow({
                    children: block.header.map((_, i) => cell(r[i] ?? "", false)),
                  }),
              ),
            ],
          }),
          new Paragraph({}),
        );
        break;
      }
    }
  }

  const doc = new Document({
    creator: "MonMeeting",
    title: meeting.info.title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "numerotation",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [
      {
        headers: { default: new Header({ children: [classificationBanner(meeting.info.classification)] }) },
        footers: {
          default: new Footer({
            children: [
              classificationBanner(meeting.info.classification),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: ["Page ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

