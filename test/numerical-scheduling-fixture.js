import {randomUUID} from 'node:crypto';
import {evaluateSpectrum} from '../src/dataset-spectrum-kernel.js';
import {NumericalExecutionBudget,createNumericalExecutionState,reserveNumericalExecution,settleNumericalExecution} from '../src/numerical-execution-budget.js';
import {evaluateStatisticalUncertainty} from '../src/measurement-statistical-uncertainty.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
const scalar=number=>({spelling:String(number)+'/1',representation:'rational',radix:10});
const policy=()=>{const value=defaultDatasetResourcePolicy();value.resources.maxOperations=1000000;value.resources.maxMilliseconds=30000;return value;};

// Resolved readers exercise the same kernels without incidental socket waits.
// A staged batch settles its numerical ledger before publishing fixture values.
export function spectrumSchedulingFixture(count){
 const authored={version:1,scope:'numerical-job',total:{maxOperations:1000000,maxActiveMilliseconds:30000},slice:{maxOperations:50000,maxActiveMilliseconds:2500}},records=new Map(),stats={reads:0,outputs:0,slices:0,operations:0};let cursor=null,ledger=createNumericalExecutionState('a'.repeat(64),authored),signal;
 const execution={get cursor(){return cursor;},async slice(before,callback){
  ledger=reserveNumericalExecution(ledger,{id:randomUUID(),operations:Math.min(authored.slice.maxOperations,authored.total.maxOperations-ledger.consumed.operations),activeMilliseconds:Math.min(authored.slice.maxActiveMilliseconds,Math.floor(authored.total.maxActiveMilliseconds-ledger.consumed.activeMilliseconds))});
  const budget=new NumericalExecutionBudget(ledger,{signal}),staged=new Map(),value=key=>staged.has(key)?staged.get(key):records.get(key),work={get:async key=>value(key),put:async(key,item)=>staged.set(key,item),getMany:async keys=>new Map(keys.filter(key=>value(key)!==undefined).map(key=>[key,value(key)])),putMany:async entries=>{for(const [key,item]of entries)staged.set(key,item);}};
  try{const next=await callback({budget,work});ledger=settleNumericalExecution(ledger,budget.finish());for(const [key,item]of staged)records.set(key,item);cursor=next;stats.slices++;stats.operations=ledger.consumed.operations;return cursor;}catch(error){ledger=settleNumericalExecution(ledger,budget.finish());throw error;}
 }};
 return {stats,records,async run(options={}){signal=options.signal;return evaluateSpectrum({count,read:async index=>{stats.reads++;return {real:scalar((index*73+19)%257-128),resourcePolicy:policy(),computation:null};},write:async(bin,context)=>{stats.outputs++;await context.work.put('output:'+bin.index,bin);}},{...options,resourcePolicy:policy(),calculationPolicy:defaultStructuredCalculationPolicy(),executionPolicy:authored,execution});}};
}

export function uncertaintySchedulingFixture(count){
 const records=new Map(),stats={reads:0,gets:0,puts:0},unit={...blankUnitDefinition(),kind:'difference',dimensions:[],scale:scalar(1),offset:scalar(0)},operand=number=>({value:scalar(number),column:{representation:'rational',radix:10,unit:'',missing:[],quantity:{origin:'derived',conversion:null,calibration:null,unitDefinition:unit}}});
 return {stats,async run(options={}){return evaluateStatisticalUncertainty({count,nominal:operand(10),readInput:async index=>({estimate:operand(index),sensitivity:operand(1)}),readCovariance:async(i,j)=>{stats.reads++;return operand(i===j?2:1);},work:{get:async key=>{stats.gets++;return records.get(key);},put:async(key,value)=>{stats.puts++;records.set(key,value);}}},{...options,resourcePolicy:policy(),calculationPolicy:defaultStructuredCalculationPolicy()});}};
}
