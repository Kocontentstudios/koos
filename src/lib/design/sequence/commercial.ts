/**
 * Commercial terms a set must never offer on the brand's behalf: how and
 * when the customer pays, what it commits them to, what the service
 * covers, who is behind it and how proven it is. A customer acts on each
 * of these, and once posted the business is held to it. The directions
 * ledger (claims.ts inventedFacts) reads numbers, days and a fixed set of
 * claim words; round 5 shipped "Pay when you collect.", "Sign up your
 * whole office weekly", "No hidden charges.", "at no obligation" and "A
 * local team handles setup" with nothing reported.
 *
 * Each term stands only when the brief or the brand profile licenses it
 * (`licence`, tested against the ledger's text). Kept here, not in the
 * shared ledger, so a single design's verifier reads exactly what it did.
 */

interface CommercialTerm {
  pattern: RegExp;
  licence: RegExp;
}

const TERMS: readonly CommercialTerm[] = [
  {
    pattern:
      /\bpay(?:ment)?s?\s+(?:when|on|after|at|upon)\s+(?:you\s+)?(?:collect\w*|pick\w*|deliver\w*|receiv\w*|arriv\w*|completion|the\s+end)\b|\bpay\s+later\b|\bcash\s+on\s+deliver\w*\b|\bpay\s+as\s+you\s+(?:go|use)\b/i,
    licence:
      /\bpay(?:ment)?s?\s+(?:when|on|after|at|upon|later|as\s+you)\b|\bcash\s+on\b|\bpay\s+per\b|\bper\s+(?:use|day|crate|session)\b/i,
  },
  {
    pattern: /\binstal(?:l)?ments?\b|\bspread\s+the\s+cost\b|\bpart[- ]pay/i,
    licence: /\binstal(?:l)?ment|\bspread\b|\bpart[- ]pay/i,
  },
  {
    pattern: /\bno\s+(?:upfront|deposit|down\s*payment)\b|\bzero\s+deposit\b/i,
    licence: /\bupfront\b|\bdeposit\b|\bdown\s*payment\b/i,
  },
  {
    pattern:
      /\bno\s+(?:hidden|extra|surprise|additional)\s+(?:fees?|charges?|costs?)\b|\bno\s+surprises\b|\bnothing\s+hidden\b/i,
    licence: /\bhidden\b|\bno\s+(?:extra|additional|surprise)/i,
  },
  {
    pattern:
      /\b(?:at\s+)?no\s+(?:obligation|commitment|strings)\b|\bobligation[- ]free\b|\bcancel\s+any\s?time\b|\bno\s+(?:contract|lock[- ]?in)s?\b/i,
    licence:
      /\bobligation|\bcommitment|\bstrings\b|\bcancel\b|\bcontract|\block[- ]?in\b/i,
  },
  {
    pattern:
      /\b(?:one[- ]time|fixed|flat)\s+(?:cost|fee|price|rate|charge|payment)\b/i,
    licence:
      /\bone[- ]time\b|\bfixed\s+(?:cost|fee|price|rate)|\bflat\s+(?:fee|rate|price)/i,
  },
  {
    pattern:
      /\bsubscri(?:be|ption)s?\b|\bmembership\b|\b(?:weekly|monthly|yearly|annual)\s+(?:plan|package|subscription|wash|service|booking|visit)s?\b|\bsign\s+up\s+(?:your\s+)?(?:whole\s+|entire\s+)?(?:office|team|company|staff)\b/i,
    licence:
      /\bsubscri|\bmember|\bweekly\b|\bmonthly\b|\byearly\b|\bannual\b|\bplan\b|\bpackage\b/i,
  },
  {
    pattern:
      /\b(?:whole|entire)\s+(?:office|team|company|staff|fleet)\b|\bbulk\s+(?:orders?|bookings?|rates?)\b|\bcorporate\s+(?:rates?|accounts?|plans?)\b|\bfleet\b/i,
    licence:
      /\boffice\b|\bteams?\b|\bcompan(?:y|ies)\b|\bstaff\b|\bfleet\b|\bbulk\b|\bcorporate\b/i,
  },
  {
    pattern:
      /\bfree\s+(?:[a-z]+\s+)?(?:quote|consultation|assessment|survey|trial|estimate|inspection|check)\b|\bat\s+no\s+(?:cost|charge)\b|\bno\s+charge\b/i,
    licence: /\bfree\b|\bno\s+(?:cost|charge)\b|\bcomplimentary\b/i,
  },
  {
    pattern:
      /\b(?:handles?|takes?\s+care\s+of|looks?\s+after)\s+(?:the\s+|all\s+(?:the\s+)?)?(?:setup|set[- ]up|installation|install|maintenance|servicing|repairs?|paperwork|everything)\b|\bongoing\s+(?:service|support|maintenance)\b|\bafter[- ]sales\b|\binstallation\s+included\b|\bwe\s+(?:install|maintain|service)\b/i,
    licence:
      /\bsetup\b|\bset[- ]up\b|\binstall|\bmaintenance\b|\bmaintain|\bservic|\bsupport\b|\bafter[- ]sales\b|\bpaperwork\b/i,
  },
  {
    pattern:
      /\b24\/7\b|\baround\s+the\s+clock\b|\bany\s?time,?\s+day\s+or\s+night\b/i,
    licence:
      /\b24\/7\b|\baround\s+the\s+clock\b|\bday\s+or\s+night\b|\b24\s*hours?\b/i,
  },
  {
    pattern:
      /\blocal\s+(?:team|crew|staff|experts?|technicians?|engineers?)\b|\bour\s+(?:own\s+)?(?:engineers?|technicians?|experts?)\b/i,
    licence:
      /\bteam\b|\bcrew\b|\bstaff\b|\bexperts?\b|\btechnicians?\b|\bengineers?\b/i,
  },
  {
    pattern:
      /\bproven\b|\btrusted\s+by\b|\bat\s+scale\b|\btrack\s+record\b|\bhappy\s+(?:customers|clients)\b|\bloved\s+by\b|\bsatisfied\s+(?:customers|clients)\b|\btried\s+and\s+tested\b/i,
    licence:
      /\bproven\b|\btrusted\b|\bscale\b|\btrack\s+record\b|\bhappy\s+(?:customers|clients)\b|\bloved\b|\bsatisfied\b|\btested\b/i,
  },
  {
    pattern:
      /\b(?:fully\s+)?insured\b|\blicen[cs]ed\b|\bvetted\b|\bbackground[- ]checked\b|\baccredited\b|\bqualified\b/i,
    licence:
      /\binsur|\blicen[cs]|\bvetted\b|\bbackground\b|\baccredit|\bqualif/i,
  },
  {
    pattern:
      /\b(?:same|next)[- ]day\b|\bwithin\s+(?:the\s+)?(?:hour|day|week)\b|\bin\s+minutes\b/i,
    licence: /\b(?:same|next)[- ]day\b|\bwithin\b|\bminutes?\b|\bhours?\b/i,
  },
];

/** The commercial terms `text` offers that `ledgerText` (the brief and
 *  the brand profile, lowercased or not) never gives, in the copy's words. */
export function commercialClaims(text: string, ledgerText: string): string[] {
  const found: string[] = [];
  for (const term of TERMS) {
    const match = term.pattern.exec(text);
    if (match && !term.licence.test(ledgerText)) found.push(match[0].trim());
  }
  return found;
}
