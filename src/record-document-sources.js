// Cross-record and retained-evidence admission for a restored document. Identity
// lookups and figure/media validation consume one selected value at a time.
import {SnapshotIndex} from './snapshot-index.js';
import {validateRecordChanges} from './model.js';
import {validateAttemptDocumentChange} from './record-attempt-document.js';
import {validateResultSources} from './result-statements.js';
import {validateFigureSources} from './figure-provenance.js';
import {figureTargets} from './web/figure-composition.js';
import {AppError} from './errors.js';
export async function validateDocumentSources(store,snapshot,document,header,previous,media,{signal}={}){
 const index=new SnapshotIndex(store),blank={...header,body:'',sections:[],figures:[],attachments:[],relations:[],contributors:[],tags:[]};
 const validate=async part=>validateRecordChanges(snapshot.metadata,[part],await index.validationRows(snapshot.membership,[part]),{capacity:false});
 await validate(blank);
 for await(const ref of document.items(['sections'],{signal})){
  const section={id:(await document.tree.selected(ref.value,['id'])).value,title:'Identity check',body:''};
  await validate({...blank,sections:[section]});
 }
 for await(const ref of document.items(['relations'],{signal}))await validate({...blank,relations:[await document.tree.read(ref.value)]});
 const targets=new Map((header.results?.statements??[]).filter(s=>s.kind==='figure').map(s=>[s.figureId,false]));
 for await(const ref of document.items(['figures'],{signal})){
  const figure=await document.tree.read(ref.value);await validateFigureSources(store.workspace,{figures:[figure]});
  for(const target of figureTargets([figure]))if(targets.has(target.id))targets.set(target.id,true);
 }
 for await(const ref of document.items(['attachments'],{signal})){
  const attachment=await document.tree.read(ref.value),file=await media.get(attachment.id,{streamed:true});
  if(file.kind!==attachment.kind)throw new AppError('MEDIA_INVALID');
 }
 await validateAttemptDocumentChange(store.workspace,snapshot.metadata.id,previous,document,header.id,{signal,validated:true});
 await validateResultSources(store.workspace,{...header,figures:[...targets].filter(([,found])=>found).map(([id])=>({id}))});
}
