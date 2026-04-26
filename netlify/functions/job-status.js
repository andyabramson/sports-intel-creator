/**
 * Comunicano Sports Intelligence Engine
 * Netlify Function: job-status
 * Polls Netlify Blobs for background job result.
 */
exports.handler = async function(event) {
  var jobId = (event.queryStringParameters || {}).id;
  if (!jobId) return { statusCode: 400, headers: {'content-type':'application/json'}, body: JSON.stringify({error:'id required'}) };

  var getStore;
  try { getStore = require('@netlify/blobs').getStore; } catch(e) {
    return { statusCode: 500, headers: {'content-type':'application/json'}, body: JSON.stringify({error:'Blobs not available: ' + e.message}) };
  }

  try {
    var store = getStore({ name: 'sports-intel-jobs', siteID: 'e3ab7454-cd8b-4ab6-b0e5-3b2cebe768c4', token: process.env.NETLIFY_API_TOKEN });
    var result = await store.get(jobId, { type: 'json' });
    if (!result) return { statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify({status:'pending'}) };
    return { statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify(result) };
  } catch(err) {
    return { statusCode: 500, headers: {'content-type':'application/json'}, body: JSON.stringify({error: err.message}) };
  }
};
