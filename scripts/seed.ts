// scripts/seed.ts
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4001";

async function main() {
  // Ontario tenancy + traffic + a couple of PDFs
  const docs = [
    { url: "https://www.ontario.ca/laws/statute/06r17" }, // RTA
    { url: "https://www.ontario.ca/laws/regulation/060516" }, // RTA Reg.
    { url: "https://www.ontario.ca/page/guide-ontarios-standard-lease" },
    { url: "https://files.ontario.ca/mmah-guide-to-standard-lease-for-rental-housing-en-2022-04-19.pdf" }, // PDF
    { url: "https://tribunalsontario.ca/ltb/" },
    { url: "https://tribunalsontario.ca/ltb/forms-filing-and-fees/" },
    { url: "https://tribunalsontario.ca/ltb/tribunals-ontario-portal/" },
    { url: "https://tribunalsontario.ca/documents/ltb/Notices%20of%20Termination%20%26%20Instructions/N4.pdf" }, // PDF
    { url: "https://www.ontario.ca/laws/statute/90h08" }, // Highway Traffic Act
    { url: "https://www.ontario.ca/page/understanding-demerit-points" },
    // a few more useful regs/pages
    { url: "https://www.ontario.ca/laws/regulation/020516" }, // Gen Reg O.Reg. 516/02 (RTA)
    { url: "https://www.ontario.ca/page/rent-increase-guideline" },
    { url: "https://tribunalsontario.ca/ltb/forms/" },
  ];

  console.log(`POST ${API_URL}/ingest (${docs.length} docs)`);
  try {
    const r = await axios.post(
      `${API_URL}/ingest`,
      { docs },
      {
        timeout: 10 * 60 * 1000,
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log("Ingest OK:\n", JSON.stringify(r.data, null, 2));
  } catch (err: any) {
    if (err.response) {
      console.error("Server responded with error:", err.response.status, err.response.data);
    } else if (err.request) {
      console.error("No response from server (is it running / right port?):", err.code || err.message);
    } else {
      console.error("Seed failed:", err.message);
    }
    process.exit(1);
  }
}

main();
