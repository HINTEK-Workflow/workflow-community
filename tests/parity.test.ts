import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../lib/kfid/calculator';
import {timeSeries} from '../lib/kfid/analytics';
import {exampleRow,attachmentLabel} from '../lib/kfid/editor-tools';
import {blankControl,normalizeControl,sectionKeys} from '../lib/kfid/model';
const close=(value:number|undefined,expected:number)=>assert.ok(value!==undefined&&Math.abs(value-expected)<1e-8,`${value} != ${expected}`);
test('five calculator modes preserve V1 formulas and reject inconsistent or invalid inputs',()=>{
 const power=calculate('power3',{u:'400',i:'10',pf:'0.8',eta:'0.9'});close(power.result?.[1].value,Math.sqrt(3)*400*10*.8/1000);
 const current=calculate('current3',{p:String(power.result![2].value),u:'400',pf:'0.8',eta:'0.9'});close(current.result?.[0].value,10);
 for(const input of [{u:'12',i:'2',r:''},{u:'12',i:'',r:'6'},{u:'',i:'2',r:'6'}]){const r=calculate('ohm',input);close(r.result?.[3].value,24);}
 assert.ok(calculate('ohm',{u:'12',i:'3',r:'6'}).error);assert.ok(calculate('ohm',{u:'12',i:'0',r:''}).error);
 const copper=calculate('vdrop3',{l:'100',i:'16',a:'2.5',material:'Koppar',u:'400'});close(copper.result?.[0].value,Math.sqrt(3)*16*.0175*100/2.5);
 const energy=calculate('energy',{p:'2,5',hours:'4',days:'30',price:'1,5'});close(energy.result?.[0].value,300);close(energy.result?.[1].value,450);
 assert.ok(calculate('energy',{p:'2',hours:'25',days:'30',price:'1'}).error);
 assert.ok(calculate('current3',{p:'1',u:'0',pf:'1',eta:'1'}).error);
});
test('statistics fill missing days, prorate leap-month targets and group ISO weeks across years',()=>{
 const monthly=timeSeries([{date:'2024-02-01',count:2},{date:'2024-02-29',count:3}],'2024-02-01','2024-02-29','month',4);assert.deepEqual(monthly,[{date:'2024-02',count:5,target:4,cumulative:5,cumulativeTarget:4}]);
 const weeks=timeSeries([{date:'2025-12-31',count:2},{date:'2026-01-01',count:1}],'2025-12-29','2026-01-04','week',2);assert.equal(weeks.length,1);assert.equal(weeks[0].date,'2025-12-29');assert.equal(weeks[0].count,3);
 const days=timeSeries([{date:'2026-01-02',count:1}],'2026-01-01','2026-01-03','day',2);assert.deepEqual(days.map(d=>d.cumulative),[0,1,1]);
});
test('examples remain visibly marked through normalization and attachments identify their original row',()=>{
 const data=blankControl();for(const section of sectionKeys){data[section].rows=[exampleRow(section)];data.active[section]=true;}
 const normalized=normalizeControl(data);for(const section of sectionKeys)assert.equal(normalized[section].rows[0].example,true);
 const label=attachmentLabel(normalized,{section:'iso',rowId:String(normalized.iso.rows[0].uid)});assert.match(label,/Isolation/);assert.match(label,/1/);
});
