/**
 * Comunicano Sports Intelligence Engine
 * Netlify Background Function: analyze-background
 * Runs async — no timeout limit. Stores result in Netlify Blobs.
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

function httpGet(rawUrl, timeoutMs, hops) {
  hops = hops || 0;
  if (hops > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise(function(resolve, reject) {
    var parsed = url.parse(rawUrl);
    var lib = parsed.protocol === 'https:' ? https : http;
    var req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.path || '/',
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    }, function(res) {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location)
        return httpGet(res.headers.location, timeoutMs, hops + 1).then(resolve).catch(reject);
      var body = ''; res.setEncoding('utf8');
      res.on('data', function(c){ body += c; });
      res.on('end', function(){ resolve(body); });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, function(){ req.destroy(new Error('Timed out')); });
    req.end();
  });
}

function httpPost(rawUrl, headers, bodyStr) {
  return new Promise(function(resolve, reject) {
    var parsed = url.parse(rawUrl);
    var data = Buffer.from(bodyStr, 'utf8');
    var req = https.request({
      hostname: parsed.hostname, port: 443, path: parsed.path || '/',
      method: 'POST',
      headers: Object.assign({}, headers, { 'Content-Length': data.length }),
    }, function(res) {
      var body = ''; res.setEncoding('utf8');
      res.on('data', function(c){ body += c; });
      res.on('end', function(){ resolve({ status: res.statusCode, body: body }); });
    });
    req.on('error', reject);
    req.setTimeout(120000, function(){ req.destroy(new Error('Claude API timed out')); });
    req.write(data); req.end();
  });
}

async function fetchArticle(articleUrl) {
  try {
    var html = await httpGet(articleUrl, 12000, 0);
    var text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 1500);
    return { url: articleUrl, content: text, ok: true };
  } catch(err) {
    return { url: articleUrl, content: '[Fetch failed: ' + err.message + ']', ok: false };
  }
}

function buildPrompt(articles, today) {
  var CATEGORIES = ['Wearables & Performance Tech','Streaming & Distribution','Sponsorship & Rights','Ticketing & Fan Experience','AI & Content Tech','Investment & Funding','Venue & Infrastructure',"Women's Sports",'Media Rights'];
  var TAGS = ['Sports Broadcasting','Soccer / Football','Sports Media','College Sports (NCAA)','AI & Automation','Streaming & Distribution','Sponsorship & Rights','Sports Betting & Odds','Fan Engagement','Media & News','Athlete Performance','American Football (NFL)','Basketball','Motorsports','Live Events','Player Analytics',"Women's Sports",'Wearables & Health','AI & Content Tech','Multi-Sport','Scores & Stats'];
  var GOVERNING_BODIES = ['FIFA','USSF (U.S. Soccer)','UEFA','NFL','NBA','WNBA','NHL','MLB','MLS','NCAA','IOC','IIHF','FIBA','PGA Tour','LPGA','ATP','WTA','NASCAR','F1','UFC / MMA','ITF','World Rugby','ICC (Cricket)','NWSL','USL'];
  var SPONSORSHIP_CATS = ['Payments & Fintech','Banking & Financial Services','Insurance','Wearables & Health Tech','Streaming & Media','Ticketing','Apparel & Merchandise','Automotive','Beverage','Telecommunications','Betting & Gaming','Travel & Hospitality','Technology & Software','Crypto & Web3','Retail & Commerce','Stadium Naming Rights','Training Facility','Data & Analytics'];

  var articleDump = articles.map(function(a,i){ return '\n\n-- ARTICLE '+(i+1)+' --\nURL: '+a.url+'\n'+a.content; }).join('');
  var recordTemplate = articles.map(function(a,i){
    return '---RECORD '+(i+1)+'---\n'+
      'TITLE: [headline of article '+(i+1)+']\n'+
      'SUMMARY: [2-3 sentence factual summary]\n'+
      'INSIGHT: [what this signals for sports business/tech — the real signal]\n'+
      'OPINION: [Andy Abramson direct editorial take — Steve Jobs directness, Hal Riney warmth, Ayn Rand conviction — 1-2 sentences, first person]\n'+
      'PERSPECTIVE: [broader strategic context — who wins, who loses, what shift is underway]\n'+
      'PUBLICATION: [outlet name]\n'+
      'SOURCE_URL: '+a.url+'\n'+
      'DATE: [YYYY-MM-DD or '+today+' if unknown]\n'+
      'CATEGORY: [ONE from: '+CATEGORIES.join(', ')+']\n'+
      'TAGS: [2-4 comma-separated from: '+TAGS.join(', ')+']\n'+
      'GOVERNING_BODIES: [from: '+GOVERNING_BODIES.join(', ')+' — blank if none]\n'+
      'SPONSORSHIP_CATEGORY: [from: '+SPONSORSHIP_CATS.join(', ')+' — blank if none]\n'+
      'TEAMS: [teams, leagues, orgs directly named]\n'+
      'WATCH_LIST: [1-2 prose sentences. What to watch, who to watch, what decision or event will determine the outcome.]\n'+
      'STATUS: Source Captured\n'+
      '---END RECORD '+(i+1)+'---';
  }).join('\n');

  return 'You are Andy Abramson, founder of Comunicano — a marketing communications agency behind 63 startup exits generating $9.4 billion. You write the Sports Daily Intelligence Report.\n\n'+
    'YOUR VOICE: Steve Jobs directness (clear, no fluff, every word chosen), Hal Riney warmth (human, not clinical), Ayn Rand conviction (declarative, no hedging — if you believe it, say it). First person in Opinion sections. Senior audience — executives, investors, strategists.\n\n'+
    'THE ONION PROCESS: Intelligence moves in layers — raw fact → business signal → editorial conviction → strategic perspective. Each layer earns its place.\n\n'+
    'TODAY: '+today+'\n\nARTICLES:'+articleDump+'\n\n'+
    '===OUTPUT FORMAT — FOLLOW EXACTLY===\n\n'+
    'PART 1: SPORTS DAILY INTELLIGENCE REPORT\n\n'+
    '[Opening hook — 2-3 sentences connecting all stories. Make it memorable. Find the thread.]\n\n'+
    '[For EACH article, write a section:]\n\n'+
    '**[Your editorial headline — not the article title]**\n\n'+
    '[1-2 paragraphs: what happened, why it matters. Specific names, numbers, facts. No throat-clearing.]\n\n'+
    '**Insight:** [The real signal — what this means for sports business/tech. One paragraph.]\n\n'+
    '**Perspective:** [Who wins. Who loses. What structural shift is underway. One paragraph.]\n\n'+
    '**Opinion:** [Your direct take. First person. 1-2 sentences. No hedging.]\n\n'+
    '**Watch List:** [1-2 prose sentences. Name the companies, decisions, votes, or moments that will determine the outcome.]\n\n'+
    '[After all articles:]\n\n'+
    '**The Through Line**\n\n'+
    '[One paragraph connecting all stories. End with the question that drives Comunicano: does the infrastructure match the opportunity?]\n\n'+
    '*Sports Daily Intelligence Report is published by [Comunicano](https://comunicano.com). All rights reserved.*\n\n'+
    'IMPORTANT: Tags, Category, Governing Bodies, Sponsorship Category are schema metadata — appear ONLY in the NOTION RECORDS block below, never in the report.\n\n'+
    '===END PART 1===\n\n'+
    'PART 2: ONION PROCESS RECORDS\n'+
    '===NOTION RECORDS===\n'+recordTemplate+'\n===END RECORDS===';
}

function fieldVal(block, key) {
  var lines = block.split('\n'), val = '', collecting = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\*\*/g, '');  // strip markdown bold
    var km = line.match(new RegExp('^'+key+':\\s*(.*)','i'));
    if (km) { val = km[1].trim(); collecting = true; continue; }
    if (collecting) {
      var bare = line.replace(/\*\*/g,'');
      if (/^[A-Z_]+:/.test(bare) || /^---/.test(bare.trim())) break;
      var t = bare.trim(); if (t) val += ' ' + t;
    }
  }
  return val.trim();
}

