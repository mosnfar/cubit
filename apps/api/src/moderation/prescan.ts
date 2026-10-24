// Deterministic scan run before the model. Its findings go to the model as
// hints, and they back a safety net: personal information is never shown,
// whatever the model says.

export interface Detected {
  urls: string[];
  wallets: string[];
  emails: string[];
  phones: string[];
  addresses: string[];
}

const URL = /\bhttps?:\/\/[^\s]+|\b(?:bit\.ly|t\.me|discord\.gg|tinyurl\.com)\/[^\s]+/gi;
const WALLET = /\b0x[a-fA-F0-9]{40}\b|\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{3,4}\b/g;
const ADDRESS =
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Way|Court|Ct|Place|Pl|Boulevard|Blvd)\b\.?(?:,?\s+[A-Z]{1,2}\d{1,2}[A-Z]?(?:\s?\d[A-Z]{2})?)?/g;

const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()))].filter(Boolean);

export function prescan(text: string): Detected {
  const phones = (text.match(PHONE) ?? []).filter((p) => p.replace(/\D/g, '').length >= 9);
  return {
    urls: unique(text.match(URL) ?? []),
    wallets: unique(text.match(WALLET) ?? []),
    emails: unique(text.match(EMAIL) ?? []),
    phones: unique(phones),
    addresses: unique(text.match(ADDRESS) ?? []),
  };
}

export function personalInfo(d: Detected): string[] {
  return [...d.emails, ...d.phones, ...d.addresses];
}

export function mask(text: string, spans: string[]): string {
  let out = text;
  for (const span of [...spans].sort((a, b) => b.length - a.length)) {
    if (!span) continue;
    out = out.split(span).join('█'.repeat(Math.min(span.length, 14)));
  }
  return out;
}
