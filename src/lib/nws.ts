export interface AreaForecastDiscussion {
  officeId: string;
  officeName: string;
  issuedAt: string;
  synopsis: string | null;
  shortTerm: string | null;
  longTerm: string | null;
  discussion: string | null;
  forecaster?: string;
}

interface NwsPointResponse {
  properties: {
    cwa?: string;
  };
}

interface NwsOfficeResponse {
  id: string;
  name: string;
}

interface NwsProductListResponse {
  "@graph"?: Array<{
    id: string;
    issuanceTime: string;
  }>;
}

interface NwsProductResponse {
  issuanceTime: string;
  productText: string;
}

interface ParsedSection {
  key: string;
  text: string;
}

const SECTION_NAMES: Record<string, string> = {
  SYNOPSIS: "Synopsis",
  "SHORT TERM": "Short Term",
  "LONG TERM": "Long Term",
  DISCUSSION: "Discussion",
};

function normalizeDiscussionText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function parseSections(text: string): { sections: ParsedSection[]; forecaster: string } {
  const lines = text.split("\n");
  const sections: ParsedSection[] = [];
  let currentKey: string | null = null;
  let currentLines: string[] = [];
  let forecaster = "";

  for (const line of lines) {
    const headerMatch = line.match(/^\.[A-Z]{3}\s+([A-Z\s\/]+?)(?:\s*\([^)]*\))?\s*\.{2,3}/)
      || line.match(/^\.([A-Z\s\/]+?)(?:\s*\([^)]*\))?\s*\.{2,3}/);

    if (headerMatch) {
      if (currentKey) {
        sections.push({ key: currentKey, text: currentLines.join("\n").trim() });
      }
      const rawKey = headerMatch[1].trim();
      currentKey = SECTION_NAMES[rawKey] || `${rawKey.charAt(0)}${rawKey.slice(1).toLowerCase()}`;
      currentLines = [line.replace(headerMatch[0], "").trim()];
      continue;
    }

    if (line.trim() === "$$") {
      if (currentKey) {
        sections.push({ key: currentKey, text: currentLines.join("\n").trim() });
        currentKey = null;
        currentLines = [];
      }
      continue;
    }

    if (/^&&$/.test(line.trim())) continue;

    if (currentKey) {
      currentLines.push(line);
    }

    const forecasterMatch = line.match(/^\.?(?:Forecaster|FORECASTER)[:\s]+(.+)/i);
    if (forecasterMatch) forecaster = forecasterMatch[1].trim();
  }

  if (currentKey) {
    sections.push({ key: currentKey, text: currentLines.join("\n").trim() });
  }

  for (const section of sections) {
    section.text = section.text.replace(/&&\s*$/, "").replace(/^\s*&&\s*/gm, "").trim();

    const embeddedForecaster = section.text.match(/\n\s*(?:Forecaster|FORECASTER)[:\s]*(.+)$/im);
    if (embeddedForecaster) {
      if (!forecaster) forecaster = embeddedForecaster[1].trim();
      section.text = section.text.replace(embeddedForecaster[0], "").trim();
    }

    const bareNameMatch = section.text.match(/\n\s*\n\s*([A-Za-z][A-Za-z .'-]{0,25})\s*$/);
    if (bareNameMatch) {
      const candidate = bareNameMatch[1].trim();
      const words = candidate.split(/\s+/);
      if (words.length <= 3 && !/\d/.test(candidate) && candidate.length <= 20) {
        if (!forecaster) forecaster = candidate;
        section.text = section.text.replace(bareNameMatch[0], "").trim();
      }
    }

    section.text = normalizeDiscussionText(section.text);
  }

  return { sections, forecaster };
}

export async function fetchAreaForecastDiscussion(latitude: number, longitude: number): Promise<AreaForecastDiscussion> {
  const pointResponse = await fetch(`https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  if (!pointResponse.ok) throw new Error("Could not locate nearest NWS office");
  const pointData = await pointResponse.json() as NwsPointResponse;

  const officeId = pointData.properties.cwa;
  if (!officeId) throw new Error("No NWS office found for this location");

  const [officeResponse, productListResponse] = await Promise.all([
    fetch(`https://api.weather.gov/offices/${officeId}`),
    fetch(`https://api.weather.gov/products?location=${officeId}&type=AFD&limit=1`),
  ]);

  if (!officeResponse.ok) throw new Error("Could not load NWS office details");
  if (!productListResponse.ok) throw new Error("Could not load Area Forecast Discussion list");

  const officeData = await officeResponse.json() as NwsOfficeResponse;
  const productListData = await productListResponse.json() as NwsProductListResponse;
  const latestProduct = productListData["@graph"]?.[0];

  if (!latestProduct?.id) throw new Error("No recent Area Forecast Discussion available");

  const productResponse = await fetch(`https://api.weather.gov/products/${latestProduct.id}`);
  if (!productResponse.ok) throw new Error("Could not load Area Forecast Discussion");

  const productData = await productResponse.json() as NwsProductResponse;
  const parsed = parseSections(productData.productText);
  const getSection = (name: string) => parsed.sections.find((section) => section.key.toLowerCase() === name.toLowerCase())?.text ?? null;

  return {
    officeId,
    officeName: officeData.name,
    issuedAt: productData.issuanceTime,
    synopsis: getSection("Synopsis"),
    shortTerm: getSection("Short Term"),
    longTerm: getSection("Long Term"),
    discussion: getSection("Discussion"),
    forecaster: parsed.forecaster || undefined,
  };
}