function parseOutput(raw) {
  var idx = raw.indexOf('===NOTION RECORDS===');
  var report = idx !== -1 ? raw.slice(0, idx).trim() : raw.trim();
  report = report.replace(/===END PART 1===/g, '').trim();
  var blockRaw = idx !== -1 ? raw.slice(idx) : '';
  var records = [];
  var bm = blockRaw.match(/===NOTION RECORDS===([\s\S]*?)===END RECORDS===/);
  if (bm) {
    var pat = /---RECORD \d+---([\s\S]*?)---END RECORD \d+---/g, m;
    while ((m = pat.exec(bm[1])) !== null) {
      var blk = m[1];
      records.push({
        title: fieldVal(blk,'TITLE'), summary: fieldVal(blk,'SUMMARY'),
        insight: fieldVal(blk,'INSIGHT'), opinion: fieldVal(blk,'OPINION'),
        perspective: fieldVal(blk,'PERSPECTIVE'), publication: fieldVal(blk,'PUBLICATION'),
        sourceUrl: fieldVal(blk,'SOURCE_URL'), date: fieldVal(blk,'DATE'),
        category: fieldVal(blk,'CATEGORY'), tags: fieldVal(blk,'TAGS'),
        governingBodies: fieldVal(blk,'GOVERNING_BODIES'),
        sponsorshipCategory: fieldVal(blk,'SPONSORSHIP_CATEGORY'),
        teams: fieldVal(blk,'TEAMS'), watchList: fieldVal(blk,'WATCH_LIST'),
        status: fieldVal(blk,'STATUS') || 'Source Captured',
      });
    }
  }
  return { report: report, records: records };
}

exports.handler = async function(event) {
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  var jobId, urls;
  try {
    var parsed = JSON.parse(event.body);
    jobId = parsed.jobId;
    urls = parsed.urls;
  } catch(e) { return; }

  // Import Netlify Blobs
  var getStore;
  try { getStore = require('@netlify/blobs').getStore; } catch(e) { return; }
  var store = getStore({ name: 'sports-intel-jobs', siteID: 'e3ab7454-cd8b-4ab6-b0e5-3b2cebe768c4', token: process.env.NETLIFY_API_TOKEN });

  try {
    await store.setJSON(jobId, { status: 'pending', startedAt: Date.now() });

    var articles = await Promise.all(urls.map(fetchArticle));
    var today = new Date().toISOString().slice(0,10);
    var prompt = buildPrompt(articles, today);

    var res = await httpPost('https://api.anthropic.com/v1/messages',
      {'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
      JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 6000, messages: [{role:'user',content:prompt}] })
    );
    var data = JSON.parse(res.body);
    if (res.status !== 200) throw new Error('Claude '+res.status+': '+(data.error && data.error.message || res.body.slice(0,200)));

    var result = parseOutput(data.content[0].text);
    await store.setJSON(jobId, {
      status: 'complete',
      report: result.report,
      records: result.records,
      fetchResults: articles.map(function(a){ return {url:a.url,ok:a.ok,chars:a.content.length}; }),
    });
  } catch(err) {
    try { await store.setJSON(jobId, { status: 'error', error: err.message }); } catch(e) {}
  }
};
