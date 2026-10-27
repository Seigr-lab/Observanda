import {MAX_BYTES} from './model.js';
import {researchId} from './web/research-reference.js';
import {FILE_CHUNK} from './web/evidence-fingerprint.js';
import {UPLOAD_BATCH_FRAMES,UPLOAD_HEADER_BYTES} from './web/evidence-upload-batch.js';

// Shared by workspace/project dispatch and service admission. Input schemas
// name the owning validators in executeMaterialRequest, rather than replacing
// source authorization or immutable-revision checks at that boundary.
const reads=['cusum-inputs','spectrum-inputs','coordinate-frame-page','coordinate-frame-scalar','coordinate-frame-transform-read','uncertainty-page','uncertainty-scalar','uncertainty-result','clock-synchronization-read','clock-synchronization-page','clock-synchronization-scalar','retained-figure','retained-figure-export','calculation-graph-page','source-owners','source-items','source-resolve','overview','list','references','reference-addresses','correction-preview','correction-status','correction-history','association-read','association-list','figure-sources','plot-points','plot-point','selection-page','intakes','intake-selection-page','intake-page','intake-session','upload-session','drafts','draft-read','draft-references','current','schema','measurement-scalar','measurement-component','measurement-inspect','measurement-seed','current-record','record','read','analysis-status','job','plot-job-settings','retained-table','calculation-schema','dataset-preview','dataset-jobs','rows','comparison-page','download'];
const writes=['verify','coordinate-frame-create','coordinate-frame-change','coordinate-frame-transform-save','uncertainty-create','uncertainty-change','clock-synchronization-save','clock-synchronization-create','clock-synchronization-change','calculator-retain','calculator-repeat','calculator-resume','retained-figure-change','calculation-graph-create','calculation-graph-change','associate-original','correction-apply','association-start','association-step','association-cancel','selection-change','intake-start','intake-selection-append','intake-append','intake-finish','draft-start','draft-append','draft-finish','draft-cancel','measurement-save','pin','start','finish','cancel-job','retry-job','dataset','collection','analysis','comparison','reuse','plot'];
const accepted=new Set(['calculator-retain','calculator-repeat','calculator-resume','intake-finish','finish','dataset','comparison','plot']);
// Preserve the existing lifecycle-safe snapshot subset. A queue read may
// acquire its worker, so read-only does not by itself imply snapshot admission.
const snapshots=new Set(['source-owners','source-items','source-resolve','overview','dependency-review','list','references','figure-sources','current','schema','current-record','record','read','rows','retained-table','comparison-page','analysis-status']);
const controls=new Set(['job','cancel-job']);
const routes=Object.create(null);
function define(operation,{write,method='POST',input='json',schema='material-command:'+operation,limit=MAX_BYTES,download=false,progress=false}={}){
 if(Object.hasOwn(routes,operation)||typeof write!=='boolean'||!['GET','POST'].includes(method)||!Number.isSafeInteger(limit)||limit<0)throw Error('Invalid evidence route contract');
 routes[operation]=Object.freeze({material:operation,method,input,schema,limit,write,download,progress,status:accepted.has(operation)?202:200,authority:'unlocked-selected-owner',owner:'selected-evidence-owner',admission:controls.has(operation)?'control':'work',snapshot:snapshots.has(operation),cancellation:'domain-managed-disconnect',output:download?'private-download':progress?'private-progress-and-json':'private-json'});
}
for(const operation of reads)if(operation!=='retained-figure-export')define(operation,{write:false,download:operation==='download'});
for(const operation of writes)define(operation,{write:true});
define('retained-figure-export',{write:false,method:'GET',input:'query',schema:'retained-figure-selection',limit:4096,download:true});
define('dependency-review',{write:false,progress:true});
define('original',{write:false,method:'GET',input:'path',schema:'artifact-id-and-revision',limit:0,download:true});
define('chunks',{write:true,input:'stream',schema:'bounded-upload-frame-batch',limit:UPLOAD_BATCH_FRAMES*(FILE_CHUNK+UPLOAD_HEADER_BYTES+1)});
define('chunk',{write:true,input:'stream',schema:'owned-upload-id-and-index',limit:FILE_CHUNK});
for(const operation of [...snapshots,...controls,...accepted])if(!Object.hasOwn(routes,operation))throw Error('Unknown evidence route policy');
export const materialRoutes=Object.freeze(routes);
export function materialRequest(route){
 const prefix='/api/research/materials/';if(!route.startsWith(prefix))return null;
 const operation=route.slice(prefix.length),original=/^original\/([a-f0-9-]{36})\/([a-f0-9]{64})$/.exec(operation);
 if(original&&researchId(original[1]))return {...materialRoutes.original,material:'download',ref:{kind:'artifact',id:original[1],revision:original[2]}};
 const chunk=/^chunk\/([a-f0-9-]{36})\/(\d+)$/.exec(operation);
 if(chunk&&researchId(chunk[1])&&Number.isSafeInteger(Number(chunk[2])))return {...materialRoutes.chunk,id:chunk[1],index:Number(chunk[2])};
 if(['chunk','original'].includes(operation)||!Object.hasOwn(materialRoutes,operation))return null;
 const result=materialRoutes[operation];return operation==='retained-figure-export'?{...result,querySelection:true}:result;
}
