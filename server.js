'use strict';
// Dedicated demo bridge. Deploy as a separate service: legacy bots are untouched.
const http = require('node:http');
const crypto = require('node:crypto');
const STRATEGY = 'DG_GOLD_V2';
const MAX_AGE = 90_000;
function equal(a,b) {
  return typeof a === 'string' && typeof b === 'string' && b.length >= 20 &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
function validate(s, now=Date.now()) {
  if (!s || s.strategy !== STRATEGY || s.symbol !== 'XAUUSD' || s.timeframe !== '5' || !['BUY','SELL'].includes(s.action)) return false;
  if (typeof s.signalId !== 'string' || s.signalId !== `${s.action}-${s.barClose}`) return false;
  if (!Number.isSafeInteger(s.barClose) || s.barClose % 300000 !== 0 || now-s.barClose > MAX_AGE || s.barClose-now > 10000) return false;
  if (![s.referencePrice,s.stopPrice,s.targetPrice].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0)) return false;
  return s.action === 'BUY' ? s.stopPrice < s.referencePrice && s.targetPrice > s.referencePrice : s.stopPrice > s.referencePrice && s.targetPrice < s.referencePrice;
}
function makeServer(env=process.env) {
  const tvToken=env.TV_WEBHOOK_TOKEN, botToken=env.BOT_READ_TOKEN;
  let latest=null;
  const seen=new Map();
  return http.createServer(async(req,res)=> {
    const path=new URL(req.url,'http://localhost').pathname;
    const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    const ready=typeof tvToken==='string' && tvToken.length>=20 && typeof botToken==='string' && botToken.length>=20 && tvToken!==botToken;
    if (req.method==='GET' && path==='/health') return send(ready?200:503,{service:STRATEGY,version:'demo-v1',ready});
    if (!ready) return send(503,{error:'Configure distinct tokens, at least 20 characters each'});
    if (req.method==='GET' && path==='/dg-v2/signal') {
      if(!equal(req.headers['x-bot-token'],botToken)) return send(401,{error:'Unauthorized'});
      return send(200,{strategy:STRATEGY,signal:latest && Date.now()-latest.barClose<=MAX_AGE?latest:null});
    }
    if(req.method!=='POST' || path!=='/dg-v2/webhook') return send(404,{error:'Not found'});
    let bytes=0, chunks=[];
    try {
      for await(const chunk of req) {
        bytes+=chunk.length;
        if(bytes>8192) {send(413,{error:'Too large'});req.destroy();return;}
        chunks.push(chunk);
      }
      let body;
      try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return send(400,{error:'Invalid JSON'});}
      if(!equal(body.token,tvToken)) return send(401,{error:'Unauthorized'});
      const s=body.signal;
      if(!validate(s)) return send(422,{error:'Invalid or stale DG V2 signal'});
      for(const [id,t] of seen) if(Date.now()-t>3600000) seen.delete(id);
      if(seen.has(s.signalId)) return send(200,{ok:true,duplicate:true});
      if(latest && s.barClose<=latest.barClose) return send(409,{error:'Out-of-order signal'});
      // Copy only validated fields; credentials never enter the signal cache or logs.
      latest={id:s.signalId,strategy:STRATEGY,symbol:s.symbol,timeframe:s.timeframe,action:s.action,barClose:s.barClose,referencePrice:s.referencePrice,stopPrice:s.stopPrice,targetPrice:s.targetPrice,receivedAt:Date.now()};
      seen.set(s.signalId,Date.now());
      console.log('Accepted DG V2 entry',s.action,s.signalId);
      return send(200,{ok:true,id:s.signalId});
    } catch {if(!res.headersSent) send(400,{error:'Request failed'});}
  });
}
module.exports={makeServer,validate};
if(require.main===module) makeServer().listen(process.env.PORT||3000,()=>console.log('DG V2 demo receiver started'));
