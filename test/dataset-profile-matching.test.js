import test from 'node:test';
import assert from 'node:assert/strict';
import {compareProfileColumns} from '../src/dataset-profile-matching.js';

const delimited={format:'delimited',delimiter:',',header:true};
const header=(sourceHeader,rule)=>({name:sourceHeader.trim()||'Column',sourceHeader,rule});
const columnRule=(aliases=[],at=null,required=true)=>({aliases,at,required});
async function compare(template,source,expectedMapping=delimited,actualMapping=expectedMapping){
 const values=new Map();
 const scratch={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value)};
 return compareProfileColumns(scratch,{template,source,expectedMapping,actualMapping});
}

test('profile matching preserves source spellings and independently reports rename, reordering, missing and extra columns',async()=>{
 const template=[header('Sensor'),header('Voltage',columnRule(['U'])),header(' A'),header('A'),header('Note',columnRule([],null,false))];
 const source=[header('A'),header('U'),header('Sensor'),header('X')];
 const result=await compare(template,source);
 assert.equal(result.sameMapping,true);
 assert.notEqual(result.sourceSignature,result.expectedSignature);
 const actual=await Promise.all(source.map((_,index)=>result.sourceAt(index)));
 assert.deepEqual(actual.map(row=>[row.status,row.profileIndex]),[['reordered',3],['renamed',1],['reordered',0],['unrecognized',null]]);
 assert.deepEqual(await result.missingAt(2),{profileIndex:2,identity:{kind:'header',text:' A'},status:'missing-required'});
 assert.equal((await result.missingAt(4)).status,'missing-optional');
 assert.equal(await result.missingAt(1),null);
 const unchanged=await compare(template,template);
 assert.equal(unchanged.sourceSignature,unchanged.expectedSignature);
});

test('literal duplicate names require an explicit position; generated display suffixes have no matching power',async()=>{
 const source=[header('Signal'),header('Signal'),header('Signal (2)')];
 const loose=await compare(source,source);
 assert.equal((await loose.sourceAt(0)).status,'ambiguous-rule');
 assert.equal((await loose.sourceAt(1)).status,'ambiguous-rule');
 assert.equal((await loose.sourceAt(2)).status,'matched');
 const precise=await compare([header('Signal',columnRule([],0)),header('Signal',columnRule([],1)),source[2]],source);
 assert.deepEqual(await Promise.all(source.map(async(_,i)=>(await precise.sourceAt(i)).status)),['matched','matched','matched']);
 const repeated=await compare([header('Signal')],[header('Signal'),header('Signal')]);
 assert.equal((await repeated.sourceAt(1)).status,'duplicate-source');
 const aliasAndOriginal=await compare([header('Signal',columnRule(['S']))],[header('Signal'),header('S')]);
 assert.equal((await aliasAndOriginal.sourceAt(0)).status,'multiple-sources');
 assert.equal((await aliasAndOriginal.sourceAt(1)).status,'multiple-sources');
});

test('positional sources, exact JSON pointers and mapping changes retain distinct identities',async()=>{
 const fields=['row','context'].map(source=>({name:'Shown',sourceField:{name:'Shown',source,path:'/large~1path'}}));
 const mapping={format:'json-nested',rowsPath:'/values',joins:[],fields:fields.map(field=>field.sourceField)};
 const result=await compare(fields,fields.toReversed(),mapping,{...mapping,rowsPath:'/changed'});
 assert.equal(result.sameMapping,false);
 assert.equal((await result.sourceAt(0)).profileIndex,1);
 assert.equal((await result.sourceAt(1)).profileIndex,0);
 const noHeader={...delimited,header:false},plain=[{name:'First',sourceHeader:null},{name:'Second',sourceHeader:null}];
 const bare=await compare(plain,plain.toReversed(),noHeader);
 assert.deepEqual((await bare.sourceAt(1)).identity,{kind:'position',index:1});
 assert.equal(bare.expectedSignature,bare.sourceSignature);
});
