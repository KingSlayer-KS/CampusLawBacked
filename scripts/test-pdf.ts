// scripts/test-pdf.ts
import pdfParseModule from "pdf-parse/lib/pdf-parse.js";
const pdfParse: any = (pdfParseModule as any).default || (pdfParseModule as any);

(async () => {
  const url = "https://tribunalsontario.ca/documents/ltb/Notices%20of%20Termination%20%26%20Instructions/N4.pdf";
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const { text } = await pdfParse(buf);
  console.log(text.slice(0, 800));
})();
