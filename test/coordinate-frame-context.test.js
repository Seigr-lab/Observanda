import {coordinateFrameLineageView} from '../src/web/coordinate-frame-context.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinateFrameContextText,coordinateFrameAxisPageText} from '../src/web/coordinate-frame-context.js';
import messages from '../src/web/locales/en/coordinateFrames.json' with {type:'json'};
const text=(key,args={})=>messages[key].replace(/\{(\w+)\}/g,(_,name)=>String(args[name]));
const context={namespace:'Declared target axes',dimension:18,unit:'mm'};

test('public frame context states supplied namespace dimension and unit without inferring axis meanings',()=>{
 const result=coordinateFrameContextText(context,{text});assert.match(result,/Declared frame namespace Declared target axes/);assert.match(result,/dimension 18/);assert.match(result,/supplied unit label mm/);assert.match(result,/Axis order is declared by the frame/);assert.doesNotMatch(result,/Cartesian|north|east|geodetic/);assert.match(coordinateFrameContextText({...context,unit:''},{text}),/no unit label supplied/);
});
test('affine frame public context states explicit matrix order and accepts only supported projected context',()=>{
 const result=coordinateFrameContextText({...context,method:'affine-frame-transform-v1',sourceNamespace:'Declared source axes'},{text});assert.match(result,/from declared frame namespace Declared source axes to declared frame namespace Declared target axes/);assert.match(result,/Matrix rows follow target axes and columns follow source axes/);for(const value of [{version:1,frame:{kind:'analysis',id:'private-id',revision:'private-revision'}},{...context,frame:'private-id'},{...context,method:'implicit-rotation',sourceNamespace:'source'},{...context,sourceNamespace:'source'},{...context,dimension:0}])assert.equal(coordinateFrameContextText(value,{text}),'');
});
test('public axes are explicitly paged and retain declared order without claiming an incomplete list is complete',()=>{
 const value={...context,axes:{offset:16,total:18,items:[{name:'Later axis B'},{name:'Later axis A'}]}},result=coordinateFrameAxisPageText(value,{text});assert.equal(result,'Declared axes 17 to 18 of 18, in stored order:\n17. Later axis B\n18. Later axis A');assert.match(coordinateFrameContextText(value,{text}),/axes 17 to 18 of 18/);for(const axes of [{...value.axes,offset:17},{...value.axes,total:19},{...value.axes,items:[{id:'private-axis-id',name:'Axis'}]},{offset:0,total:18,items:Array.from({length:17},()=>({name:'Axis'}))}])assert.equal(coordinateFrameContextText({...context,axes},{text}),'');
});


test('public affine context needs no private source frame lookup when only the target projection is supplied',()=>{
 const result=coordinateFrameContextText({...context,method:'affine-frame-transform-v1'},{text});assert.match(result,/Affine transform to declared frame namespace Declared target axes/);assert.match(result,/dimension 18/);assert.doesNotMatch(result,/undefined|from declared frame namespace/);assert.equal(coordinateFrameContextText({...context,sourceNamespace:'unqualified source'},{text}),'');
});

test('private frame lineage describes the explicit mapping or selected axis without displaying identifiers',()=>{
 const esc=value=>String(value),text=(key,args={})=>messages[key].replace(/\{(\w+)\}/g,(_,name)=>args[name]);
 const rendered=coordinateFrameLineageView({coordinateTransform:{version:1,method:'affine-frame-transform-v1',model:{id:'PRIVATE'}}},{esc,text});assert.match(rendered,/source and target frames/);assert.doesNotMatch(rendered,/PRIVATE/);assert.match(coordinateFrameLineageView({coordinateComponent:{version:1,axis:17}},{esc,text}),/axis 18/);assert.equal(coordinateFrameLineageView({coordinateComponent:{version:1,axis:-1}},{esc,text}),'');
});
