import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyCompanyCalcData} from '../lib/calculators/company-data';
import {calculatorById} from '../lib/calculators/registry';
import {initialState,runModule,withText} from '../lib/calculators/run';
import {timeSeries} from '../lib/kfid/analytics';
const close=(value:number|undefined,expected:number)=>assert.ok(value!==undefined&&Math.abs(value-expected)<1e-8,`${value} != ${expected}`);
// The older calculator under Hjälp (V1's five modes) moved to the Räkneverktyg (2026-10-07): the formulas, and what they
// refuse, are the same. Values are in the base units of the new tools (W, V, A, Ω); the old ones were kW.
const calc=(id:string,texts:Record<string,string>)=>{const tool=calculatorById(id)!,ctx={company:emptyCompanyCalcData()};let state=initialState(tool,ctx);for(const [key,text] of Object.entries(texts)) state=withText(tool,state,key,text);return runModule(tool,state,ctx);};
const quantity=(outcome:ReturnType<typeof calc>,id:string)=>{assert.equal(outcome.status,'ok');const row=outcome.status==='ok'?outcome.rows.find(item=>item.id===id):undefined;assert.ok(row&&row.kind==='quantity',id);return row.value;};
test('the five modes of the older calculator keep their V1 formulas in the Räkneverktyg and still reject inconsistent or invalid inputs',()=>{
 const power=calc('power',{u:'400',i:'10',pf:'0,8',eta:'0,9'});close(quantity(power,'p'),Math.sqrt(3)*400*10*.8);close(quantity(power,'s'),Math.sqrt(3)*400*10);close(quantity(power,'pu'),Math.sqrt(3)*400*10*.8*.9);close(quantity(power,'q'),Math.sqrt(3)*400*10*.6);
 const current=calc('power',{u:'400',pu:String(quantity(power,'pu')/1000),pf:'0,8',eta:'0,9'});close(quantity(current,'i'),10);
 for(const input of [{u:'12',i:'2',r:''},{u:'12',i:'',r:'6'},{u:'',i:'2',r:'6'}]){const r=calc('ohm',input);close(quantity(r,'p'),24);}
 assert.equal(calc('ohm',{u:'12',i:'3',r:'6'}).status,'invalid');assert.equal(calc('ohm',{u:'12',i:'0',r:''}).status,'invalid');
 const copper=calc('voltage-drop',{length:'100',i:'16',area:'2.5',u:'400'});close(quantity(copper,'dropV'),Math.sqrt(3)*16*.01724*100/2.5); // copper at 20 °C, 100 % IACS (2026-11-01)
 const energy=calc('energy',{p:'2,5',hours:'4',days:'30',price:'1,5'});close(quantity(energy,'energy'),300);close(quantity(energy,'cost'),450);
 assert.equal(calc('energy',{p:'2',hours:'25',days:'30',price:'1'}).status,'invalid');
 assert.equal(calc('power',{p:'1',u:'0',pf:'1',eta:'1'}).status,'invalid');
});
test('statistics fill missing days, prorate leap-month targets and group ISO weeks across years',()=>{
 const monthly=timeSeries([{date:'2024-02-01',count:2},{date:'2024-02-29',count:3}],'2024-02-01','2024-02-29','month',4);assert.deepEqual(monthly,[{date:'2024-02',count:5,target:4,cumulative:5,cumulativeTarget:4}]);
 const weeks=timeSeries([{date:'2025-12-31',count:2},{date:'2026-01-01',count:1}],'2025-12-29','2026-01-04','week',2);assert.equal(weeks.length,1);assert.equal(weeks[0].date,'2025-12-29');assert.equal(weeks[0].count,3);
 const days=timeSeries([{date:'2026-01-02',count:1}],'2026-01-01','2026-01-03','day',2);assert.deepEqual(days.map(d=>d.cumulative),[0,1,1]);
});
