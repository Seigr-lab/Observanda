import test from 'node:test';
import assert from 'node:assert/strict';
import {validCoordinateAlignment,validCoordinateAlignmentAxis,validCoordinateAlignmentIndex,validCoordinateAlignmentContext,validCoordinateAlignmentReceipt,validCoordinateAlignmentColumn,validCoordinateAlignmentCell,validCoordinateAlignmentMeasurement,isCoordinateAlignment,COORDINATE_ALIGNMENT_METHOD,COORDINATE_ALIGNMENT_DIRECTIONS,COORDINATE_ALIGNMENT_TIES} from '../src/web/coordinate-alignment-model.js';
import {validGraphBinding,validGraphCalculation} from '../src/web/dataset-calculation-graph-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
const id='11111111-1111-4111-8111-111111111111',policy=defaultDatasetResourcePolicy(),source={kind:'dataset',id,revision:'a'.repeat(64)};
const coordinate=()=>({left:{id,position:3},right:18,direction:'nearest',tolerance:exactUnitScalar('1/2'),toleranceUnit:blankUnitDefinition(),ties:'error',missing:'error',excluded:'skip'});
const index={kind:'calculation-edges',count:0},binding=()=>({id,source,view:'observations',match:{method:COORDINATE_ALIGNMENT_METHOD,keysIndex:index,unmatched:'keep',coordinate:coordinate()}}),options={graphVersion:17,policy,keysIndex:value=>value===index};
test('coordinate matching declares exact tolerance, direction, ties and missing behavior without inferred defaults',()=>{
 for(const direction of COORDINATE_ALIGNMENT_DIRECTIONS)for(const ties of COORDINATE_ALIGNMENT_TIES)for(const missing of ['error','skip'])assert.equal(validCoordinateAlignment({...coordinate(),direction,ties,missing},policy),true);
 for(const patch of [{direction:'closest'},{ties:'any'},{missing:'include'},{excluded:'include'},{right:-1},{right:1.5},{left:{id,position:-1}},{left:{id:'unknown',position:0}},{tolerance:{spelling:'0.5'}},{toleranceUnit:{...blankUnitDefinition(),kind:'point'}},{extra:true}])assert.equal(validCoordinateAlignment({...coordinate(),...patch},policy),false);
 for(const field of Object.keys(coordinate())){const value=coordinate();delete value[field];assert.equal(validCoordinateAlignment(value,policy),false,field);}assert.equal(validCoordinateAlignment(coordinate()),false);
});
test('new coordinate bindings require graph17 while exact-key bindings retain their historical shape',()=>{
 assert.equal(isCoordinateAlignment(binding().match),true);assert.equal(validGraphBinding(binding(),options),true);assert.equal(validGraphBinding(binding(),{...options,graphVersion:16}),false);assert.equal(validGraphBinding(binding(),{...options,policy:undefined}),false);assert.equal(validGraphBinding({...binding(),source:{...source,kind:'analysis'}},options),false);
 const exact={...binding(),match:{keysIndex:index,unmatched:'keep'}};assert.equal(validGraphBinding(exact,{keysIndex:options.keysIndex}),true);assert.equal(validGraphBinding({...exact,match:{...exact.match,coordinate:coordinate()}},options),false);assert.equal(validGraphBinding({...binding(),match:{...binding().match,method:'automatic'}},options),false);assert.equal(validGraphBinding({...binding(),match:null}),true);
 assert.equal(validGraphCalculation({version:20,graph:{...source,kind:'analysis'}}),true);assert.equal(validGraphCalculation({version:21,graph:{...source,kind:'analysis'}}),false);
});

const sequence=(kind,count=1)=>({format:1,kind,root:count?{count,height:1,hash:'a'.repeat(64),key:'b'.repeat(64)}:null,count,chunkSize:1});
test('paged alignment contexts and selection decisions have closed independent markers',()=>{
 const contextsIndex=sequence('coordinate-alignment-contexts'),decisionsIndex=sequence('coordinate-alignment-decisions'),context={version:1,method:COORDINATE_ALIGNMENT_METHOD,graph:{...source,kind:'analysis'},binding:{id,position:1},direction:'nearest',tolerance:exactUnitScalar('1/2'),toleranceUnit:blankUnitDefinition(),ties:'error',missing:'skip',excluded:'skip',unmatched:'keep',partitionKeys:0,resourcePolicy:policy};
 assert.equal(validCoordinateAlignmentContext(context),true);for(const patch of [{method:'automatic'},{partitionKeys:-1},{graph:source},{extra:true}])assert.equal(validCoordinateAlignmentContext({...context,...patch}),false);
 assert.equal(validCoordinateAlignmentColumn({version:1,contextsIndex}),true);assert.equal(validCoordinateAlignmentCell({version:1,decisionsIndex}),true);assert.equal(validCoordinateAlignmentMeasurement({version:1,contextsIndex,decisionsIndex}),true);assert.equal(validCoordinateAlignmentColumn({version:1,decisionsIndex}),false);assert.equal(validCoordinateAlignmentCell({version:1,contextsIndex}),false);assert.equal(validCoordinateAlignmentMeasurement({version:1,contextsIndex}),false);
 for(const patch of [{chunkSize:64},{count:2},{root:null},{extra:true}])assert.equal(validCoordinateAlignmentIndex({...contextsIndex,...patch},contextsIndex.kind),false);assert.equal(validCoordinateAlignmentIndex(sequence('coordinate-alignment-contexts',0),'coordinate-alignment-contexts'),true);
});
test('selection receipts retain their own approximation and reject inconsistent match diagnostics',()=>{
 const evidenceIndex=sequence('coordinate-alignment-evidence',2),receipt={version:1,status:'matched',delta:exactUnitScalar('-1/2'),tieCount:3,decisionComputation:{version:1,kind:'approximate-inputs'},evidenceIndex};assert.equal(validCoordinateAlignmentReceipt(receipt,policy),true);assert.equal(validCoordinateAlignmentReceipt({...receipt,status:'outside-tolerance'},policy),true);
 for(const patch of [{delta:null},{tieCount:0},{decisionComputation:{version:2,kind:'per-cell'}},{evidenceIndex:sequence('coordinate-alignment-evidence',5)},{evidenceIndex:sequence('coordinate-alignment-evidence',0)},{status:'guess'},{extra:true}])assert.equal(validCoordinateAlignmentReceipt({...receipt,...patch},policy),false);
 const missing={...receipt,status:'left-missing',delta:null,tieCount:0,decisionComputation:null,evidenceIndex:sequence('coordinate-alignment-evidence',0)};assert.equal(validCoordinateAlignmentReceipt(missing,policy),true);assert.equal(validCoordinateAlignmentReceipt({...missing,status:'no-candidate'},policy),true);assert.equal(validCoordinateAlignmentReceipt({...missing,tieCount:1},policy),false);assert.equal(validCoordinateAlignmentReceipt(receipt),false);
});

test('an explicit scalar frame axis binds an ordinal to one pinned frame revision',()=>{const axis={version:1,frame:{...source,kind:'analysis'},axis:2};assert.equal(validCoordinateAlignmentAxis(axis),true);for(const patch of [{axis:-1},{axis:'2'},{axis:0.5},{frame:source},{name:'guessed axis'},{version:2}])assert.equal(validCoordinateAlignmentAxis({...axis,...patch}),false);});
