import {progressUnit} from './progress-units.js';
import {localizedText,language} from './i18n/index.js';
const text=localizedText('storageProgress');
const number=value=>(value??0).toLocaleString(language());
const optionalText=key=>{try{return text(key);}catch{return '';}};
export function storageSize(bytes){
 const value=bytes??0,scale=value>=1e9?1e9:value>=1e6?1e6:value>=1e3?1e3:1;
 return text(scale===1e9?'gigabytes':scale===1e6?'megabytes':scale===1e3?'kilobytes':'bytes',{value:(value/scale).toLocaleString(language(),{maximumFractionDigits:2})});
}
export function storageProgressPresentation(value,{project=false,book=false}={}){
 const transfer=value.transfer,total=value.total,unit=value.unit??'items',prefix=book?'book-':project?'project-':'';
 const counts={count:number(value.completed),total:number(total),unit:progressUnit(unit)};
 const transferPhase=transfer?(prefix||transfer.owner?optionalText((prefix||'project-')+'phase-'+transfer.phase)||text('phase-'+transfer.phase):text('phase-'+transfer.phase)):'';
 const detail=unit==='bytes'
  ?text(total===undefined?'currentData':'currentDataTotal',{count:storageSize(value.completed),total:storageSize(total)})
  :text(total===undefined?'currentCount':'currentCountTotal',counts);
 if(transfer)return {
  path:transfer.owner?text('namedProjectTransfer',{phase:transferPhase,name:transfer.owner}):transferPhase,count:Number.isSafeInteger(transfer.totalFiles)?text('filesCopied',{count:number(transfer.files),total:number(transfer.totalFiles)}):text('filesCopiedSoFar',{count:number(transfer.files)}),
  work:Number.isSafeInteger(transfer.totalBytes)?text('dataCopied',{count:storageSize(transfer.bytes),total:storageSize(transfer.totalBytes)}):text('dataCopiedSoFar',{count:storageSize(transfer.bytes)}),detail,
  barLabel:text(book?'book-fileTransfer':project||transfer.owner?'project-fileTransfer':'fileTransfer'),total:transfer.totalBytes,completed:transfer.bytes
 };
 const stages=(value.stages??[value.stage]).filter(stage=>stage&&stage!=='preparing');
 const path=stages.filter(stage=>stage!==value.stage).map(stage=>prefix?optionalText(prefix+stage)||optionalText(stage):optionalText(stage)).filter(Boolean).join(' › ');
 const explanation=[value.stage,...stages.toReversed()].map(stage=>(prefix?optionalText(prefix+'describe-'+stage):'')||optionalText('describe-'+stage)).find(Boolean)??'';
 const count=['copy-workspace-projects','move-workspace-projects'].includes(value.stage)?text(value.stage==='move-workspace-projects'?'projectsMoved':'projectsCopied',{count:number(value.completed),total:number(total)}):value.stage==='read-archive'
  ?text('archiveProcessed',{count:storageSize(value.completed),total:storageSize(total)})
  :unit==='items'&&total===undefined&&!value.completed?'':detail;
 return {path,count,work:explanation,
  detail:value.stage==='read-archive'?text('rowsImported',{count:number(value.activity?.objects)}):'',
  barLabel:(prefix?optionalText(prefix+value.stage):'')||optionalText(value.stage)||text('currentStage'),total:total??0,completed:value.completed??0};
}
