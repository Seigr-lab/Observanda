import test from 'node:test';
import assert from 'node:assert/strict';
import {createFigureMapper,mapFigureTable} from '../src/web/figure-import-model.js';
import {createFigure} from '../src/web/figure-model.js';
import {assertPlotProjectionUnits,inspectPlotPoint} from '../src/dataset-plot-provenance.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
const q=spelling=>({spelling,representation:'decimal',radix:10}),transform=(origin,scale)=>({origin:q(origin),scale:q(scale)});
const mapping=extra=>({x:0,xKind:'number',group:null,values:[{column:1,error:null}],operation:'raw',order:'source',kind:'scatter',decimal:'.',mode:'replace',...extra});
function mapped(rows,extra={}){
 const table={columns:rows[0].map((_,index)=>({index,label:'Column '+index,heading:'Column '+index})),rows:rows.map((cells,row)=>({cells,source:{page:0,row},line:row+1}))},receipts=[],members=[];
 const mapper=createFigureMapper(table,mapping(extra),createFigure(),{provenance:{point:(index,value)=>receipts.push({index,...value}),member:(bucket,source)=>members.push({bucket,source})}});
 for(const row of table.rows)mapper.add(row);
 // The native writer drains between these yields; finish then preserves order.
 if(!mapper.invalid)for(const point of mapper.finishPoints()){void point;}
 return {...mapper.finish(),receipts,members};
}
test('exact origin/scale keeps adjacent large coordinates and sorted original row identities',()=>{
 const origin='1000000000000000000000000000000',projection={version:1,x:transform(origin,'1'),y:transform('0','1e999')};
 const result=mapped([['1000000000000000000000000000002','1e1000'],['1000000000000000000000000000001','2e1000']],{projection,order:'ascending'});
 assert.deepEqual(result.issues,[]);assert.deepEqual(result.figure.series[0].points.map(p=>[p.x,p.y]),[[1,20],[2,10]]);assert.deepEqual(result.pointOrder,[[1,0]]);
 assert.deepEqual(result.pointOrder[0].map(i=>result.receipts[i].source.row),[1,0]);assert.deepEqual(result.figure.projection,projection);assert.equal(result.figure.x.label,'Column 0');
 assert.deepEqual(result.receipts[0].coordinates.x.error,{numerator:'0',denominator:'1'});
});
test('interval endpoints subtract the origin but uncertainty widths scale only and counts stay exact',()=>{
 const projection={version:1,x:transform('100','10'),y:transform('400','100')};
 const result=mapped([['120','500','50','110','130','450','550','123']],{projection,values:[{column:1,error:2,xLower:3,xUpper:4,count:7}]});
 assert.deepEqual(result.issues,[]);assert.deepEqual(result.figure.series[0].points[0],{x:2,y:1,error:.5,xLower:1,xUpper:3,count:123});assert.equal(result.receipts[0].coordinates.count,undefined);assert.equal(result.receipts[0].coordinates.error.exact,'50/1');
 const endpoints=mapped([['120','500','50','110','130','450','550','123']],{projection,values:[{column:1,error:null,yLower:5,yUpper:6}]});assert.deepEqual(endpoints.issues,[]);assert.equal(endpoints.figure.series[0].points[0].yLower,.5);assert.equal(endpoints.figure.series[0].points[0].yUpper,1.5);
});
test('exact reductions precede transformation and retain all grouped source positions',()=>{
 const projection={version:1,y:transform('100','10')};
 const sum=mapped([['2','100'],['1','100'],['2','200']],{projection,operation:'sum',order:'ascending'});
 assert.deepEqual(sum.issues,[]);assert.deepEqual(sum.figure.series[0].points.map(p=>[p.x,p.y]),[[1,0],[2,20]]);assert.deepEqual(sum.pointOrder,[[1,0]]);assert.equal(sum.receipts[0].coordinates.y.exact,'300/1');assert.deepEqual(sum.members.filter(v=>v.bucket===0).map(v=>v.source.row),[0,2]);
 const mean=mapped([['1','100'],['1','200']],{projection,operation:'mean'});assert.equal(mean.figure.series[0].points[0].y,5);assert.equal(mean.receipts[0].coordinates.y.exact,'150/1');
});
test('binary projection error is retained in source units and explicit approximation never loses its warning',()=>{
 const projection={version:1,y:transform('1000','.1')};
 const exact=mapped([['1','1000.01']],{projection});assert.deepEqual(exact.issues,[]);assert.equal(exact.figure.series[0].points[0].y,.1);assert.deepEqual(exact.receipts[0].coordinates.y.error,{numerator:'1',denominator:'1801439850948198400'});
 const repeating=mapped([['1','1']],{projection:{version:1,y:transform('0','3')},numericPolicy:'approximate'});assert.deepEqual(repeating.issues,[]);assert.ok(repeating.warnings.some(value=>/rounded/i.test(value)));assert.deepEqual(repeating.receipts[0].coordinates.y.error,{numerator:'-1',denominator:'18014398509481984'});
});
test('projection admission refuses nonnumeric x, incompatible typed endpoints and nonpositive scales',()=>{
 for(const extra of [{projection:{version:1,x:transform('0','1')},xKind:'category'},{projection:{version:1,y:transform('0','0')}}])assert.ok(mapped([['1','2']],extra).issues.length);
 const absolute={...blankUnitDefinition(),kind:'absolute',dimensions:[{axis:'temperature',exponent:1}],offset:exactUnitScalar('273.15','decimal')},difference={...absolute,kind:'difference',offset:exactUnitScalar('0')};
 const columns=[{unit:'s'},{unit:'temperature',quantity:{unitDefinition:absolute}},{unit:'temperature difference',quantity:{unitDefinition:difference}},{unit:'temperature',quantity:{unitDefinition:absolute}}],m=mapping({projection:{version:1,y:transform('0','1')},values:[{column:1,error:2,yLower:3,yUpper:3}]});
 assert.doesNotThrow(()=>assertPlotProjectionUnits(m,columns));
 for(const bad of [{...difference,scale:exactUnitScalar('2')},{...difference,dimensions:[{axis:'length',exponent:1}]},absolute])assert.throws(()=>assertPlotProjectionUnits(m,[...columns.slice(0,2),{unit:'temperature',quantity:{unitDefinition:bad}},columns[3]]),{code:'MATERIAL_INVALID'});
 const endpoint={...absolute,offset:exactUnitScalar('0')};assert.throws(()=>assertPlotProjectionUnits(m,[...columns.slice(0,3),{unit:'temperature',quantity:{unitDefinition:endpoint}}]),{code:'MATERIAL_INVALID'});
});
test('canonical value capacity refuses before a receipt can become unreadable and old plots omit transforms',()=>{
 const tooLarge=mapped([['1','1e8192']],{projection:{version:1,y:transform('0','1e8192')}});assert.equal(tooLarge.figure,null);assert.equal(tooLarge.precision,true);assert.equal(tooLarge.receipts.length,0);
 const table={columns:[{index:0,label:'X'},{index:1,label:'Y'}],rows:[{cells:['1','2']}]},old=mapFigureTable(table,mapping({}),createFigure());assert.deepEqual(old.issues,[]);assert.equal(Object.hasOwn(old.figure,'projection'),false);assert.equal(Object.hasOwn(old,'pointOrder'),false);assert.deepEqual(old.figure.series[0].points,[{x:1,y:2,error:null}]);
});


