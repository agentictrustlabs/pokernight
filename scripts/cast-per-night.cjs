// EACH NIGHT ITS OWN CAST: Greeley's people in Greeley, the marches' in the marches.
const { chromium } = require('/home/barb/node_modules/playwright');
const SITE='https://gamenight.faithnet.io', API='https://games.faithnet.io';
let pass=0; const bad=[];
const check=(w,ok,got)=>{ if(ok){pass++;console.log(`  ✓ ${w}`);} else {bad.push(w);console.log(`  ✗ ${w} — got ${JSON.stringify(got).slice(0,200)}`);} };
(async()=>{
  const b=await chromium.launch({headless:true}); const page=await b.newPage();
  try{
    await page.goto(`${SITE}/#/signin`,{waitUntil:'networkidle'});
    await page.locator('.signin-demo summary').click(); await page.waitForSelector('.persona',{timeout:60000});
    const n=await page.locator('.persona-name').allInnerTexts();
    await page.locator('.persona').nth(Math.max(0,n.findIndex(x=>/alice/i.test(x)))).click();
    await page.waitForSelector('.room',{timeout:90000});
    for (const [scenario, expect] of [['thursday-in-greeley','naw-elena.me'],['first-light','ilse-elena.me']]) {
      const r = await page.evaluate(async ({api,scenario})=>{
        const tok=(()=>{for(const k of Object.keys(localStorage)){try{const v=JSON.parse(localStorage.getItem(k));if(v&&v.token)return v.token;}catch{}}return null;})();
        const o=await(await fetch(`${api}/commissions/solo`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${tok}`},body:JSON.stringify({scenario,role:'researcher',restart:true,pace:'short'})})).json();
        const v=await(await fetch(`${api}/commissions/${o.staging.stagingId}`,{headers:{authorization:`Bearer ${tok}`}})).json();
        return { scenario:o.staging.scenario, cast:(v.view?.cast??[]).map(c=>`${c.role}=${c.agent}`) };
      },{api:API,scenario});
      const returnee=(r.cast.find(c=>c.startsWith('returnee='))??'').split('=')[1];
      check(`${scenario} casts ${expect}`, returnee===expect, { got: returnee, cast: r.cast.slice(0,3) });
    }
  }catch(e){check('walk ran',false,e.message);} finally{await b.close();}
  console.log(`\n${pass} passed, ${bad.length} to fix`);
})();
