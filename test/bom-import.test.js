import test from 'node:test';
import assert from 'node:assert/strict';
import {readBOMTable,suggestedBOMMapping,mapBOMTable,BOM_IMPORT_BYTES} from '../src/web/modules/bom-import-model.js';
import {inventoryBOMUsage} from '../src/web/modules/inventory-model.js';
import {inventoryComparisonRows,inventoryComparisonFigure} from '../src/web/modules/inventory-dashboard.js';

test('KiCad-style BOMs preserve values and exact quantities, expand references, and distinguish DNP from exclusions',()=>{
 const table=readBOMTable('\uFEFFReference,Value,Footprint,Qty,DNP,Exclude from BOM,MPN,Datasheet\r\n"R1-R3","4k7","R_0603",3,,,ABC,private.pdf\r\nU1,TL072,DIP8,9007199254740993,,,0012,chip.pdf\r\nC1,100 nF,C_0805,1,DNP,,,\r\nX1,Ignored,,1,,yes,,\r\n');
 const mapping=suggestedBOMMapping(table),result=mapBOMTable(table,mapping);
 assert.equal(result.lines.length,3);assert.equal(result.excluded.length,1);assert.equal(result.lines[0].references,'R1, R2, R3');
 assert.equal(result.lines[0].value,'4k7');assert.equal(result.lines[1].quantity,'9007199254740993');assert.equal(result.lines[1].partNumber,'0012');
 assert.equal(result.lines[2].dnp,true);assert.deepEqual(result.unmapped,['Datasheet']);
 assert.ok(!('resourceId' in result.lines[0]),'No guessed inventory match');
});
test('mapping requires explicit columns, rejects duplicate mappings and unknown flags without dropping rows',()=>{
 const table=readBOMTable('Description;Needed;Population\nTL072;2;maybe\n'),mapping=suggestedBOMMapping(table);
 assert.throws(()=>mapBOMTable(table,mapping),/Map value and quantity/);
 mapping.quantity=1;mapping.dnp=2;
 assert.throws(()=>mapBOMTable(table,mapping),/ambiguous/);
 assert.throws(()=>mapBOMTable(table,{...mapping,dnp:null,quantity:0}),/separate columns/);
 const dup=readBOMTable('Value,Qty,DNP,DNP\nA,1,yes,no');
 assert.equal(suggestedBOMMapping(dup).dnp,null,'Duplicate headers require a user choice');
});
test('ambiguous quantities, reference overlap, unsupported ranges and excessive input fail before changing a BOM',()=>{
 for(const q of ['=1+1','1,000','0x10','2 pcs','-1','0','1e3']){
  const t=readBOMTable('Value,Qty\nA,"'+q+'"');assert.throws(()=>mapBOMTable(t,suggestedBOMMapping(t)),/positive decimal/);
 }
 for(const refs of ['R1-R9999999999999999','R3-R1','R1-C3']){
  const t=readBOMTable('Reference,Value,Qty\n'+refs+',A,1');assert.throws(()=>mapBOMTable(t,suggestedBOMMapping(t)),/unsupported reference range/);
 }
 const t=readBOMTable('Reference,Value,Qty\nR1-R3,A,3\nr2,B,1');
 assert.throws(()=>mapBOMTable(t,suggestedBOMMapping(t)),/appears more than once/);
 assert.throws(()=>readBOMTable('Value,Qty\n'+'A,1\n'.repeat(201)),/200 rows/);
 assert.throws(()=>readBOMTable('x'.repeat(BOM_IMPORT_BYTES+1)),/1 MiB/);
 const excluded=readBOMTable('Value,Qty,Exclude from BOM\nA,1,yes');
 assert.throws(()=>mapBOMTable(excluded,suggestedBOMMapping(excluded)),/No component rows/);
});
test('TSV quoted text and formulas in descriptive fields stay inert text; reference separator is explicit',()=>{
 const t=readBOMTable('Reference\tValue\tQty\tNotes\n"R1;R2"\t"=CUSTOM(6)"\t0.5\t"line 1\nline 2"\n');
 const result=mapBOMTable(t,suggestedBOMMapping(t),{referenceSeparator:';'});
 assert.equal(result.lines[0].references,'R1, R2');assert.equal(result.lines[0].value,'=CUSTOM(6)');assert.equal(result.lines[0].notes,'line 1\nline 2');
});
test('BOM use is exact and follows the consumed stock source; cancelled plans and ordinary adjustments are not counted',()=>{
 const resource={type:'resource',id:'item',data:{kind:'material',projectId:null,unit:'items'}};
 const plan=(id,status,source,used,scrapped)=>({id,type:'bom',data:{status,projectId:'run-project',lines:[{id:'line',resourceId:'item',sourceProjectId:source}],usage:[{lineId:'line',used,scrapped}]}});
 const entities=[resource,plan('a','finished',null,'9007199254740993','2'),plan('b','finished','bench','3','1'),plan('c','cancelled',null,'999','0'),{type:'movement',data:{resourceId:'item',projectId:null,delta:'-9'}}];
 assert.deepEqual(inventoryBOMUsage(entities,'item'),{used:'9007199254740996',scrapped:'3',builds:2});
 assert.deepEqual(inventoryBOMUsage(entities,'item',new Set([null])),{used:'9007199254740993',scrapped:'2',builds:1});
 assert.deepEqual(inventoryBOMUsage(entities,'item',new Set(['run-project'])),{used:'0',scrapped:'0',builds:0});
 const book={title:'Organization',projects:[{id:'bench',title:'Bench'}]},holdings=inventoryComparisonRows(book,entities,resource,new Set([null,'bench']));
 assert.equal(holdings[0].used,'9007199254740993');assert.equal(holdings[1].used,'3');
 const figure=inventoryComparisonFigure({key:'item',title:'Component',data:resource.data,holdings},{comparisonMetrics:['available','used','scrapped']});
 assert.deepEqual(figure.series.map(s=>s.id),['available','used','scrapped']);assert.equal(figure.series[1].points[1].y,3);
});
