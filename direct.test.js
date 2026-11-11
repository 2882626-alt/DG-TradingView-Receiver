const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeServer}=require('./server');
test('direct BUY/SELL route is isolated from legacy ATR consumer',async()=>{
 const token='testing-webhook-abcdefghijklmnop', bot='testing-reader-abcdefghijklmnop';
 const server=makeServer({TV_WEBHOOK_TOKEN:token,BOT_READ_TOKEN:bot});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const real=Date.now, bar=Math.floor(real()/300000)*300000;
 Date.now=()=>bar+5000;
 const read=async(strategy)=> (await fetch(base+'/dg-v2/signal'+(strategy?'?strategy='+strategy:''),{headers:{'x-bot-token':bot}})).json();
 const post=async(s,t=token)=>fetch(base+'/dg-v2/webhook',{method:'POST',body:JSON.stringify({token:t,signal:s})});
 const direct={strategy:'DG_GOLD_V2_DIRECT',symbol:'XAUUSD',timeframe:'5',action:'BUY',signalId:'BUY-'+bar,barClose:bar};
 try {
  assert.equal((await post(direct,'bad')).status,401);
  assert.equal((await post(direct)).status,200);
  assert.equal((await read()).signal,null);
  assert.equal((await read(direct.strategy)).signal.action,'BUY');
  assert.equal((await (await post(direct)).json()).duplicate,true);
  const legacy={...direct,strategy:'DG_GOLD_V2',referencePrice:4000,stopPrice:3990,targetPrice:4015};
  assert.equal((await post(legacy)).status,200);
  assert.equal((await read()).signal.strategy,'DG_GOLD_V2');
  assert.equal((await read(direct.strategy)).signal.strategy,direct.strategy);
  Date.now=()=>bar+305000;
  const sell={...direct,action:'SELL',barClose:bar+300000,signalId:'SELL-'+(bar+300000)};
  assert.equal((await post(sell)).status,200);
  assert.equal((await read(direct.strategy)).signal.action,'SELL');
  assert.equal((await post({...sell,action:'CLOSE'})).status,422);
  assert.equal((await post(direct)).status,422);
 } finally {Date.now=real;await new Promise(r=>server.close(r));}
});
