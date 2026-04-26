/**
 * Comunicano Sports Intelligence Engine
 * Netlify Function: /api/analyze
 *
 * 1. Receives { urls: string[] } from the frontend
 * 2. Fetches each article server-side (no CORS issues)
 * 3. Calls Claude with the full Onion Process prompt
 * 4. Returns { report: string, records: OnionRecord[] }
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-6';
const MAX_TOKENS    = 4000;

// ---------------------------------------------------------------------------
// Article fetch — strip HTML, return first 2000 chars of visible text
// ---------------------------------------------------------------------------
async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    return { url, content: text, ok: true };
  } catch (err) {
    return { url, content: `[Fetch failed: ${err.message}]`, ok: false };
  }
}

// ---------------------------------------------------------------------------
// Full Onion Process prompt
// ---------------------------------------------------------------------------
function buildPrompt(articles, today) {
  const CATEGORIES = [
    'Wearables & Performance Tech', 'Streaming & Distribution',
    'Sponsorship & Rights', 'Ticketing & Fan Experience', 'AI & Content Tech',
    'Investment & Funding', 'Venue & Infrastructure', "Women's Sports", 'Media Rights',
  ];
  const TAGS = [
    'Sports Broadcasting', 'Soccer / Football', 'Sports Media', 'College Sports (NCAA)',
    'AI & Automation', 'Streaming & Distribution', 'Sponsorship & Rights',
    'Sports Betting & Odds', 'Fan Engagement', 'Media & News', 'Athlete Performance',
    'American Football (NFL)', 'Basketball', 'Motorsports', 'Live Events',
    'Player Analytics', "Women's Sports", 'Wearables & Health', 'AI & Content Tech',
    'Multi-Sport', 'Scores & Stats',
  ];
  const GOVERNING_BODIES = [
    'FIFA', 'USSF (U.S. Soccer)', 'UEFA', 'NFL', 'NBA', 'WNBA', 'NHL', 'MLB',
    'MLS', 'NCAA', 'IOC', 'IIHF', 'FIBA', 'PGA Tour', 'LPGA', 'ATP', 'WTA',
    'NASCAR', 'F1', 'UFC / MMA', 'ITF', 'World Rugby', 'ICC (Cricket)', 'NWSL', 'USL',
  ];
  const SPONSORSHIP_CATS = [
    'Payments & Fintech', 'Banking & Financial Services', 'Insurance',
    'Wearables & Health Tech', 'Streaming & Media', 'Ticketing',
    'Apparel & Merchandise', 'Automotive', 'Beverage', 'Telecommunications',
    'Betting & Gaming', 'Travel & Hospitality', 'Technology & Software',
    'Crypto & Web3', 'Retail & Commerce', 'Stadium Naming Rights',
    'Training Facility', 'Data & Analytics',
  ];

  const articleDump = articles
    .map((a, i) => `\n\n-- ARTICLE ${i + 1} --\nURL: ${a.url}\n${a.content}`)
    .join('');

  const recordTemplate = articles
    .map(
      (a, i) => `---RECORD ${i + 1}---
TITLE: [headline of article ${i + 1}]
SUMMARY: [2-3 sentence factual summary — just what happened]
INSIGHT: [what this signals for the sports business/tech ecosystem — the real signal, not the noise]
OPINION: [Andy Abramson's direct editorial take — Steve Jobs directness, Hal Riney warmth, Ayn Rand conviction — one to two sentences, first person]
PERSPECTIVE: [broader strategic context — who wins, who loses, what structural shift is underway]
PUBLICATION: [outlet name, e.g. Front Office Sports, Sportico, The Athletic]
SOURCE_URL: ${a.url}
DATE: [YYYY-MM-DD publication date, or ${today} if unknown]
CATEGORY: [exactly ONE from: ${CATEGORIES.join(', ')}]
TAGS: [2 to 4 comma-separated values from: ${TAGS.join(', ')}]
GOVERNING_BODIES: [comma-separated from: ${GOVERNING_BODIES.join(', ')} — leave blank if none apply]
SPONSORSHIP_CATEGORY: [comma-separated from: ${SPONSORSHIP_CATS.join(', ')} — leave blank if none apply]
TEAMS: [specific teams, leagues, or organizations directly named in the article]
WATCH_LIST: [companies, technologies, or trends worth monitoring that emerge from this story]
STATUS: Source Captured
---END RECORD ${i + 1}---`
    )
    .join('\n');

  return `You are Comunicano's Sports Intelligence Engine, built on the Onion Process framework.

WHAT IS THE ONION PROCESS:
Intelligence moves outward in layers — from raw fact to business signal to editorial conviction to strategic perspective. Each layer adds meaning. Each layer earns its place.

VOICE: Write like Steve Jobs speaks — clear, direct, no fluff. Every word chosen. Add Hal Riney warmth — make it human, not clinical. Channel Ayn Rand conviction — declarative, no hedging, no "it seems like." If you believe it, say it.

TODAY: ${today}

ARTICLES:${articleDump}

OUTPUT INSTRUCTIONS:

PART 1 — SPORTS DAILY INTELLIGENCE REPORT
Write 3-5 paragraphs. Lead with the single biggest insight across all articles. Connect the stories where relevant — find the through-line. Surface the business angle, the cultural shift, the market signal that most journalists missed. Be editorial, not a recap. No bullet points. No headers within the report. Write for an educated, senior audience — executives, investors, and strategists who read fast and think faster.

PART 2 — ONION PROCESS RECORDS
After the report, output this exact block with every bracketed field filled in accurately from the actual article content:

===NOTION RECORDS===
${recordTemplate}
===END RECORDS===`;
}

// ---------------------------------------------------------------------------
// Parse Claude output into report + records
// ---------------------------------------------------------------------------
function parseOutput(raw) {
  const MARKER = '===NOTION RECORDS===';
  const END    = '===END RECORDS===';
  const idx    = raw.indexOf(MARKER);

  const report   = idx !== -1 ? raw.slice(0, idx).trim() : raw.trim();
  const blockRaw = idx !== -1 ? raw.slice(idx) : '';

  const records = [];
  const blockMatch = blockRaw.match(/===NOTION RECORDS===([\s\S]*?)===END RECORDS===/);
  if (blockMatch) {
    const body = blockMatch[1];
    const pat  = /---RECORD \d+---([\s\S]*?)---END RECORD \d+---/g;
    let m;
    while ((m = pat.exec(body)) !== null) {
      const blk = m[1];
      records.push({
        title:              field(blk, 'TITLE'),
        summary:            field(blk, 'SUMMARY'),
        insight:            field(blk, 'INSIGHT'),
        opinion:            field(blk, 'OPINION'),
        perspective:        field(blk, 'PERSPECTIVE'),
        publication:        field(blk, 'PUBLICATION'),
        sourceUrl:          field(blk, 'SOURCE_URL'),
        date:               field(blk, 'DATE'),
        category:           field(blk, 'CATEGORY'),
        tags:               field(blk, 'TAGS'),
        governingBodies:    field(blk, 'GOVERNING_BODIES'),
        sponsorshipCategory:field(blk, 'SPONSORSHIP_CATEGORY'),
        teams:              field(blk, 'TEAMS'),
        watchList:          field(blk, 'WATCH_LIST'),
        status:             field(blk, 'STATUS') || 'Source Captured',
      });
    }
  }
  return { report, records };
}

function field(block, key) {
  const lines = block.split('\n');
  let val = '', collecting = false;
  for (const line of lines) {
    const km = line.match(new RegExp(`^${key}:\\s*(.+)`, 'i'));
    if (km) { val = km[1].trim(); collecting = true; continue; }
    if (collecting) {
      if (/^[A-Z_]+:/.test(line) || /^---/.test(line.trim())) break;
      const t = line.trim();
      if (t) val += ' ' + t;
    }
  }
  return val.trim();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in environment' }) };
  }

  let urls;
  try {
    ({ urls } = JSON.parse(event.body));
    if (!Array.isArray(urls) || urls.length === 0) throw new Error('urls required');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }

  // 1. Fetch articles
  const articles = await Promise.all(urls.map(fetchArticle));

  // 2. Build prompt & call Claude
  const today  = new Date().toISOString().slice(0, 10);
  const prompt = buildPrompt(articles, today);

  let claudeText;
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${JSON.stringify(data)}`);
    claudeText = data.content[0].text;
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }

  // 3. Parse & return
  const { report, records } = parseOutput(claudeText);
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      report,
      records,
      fetchResults: articles.map(a => ({ url: a.url, ok: a.ok, chars: a.content.length })),
    }),
  };
};
