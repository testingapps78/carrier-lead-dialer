// Enriches a carrier we already found (via the FMCSA Census File) with the
// extra detail FMCSA now publishes on its newer Motus registration system —
// company officials (names/titles/emails), DUNS, state of incorporation,
// and a vehicle-type breakdown.
//
// IMPORTANT: motus.dot.gov is a client-rendered JavaScript app — its raw
// HTML response is just an empty shell ("you need to enable JavaScript to
// run this app"). A plain fetch() can never see the actual data, so this
// runs a real (headless) browser server-side to let the page's own
// JavaScript build the content, then reads the result. That's slower and
// heavier than a normal API call, and this specific site is built as an
// anti-fraud identity system, so it may have defenses against automated
// browsers that a plain HTTP client wouldn't hit. Parsing is done by
// looking for the field labels rather than CSS classes/structure, since
// labels are what we can actually confirm from real examples.
import * as cheerio from "cheerio";

export interface MotusOfficial {
  name: string;
  title: string;
  phone: string;
  email: string;
}

export interface MotusVehicle {
  type: string;
  owned: string;
  leased: string;
}

export interface MotusEnrichment {
  dunsBradstreet: string | null;
  formOfBusiness: string | null;
  stateIncorporated: string | null;
  businessEmail: string | null;
  officials: MotusOfficial[];
  operationTypes: string[];
  cargoClasses: string[];
  vehicles: MotusVehicle[];
  fetchedAt: string;
}

async function renderMotusPage(dotNumber: number): Promise<string | null> {
  // Deferred imports: these packages bundle a Chromium binary and should
  // only ever load inside the serverless function that actually needs them.
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = await import("puppeteer-core");

  let browser: import("puppeteer-core").Browser | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(9000);

    await page.goto(`https://motus.dot.gov/customer/${dotNumber}/account`, {
      waitUntil: "networkidle0",
      timeout: 9000,
    });

    // Give the SPA's own render pass a brief moment past "network idle" —
    // some data can finish binding to the DOM just after the last request.
    await new Promise((resolve) => setTimeout(resolve, 800));

    const html = await page.content();
    return html;
  } catch (err) {
    console.error("motus headless render failed:", err);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function textAfterLabel($: cheerio.CheerioAPI, label: string): string | null {
  let result: string | null = null;
  $("*").each((_, el) => {
    if (result) return;
    const node = $(el);
    const ownText = node.contents().first().text().trim();
    if (ownText === label || node.text().trim() === label) {
      // Try the next sibling element's text first — the common layout for
      // these label/value pairs — then fall back to the parent's next sibling.
      const sibling = node.next();
      const parentSibling = node.parent().next();
      const candidate = (sibling.text() || parentSibling.text() || "").trim();
      if (candidate && candidate !== label) result = candidate;
    }
  });
  return result;
}

function parseOfficialsTable($: cheerio.CheerioAPI): MotusOfficial[] {
  const officials: MotusOfficial[] = [];
  $("table").each((_, table) => {
    const headerText = $(table).find("tr").first().text();
    if (!/official/i.test(headerText) || !/title/i.test(headerText)) return;
    $(table)
      .find("tr")
      .slice(1)
      .each((_, row) => {
        const cells = $(row)
          .find("td")
          .map((_, td) => $(td).text().trim())
          .get();
        if (cells.length >= 2 && cells[0]) {
          officials.push({
            name: cells[0] || "",
            title: cells[1] || "",
            phone: cells[2] || "",
            email: cells[3] || "",
          });
        }
      });
  });
  return officials;
}

function parseVehiclesTable($: cheerio.CheerioAPI): MotusVehicle[] {
  const vehicles: MotusVehicle[] = [];
  $("table").each((_, table) => {
    const headerText = $(table).find("tr").first().text();
    if (!/vehicle type/i.test(headerText)) return;
    $(table)
      .find("tr")
      .slice(1)
      .each((_, row) => {
        const cells = $(row)
          .find("td")
          .map((_, td) => $(td).text().trim())
          .get();
        if (cells.length >= 1 && cells[0]) {
          vehicles.push({ type: cells[0], owned: cells[1] || "", leased: cells[2] || "" });
        }
      });
  });
  return vehicles;
}

function parseBoldedOptions($: cheerio.CheerioAPI, sectionHeading: string): string[] {
  const results: string[] = [];
  $("*").each((_, el) => {
    const node = $(el);
    if (node.children().length > 0) return; // leaf nodes only
    if (node.text().trim() === "") return;
  });
  // Fallback approach: within the section, bold/strong-styled leaf text
  // nodes are the selected options (the screenshots show unselected
  // options rendered in a lighter/greyed style, selected ones in bold).
  const section = $(`*:contains("${sectionHeading}")`).last();
  section
    .parent()
    .find("b, strong, [style*='font-weight: bold'], [style*='font-weight:700']")
    .each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length < 60 && !results.includes(t)) results.push(t);
    });
  return results;
}

export async function fetchMotusEnrichment(dotNumber: number): Promise<MotusEnrichment | null> {
  const html = await renderMotusPage(dotNumber);
  if (!html) return null;
  const $ = cheerio.load(html);

  // If the page is a login wall rather than a public record, bail out cleanly.
  if (/sign in|log in to motus|login\.gov/i.test($("title").text() + $("h1").text())) {
    return null;
  }

  const cargoSection = $('*:contains("CARGO CLASSIFICATION")').last().parent();
  const cargoClasses = cargoSection
    .find("li")
    .map((_, li) => $(li).text().trim())
    .get()
    .filter(Boolean);

  return {
    dunsBradstreet: textAfterLabel($, "Duns & Bradstreet"),
    formOfBusiness: textAfterLabel($, "Form of Business"),
    stateIncorporated: textAfterLabel($, "State Incorporated"),
    businessEmail: textAfterLabel($, "Business Email"),
    officials: parseOfficialsTable($),
    operationTypes: parseBoldedOptions($, "COMPANY OPERATIONS"),
    cargoClasses,
    vehicles: parseVehiclesTable($),
    fetchedAt: new Date().toISOString(),
  };
}