test('point inspection binds unchanged marker counts and calendar endpoints to exact selected source cells',async()=>{
 const m=mapping({xKind:'date',projection:{version:1,y:transform('400','100')},values:[{column:1,error:null,count:2,xLower:3,xUpper:4}]}),cells=['2026-01-02','500','10','2026-01-01','2026-01-03'],result=mapped([cells],m);assert.deepEqual(result.issues,[]);
 const ref={kind:'dataset',id:'source',revision:'exact'},detail=result.receipts[0],receipt={version:1,series:0,point:0,column:1,group:null,coordinates:detail.coordinates,source:detail.source},source={content:{rowCount:1,datasetFormat:2}},columns=cells.map((_,i)=>({representation:[1,2].includes(i)?'decimal':'text',unit:'',missing:[]}));
 const content={tool:'Observanda table mapping',version:'8',mapping:m,parameters:JSON.stringify(m),inputs:[ref],denominator:{dataset:ref},figure:result.figure,numericTransform:{algorithm:'exact-affine-rational-to-binary64',version:1,projection:m.projection,errorUnits:'source',policy:'safe'},plotPointsIndex:{kind:'plot-points',count:1}},doc={content};
 const materials={readSnapshot:run=>run(),read:async value=>value===ref?source:doc,datasetColumns:async()=>columns,datasetPageCount:()=>1,retainedDatasetPage:async()=>({rows:[{cells,excluded:null}]}),sequences:{validate:value=>value,item:async()=>receipt}};
 assert.equal((await inspectPlotPoint(materials,{},0)).coordinate.count,10);
 for(const [field,forged]of [['count',11],['xLower','2025-12-31'],['xUpper','2026-01-04']]){const prior=content.figure.series[0].points[0][field];try{content.figure.series[0].points[0][field]=forged;await assert.rejects(()=>inspectPlotPoint(materials,{},0),{code:'MATERIAL_MISSING'});}finally{content.figure.series[0].points[0][field]=prior;}}
});
