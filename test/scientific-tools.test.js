import {readDelimitedTable} from '../src/web/tabular-data.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,convertBase,spreadsheet} from '../src/tools/math.js';
import {formula,reaction} from '../src/web/tools/stoichiometry.js';
import {chemicalPreview} from '../src/tools/chemistry.js';
import {validateTool} from '../src/modules/tools.js';
import {timelineRecords} from '../src/web/tools/timeline.js';
import {sampleNotebook} from '../src/sample.js';
import {randomUUID} from 'node:crypto';
test('scientific expressions use restricted syntax, units and selected angles',()=>{
 assert.equal(calculate('sin(30)',{angle:'deg'}),'0.5');assert.equal(calculate('sin(30 deg)',{angle:'deg'}),'0.5');assert.equal(calculate('atan2(1,1)',{angle:'deg'}),'45');assert.equal(calculate('2 cm to m'),'0.02 m');assert.equal(calculate('mean(2,4,6)'),'4');assert.equal(calculate('0.1+0.2'),'0.3');assert.equal(convertBase('9007199254740993',10,6),BigInt('9007199254740993').toString(6));assert.equal(convertBase('100',6,10),'36');assert.throws(()=>convertBase('6',6,10));
 for(const expression of ['import("x")','a=2','evaluate("2")','random()','2;3','[1,2]','constructor','1/0'])assert.throws(()=>calculate(expression));
});
test('spreadsheet preserves large values and treats missing data, cycles and literal imports explicitly',()=>{
 const result=spreadsheet([['9007199254740993','=A1+1'],['3','=SUM(A2:A3)'],['4',"'=1+1"],['','=A4+1'],['=B5','=A5']]);assert.equal(result[0][0].value,'9007199254740993');assert.equal(result[0][1].value,'9.007199254740994e+15');assert.equal(result[1][1].value,'7');assert.equal(result[2][1].value,'=1+1');assert.match(result[3][1].error,/not numeric/);assert.match(result[4][0].error,/Circular/);
});
const component=(role,f,coefficient,amount,unit='mol',volume='')=>({role,formula:f,coefficient,molarMass:'',amount,unit,volume});
test('stoichiometry respects hydration, balancing, missing amounts, limiting reagents and yields',()=>{
 assert.ok(Math.abs(formula('CuSO4\u00b75H2O').mass-249.677)<.01);assert.deepEqual(formula('Ca(OH)2').atoms,{Ca:1,O:2,H:2});assert.equal(formula('SO4^2-').charge,-2);assert.throws(()=>formula('H0'));assert.throws(()=>formula('Xx2'));
 const rows=[component('reactant','H2','2','4'),component('reactant','O2','1','1'),component('product','H2O','2','18.015','g')],r=reaction(rows);assert.equal(r.balanced,true);assert.equal(r.values[1].limiting,true);assert.equal(r.values[0].remaining,2);assert.ok(Math.abs(r.values[2].yield-50)<1e-8);assert.ok(Math.abs(r.values[2].theoretical-36.03)<1e-8);
 rows[1].amount='';assert.equal(reaction(rows).values[2].theoretical,null);rows[1].amount='1';rows[2].coefficient='1';assert.equal(reaction(rows).balanced,false);assert.equal(reaction(rows).values[2].theoretical,null);
 const concentration=reaction([component('reactant','H2','2','2','M','100'),component('reactant','O2','1','1'),component('product','H2O','2','')]);assert.equal(concentration.values[0].moles,.2);assert.equal(concentration.values[0].concentration,2);
});
test('chemical previews interpret SMILES and simple CDXML, reporting unsupported fragments',()=>{
 assert.equal(chemicalPreview('CCO ethanol','smiles').structures[0].formula,'C2H6O');const cdxml='<CDXML><page><fragment><n id="1" Element="6" p="0 0"/><n id="2" Element="8" p="1 0"/><b B="1" E="2" Order="1"/></fragment></page></CDXML>';assert.equal(chemicalPreview(cdxml,'cdxml').structures[0].formula,'CH4O');assert.match(chemicalPreview(cdxml.replace('Element="6"','NodeType="Nickname"'),'cdxml').structures[0].error,/Original retained/);assert.throws(()=>chemicalPreview('<!DOCTYPE CDXML [<!ENTITY x SYSTEM "file:///private">]><CDXML/>','cdxml'));
});
test('timeline combines source selections without duplicates and retains partial and unknown dates',()=>{
 const book=sampleNotebook(),child=randomUUID();book.projects.push({id:child,parentId:book.projects[0].id});book.notebooks.push({id:randomUUID(),projectId:child});book.entries[1].notebookId=book.notebooks[1].id;book.entries[2].occurredOn={kind:'unknown'};const d={projects:[book.projects[0].id],books:[book.notebooks[0].id],descendants:true,from:'',to:'',query:'',status:'',descending:false};assert.equal(timelineRecords(book,d).length,3);assert.equal(timelineRecords(book,d).at(-1).id,book.entries[2].id);d.from='2026-09-20';assert.equal(timelineRecords(book,d).length,1);d.books=[];d.descendants=false;d.from='';assert.equal(timelineRecords(book,d).length,2);
});
test('tool validation rejects excess data and corrupted originals',()=>{
 const base={name:'Sheet',links:[],engine:1,cells:[['1']],original:null};validateTool('sheet',base);assert.throws(()=>validateTool('sheet',{...base,cells:[[1]]}));assert.throws(()=>validateTool('chemical',{name:'x',links:[],engine:1,format:'smiles',source:'CCO',original:{name:'x.smi',size:3,bytes:'Q0NP',sha256:'0'.repeat(64)}}));
});

test('spreadsheet imports retain empty row positions and literal exact numeric strings',()=>{const source='1,9007199254740993\r\n\r\n3,0042\r\n';const table=readDelimitedTable(source,{header:false,preserveEmptyRows:true});assert.deepEqual(table.rows.map(r=>r.cells),[['1','9007199254740993'],['',''],['3','0042']]);assert.deepEqual(table.rows.map(r=>r.line),[1,2,3]);assert.equal(readDelimitedTable(source,{header:false}).rows.length,2);assert.deepEqual(readDelimitedTable('0042\n\n9007199254740993\n',{header:false,preserveEmptyRows:true,minColumns:1}).rows.map(r=>r.cells),[['0042'],[''],['9007199254740993']]);});
