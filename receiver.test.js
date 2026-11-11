const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeServer}=require('./server');
test('auth, BUY/SELL, risk data, duplicate, stale and isolation',async()=>{
 const tv='test-tv-abcdefghijklmnopqrst',bot='test-bot-abcdefghijklmnopqr';
 const server=makeServer({TV_WEBHOOK_TOKEN:tv,BOT_READ_TOKEN:bot});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const realNow=Date.now, now=Math.floor(realNow()/300000)*300000+5000;
 Date.now=()=>now;
 const s={strategy:'DG_GOLD_V2',symbol:'XAUUSD',timeframe:'5',action:'BUY',barClose:now-5000,referencePrice:4000,stopPrice:3990,targetPrice:4015};
 s.signalId=`BUY-${s.barClose}`;
 const post=(signal,token=tv,path='/dg-v2/webhook')=>fetch(base+path,{method:'POST',body:JSON.stringify({token,signal})});
 try {
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/dg-v2/signal')).status,401);
  assert.equal((await post(s,'wrong')).status,401);
  assert.equal((await post({...s,timeframe:'2'})).status,422);
  assert.equal((await post({...s,stopPrice:4010})).status,422);
  assert.equal((await post({...s,barClose:s.barClose-300000,signalId:`BUY-${s.barClose-300000}`})).status,422);
  assert.equal((await post(s,tv,'/webhook')).status,404);
  assert.equal((await post(s)).status,200);
  assert.equal((await (await post(s)).json()).duplicate,true);
  const cached=await (await fetch(base+'/dg-v2/signal',{headers:{'x-bot-token':bot}})).json();
  assert.equal(cached.signal.stopPrice,3990); assert.equal(cached.signal.targetPrice,4015);
  assert.equal('token' in cached.signal,false);
  Date.now=()=>now+300000;
  const sell={...s,action:'SELL',barClose:s.barClose+300000,signalId:`SELL-${s.barClose+300000}`,stopPrice:4010,targetPrice:3985};
  assert.equal((await post(sell)).status,200);
  assert.equal((await (await fetch(base+'/dg-v2/signal',{headers:{'x-bot-token':bot}})).json()).signal.action,'SELL');
  Date.now=()=>now+500000;
  assert.equal((await (await fetch(base+'/dg-v2/signal',{headers:{'x-bot-token':bot}})).json()).signal,null);
 } finally {Date.now=realNow; await new Promise(r=>server.close(r));}
});
