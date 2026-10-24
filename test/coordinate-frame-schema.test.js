import test from 'node:test';
import assert from 'node:assert/strict';
import {validColumnCoordinateFrame,preserveCoordinateFrameResult,publicCoordinateFrameContext} from '../src/web/coordinate-frame-schema.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
const ref=(digit)=>({kind:'analysis',id:'00000000-0000-4000-8000-00000000000'+digit,revision:digit.repeat(64)});
const source=()=>({...defaultColumn({label:'Declared position'}),representation:'domain',domain:{...defaultDomain('vector'),namespace:'declared apparatus frame'},unit:'m',quantity:{origin:'measured',conversion:null,calibration:null,unitDefinition:blankUnitDefinition()},coordinateFrame:{version:1,frame:ref('1')}});
test('frame metadata belongs only to declared vector columns with difference units',()=>{
 const column=source();assert.equal(validColumnCoordinateFrame(column),true);assert.equal(validColumnCoordinateFrame(defaultColumn({label:'Unspecified'})),true);
 for(const changed of [{representation:'decimal'},{domain:defaultDomain('matrix')},{quantity:{...column.quantity,unitDefinition:{...column.quantity.unitDefinition,kind:'absolute'}}},{coordinateFrame:{...column.coordinateFrame,sourceFrame:ref('2')}}])assert.equal(validColumnCoordinateFrame({...column,...changed}),false);
});
test('renaming transformed columns preserves their pinned mathematical interpretation',()=>{
 const original=source();original.coordinateFrame={version:1,frame:ref('2'),sourceFrame:ref('1'),transform:ref('3')};const edited={...original,name:'Renamed result',coordinateFrame:{version:1,frame:ref('4')},domain:defaultDomain('matrix'),unit:'other'};
 const result=preserveCoordinateFrameResult(original,edited);assert.equal(result.name,'Renamed result');for(const key of ['coordinateFrame','representation','domain','radix','unit','quantity'])assert.deepEqual(result[key],original[key]);assert.notEqual(result.coordinateFrame,original.coordinateFrame);
 const authored=source(),reassigned={...authored,coordinateFrame:{version:1,frame:ref('4')}};assert.equal(preserveCoordinateFrameResult(authored,reassigned),reassigned);
});
test('public frame context contains no private model identity or source metadata',()=>{
 const column=source();column.coordinateFrame={version:1,frame:ref('2'),sourceFrame:ref('1'),transform:ref('3')};const publicValue=publicCoordinateFrameContext(column);assert.deepEqual(publicValue,{namespace:'declared apparatus frame',dimension:2,unit:'m',method:'affine-frame-transform-v1'});for(const value of Object.values(column.coordinateFrame).filter(value=>typeof value==='object')){assert.ok(!JSON.stringify(publicValue).includes(value.id));assert.ok(!JSON.stringify(publicValue).includes(value.revision));}
 assert.equal(publicCoordinateFrameContext(defaultColumn({label:'Unspecified'})),undefined);
});
