/* eslint-disable @typescript-eslint/no-require-imports -- QA helper (CommonJS): the click robot's Bakåt check. */
/* Bakåt-prov (analysen 2026-10-24): på ett urval av robotens sidor klick på en länk A → B i en ny flik, sedan webbläsarens
 * Bakåt (och på telefonen appens ‹) – ska ge A. node scripts/sitemap/crawl/back.cjs <role>-<device> → back-<run>.json */
const fs=require("fs"),path=require("path");const { OUT, BASES: BASE, signIn, chromium } = require("./config.cjs");
const run=process.argv[2];const [role,dev]=run.split("-");const base=BASE[role];
const norm=(u)=>{const x=new URL(u);const k=[...x.searchParams.keys()].sort();return x.pathname+"?"+k.map(q=>q+"="+(/Id$|^edit$/.test(q)?"…":x.searchParams.get(q))).join("&")};
(async()=>{const b=await chromium.launch();const ctx=await b.newContext(dev==="phone"?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
let p=await ctx.newPage();await signIn(p,base);await p.close();
const d=JSON.parse(fs.readFileSync(path.join(OUT,run+".json"),"utf8"));const pages=d.pages.filter(x=>x.status==="ok"&&x.url.includes("?view="));
const sample=pages.filter((_,i)=>i%Math.max(1,Math.floor(pages.length/25))===0).slice(0,25);const out=[];
const settle=async(pg)=>{await pg.locator("h1,[data-testid=native-top-title]").first().waitFor({timeout:6000}).catch(()=>{});await pg.waitForTimeout(800);};
for(const s of sample){const pg=await ctx.newPage();try{await pg.goto(s.url);await settle(pg);
 const a=await pg.evaluate(()=>{const l=[...document.querySelectorAll("main a[href*='?view=']")].filter(a=>a.getBoundingClientRect().width>0);const x=l[Math.floor(l.length/2)];if(!x)return null;x.setAttribute("data-bk","1");return x.textContent.trim().slice(0,50)});
 if(!a){await pg.close();continue;}const A=norm(pg.url());await pg.locator("[data-bk]").first().click({timeout:4000});await settle(pg);const B=norm(pg.url());if(A===B){await pg.close();continue;}
 await pg.goBack();await settle(pg);const back=norm(pg.url());const rec={from:A,via:a,to:B,back,ok:back===A};
 if(dev==="phone"){await pg.goForward();await settle(pg);const btn=pg.locator("[data-testid='native-top-back']").first();if(await btn.count()&&await btn.isVisible()){rec.appLabel=(await btn.innerText()).trim();await btn.click();await settle(pg);rec.appBack=norm(pg.url());}}
 out.push(rec);}catch(e){out.push({from:s.key,error:e.message.split("\n")[0].slice(0,100)})}await pg.close();}
fs.writeFileSync(path.join(OUT,"back-"+run+".json"),JSON.stringify(out,null,1));const ok=out.filter(x=>x.ok).length;console.log(run,out.length,"ok",ok,"fel",out.filter(x=>x.error).length);
for(const x of out.filter(x=>(x.ok===false)||(x.appBack&&x.appBack!==x.from)))console.log("  ",JSON.stringify(x));await b.close();})();
