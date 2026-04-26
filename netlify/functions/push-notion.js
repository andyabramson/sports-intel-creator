/**
 * Comunicano Sports Intelligence Engine
 * Netlify Function: /api/push-notion
 * CommonJS — works on all Node versions Netlify supports
 */

const https = require('https');
const url   = require('url');

function notionPost(endpoint, notionKey, bodyObj) {
  return new Promise(function(resolve, reject) {
    var bodyStr = JSON.stringify(bodyObj);
    var data    = Buffer.from(bodyStr, 'utf8');
    var opts    = {
      hostname: 'api.notion.com',
      port: 443,
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization':    'Bearer ' + notionKey,
        'Notion-Version':   '2022-06-28',
        'Content-Type':     'application/json',
        'Content-Length':   data.length,
      },
    };
    var req = https.request(opts, function(res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(c){ body += c; });
      res.on('end', function(){ resolve({ status: res.statusCode, body: body }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function(){ req.destroy(new Error('Notion API timed out')); });
    req.write(data);
    req.end();
  });
}

function multiSelect(csvStr) {
  if (!csvStr || !csvStr.trim()) return null;
  var items = csvStr.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  return items.length ? items.map(function(name){ return { name: name }; }) : null;
}
function richText(str) { return [{ text: { content: (str||'').slice(0,2000) } }]; }
function titleProp(str) { return [{ text: { content: (str||'Untitled').slice(0,500) } }]; }

async function createNotionPage(record, dbId, notionKey) {
  var properties = {
    'Article Title': { title: titleProp(record.title) },
    'Summary':       { rich_text: richText(record.summary) },
    'Insight':       { rich_text: richText(record.insight) },
    'Opinion':       { rich_text: richText(record.opinion) },
    'Perspective':   { rich_text: richText(record.perspective) },
    'Publication':   { rich_text: richText(record.publication) },
    'Teams':         { rich_text: richText(record.teams) },
    'Watch List':    { rich_text: richText(record.watchList) },
    'Status':        { select: { name: record.status || 'Source Captured' } },
  };

  var src = (record.sourceUrl || '').trim();
  if (src && src.startsWith('http')) properties['Source URL'] = { url: src.slice(0,2000) };

  var dv = (record.date || '').trim().slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dv)) properties['Date Published'] = { date: { start: dv } };

  var cat = multiSelect(record.category);
  if (cat) properties['Category'] = { multi_select: cat };

  var tags = multiSelect(record.tags);
  if (tags) properties['Tags'] = { multi_select: tags };

  var gov = multiSelect(record.governingBodies);
  if (gov) properties['Governing Bodies'] = { multi_select: gov };

  var spon = multiSelect(record.sponsorshipCategory);
  if (spon) properties['Sponsorship Category'] = { multi_select: spon };

  var res = await notionPost('/v1/pages', notionKey, { parent: { database_id: dbId }, properties: properties });
  var data = JSON.parse(res.body);
  if (res.status < 200 || res.status >= 300) throw new Error('Notion ' + res.status + ': ' + (data.message || res.body.slice(0,200)));
  return { url: data.url, id: data.id };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  var NOTION_KEY = process.env.NOTION_API_KEY;
  var DB_ID      = process.env.NOTION_DATABASE_ID || '46f74fed-bf7b-46e6-a7ad-250823e76b06';
  if (!NOTION_KEY) return { statusCode: 500, headers: {'content-type':'application/json'}, body: JSON.stringify({error:'NOTION_API_KEY not set'}) };

  var records;
  try {
    var parsed = JSON.parse(event.body); records = parsed.records;
    if (!Array.isArray(records) || !records.length) throw new Error('records required');
  } catch(err) {
    return { statusCode: 400, headers: {'content-type':'application/json'}, body: JSON.stringify({error: err.message}) };
  }

  var results = [];
  for (var i = 0; i < records.length; i++) {
    try {
      var page = await createNotionPage(records[i], DB_ID, NOTION_KEY);
      results.push({ title: records[i].title, ok: true, url: page.url });
    } catch(err) {
      results.push({ title: records[i].title, ok: false, error: err.message });
    }
  }

  return {
    statusCode: 200,
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ results: results, successCount: results.filter(function(r){ return r.ok; }).length, total: results.length }),
  };
};
