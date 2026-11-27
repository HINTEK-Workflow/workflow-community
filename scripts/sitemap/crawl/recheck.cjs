/* eslint-disable @typescript-eslint/no-require-imports -- QA helper (CommonJS): the click robot's second look. */
/* Om-prov (analysen 2026-10-24): sidor som roboten inte kunde ladda i sin egen flik (ERR_ABORTED) öppnas i en ny flik och
 * mäts igen. node scripts/sitemap/crawl/recheck.cjs → recheck.json */
const fs=require("fs"),path=require("path");const { OUT, SHOTS, BASES: BASE, RUNS, signIn, chromium, axeSource } = require("./config.cjs");
const AXE=axeSource();
(async()=>{const b=await chromium.launch();const out=[];
for(const run of RUNS){
 const d=JSON.parse(fs.readFileSync(path.join(OUT,run+".json"),"utf8"));const [role,dev]=run.split("-");const base=BASE[role];
 const ctx=await b.newContext(dev==="phone"?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
  let p=await ctx.newPage();await signIn(p,base);
 for(const pg of d.pages.filter(x=>x.status!=="ok")){
  const page=await ctx.newPage();const cons=[],http=[],perr=[];let dl=null;
  page.on("console",m=>{if(m.type()==="error")cons.push(m.text().slice(0,200))});page.on("pageerror",e=>perr.push(String(e.message).slice(0,200)));
  page.on("response",r=>{if(r.status()>=400)http.push(r.status()+" "+r.url().replace(base,""))});page.on("download",x=>dl=x.suggestedFilename());
  let st="ok",ct="";try{const r=await page.goto(pg.url,{timeout:20000});st=r?String(r.status()):"null";ct=r?r.headers()["content-type"]:"";}catch(e){st="fel "+e.message.split("\n")[0].slice(0,100);}
  await page.locator("h1,[data-testid=native-top-title]").first().waitFor({timeout:6000}).catch(()=>{});await page.waitForTimeout(700);
  const m=await page.evaluate(()=>({url:location.pathname+location.search,h1:[...document.querySelectorAll("h1")].map(h=>h.textContent.trim()),top:[...document.querySelectorAll("[data-testid=native-top-title]")].map(h=>h.textContent.trim()),crumb:document.querySelector("[data-testid=breadcrumb-current]")?.textContent.trim()||"",hs:document.documentElement.scrollWidth-document.documentElement.clientWidth,back:!!document.querySelector("a[href^='/'],a[href^='/?'],[data-testid$='-back']"),text:(document.querySelector("main")||document.body).innerText.slice(0,160).replace(/\s+/g," ")})).catch(e=>({err:e.message}));
  let ax=[];try{await page.addScriptTag({content:AXE});ax=await page.evaluate(async()=>(await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]},resultTypes:["violations"]})).violations.map(v=>v.id+" "+(v.nodes[0]?.target||[]).join(" ")+" "+(v.nodes[0]?.html||"").slice(0,100)))}catch{}
  const shot=`recheck-${run}-${pg.n}.png`;await page.screenshot({path:path.join(SHOTS,shot)}).catch(()=>{});
  out.push({run,key:pg.key,url:pg.url,st,ct,dl,...m,cons,http,perr,ax,shot});console.log(run,pg.key,st,dl||"",JSON.stringify(m.h1),m.url);await page.close();}
 await ctx.close();}
fs.writeFileSync(path.join(OUT,"recheck.json"),JSON.stringify(out,null,1));await b.close();})();
