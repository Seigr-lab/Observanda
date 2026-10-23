// Cross-record and retained-evidence admission for a restored document. Identity
// lookups and figure/media validation consume one selected value at a time.
import {SnapshotIndex} from './snapshot-index.js';
import {validateRecordChanges} from './model.js';
import {validateAttemptDocumentChange} from './record-attempt-document.js';
import {validateResultSources} from './result-statements.js';
import {validateFigureSources} from './figure-provenance.js';
import {retainedFigureTargets} from './retained-figure-targets.js';
import {resultDocumentStatements} from './record-result-document.js';
import {withScratch} from './scratch-work.js';
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
 const evidence=async targets=>{
  for await(const ref of document.items(['figures'],{signal})){
   const figure=await document.tree.read(ref.value);await validateFigureSources(store.workspace,{figures:[figure]});
   if(targets)for await(const target of retainedFigureTargets(store.workspace,figure,{signal}))await targets.add(target.id);
  }
  for await(const ref of document.items(['attachments'],{signal})){
   const attachment=await document.tree.read(ref.value),file=await media.get(attachment.id,{streamed:true});
   if(file.kind!==attachment.kind)throw new AppError('MEDIA_INVALID');
  }
  await validateAttemptDocumentChange(store.workspace,snapshot.metadata.id,previous,document,header.id,{signal,validated:true});
  for await(const statement of resultDocumentStatements(document,{signal})){
   const figures=statement.kind==='figure'&&await targets.has(statement.figureId)?[{id:statement.figureId}]:[];
   await validateResultSources(store.workspace,{results:{version:1,statements:[statement]},figures});
  }
 };
 // The source header deliberately omits growing result bodies. Persist only
 // opaque figure identities in scratch storage while checking each statement.
 if(header.results)await withScratch(evidence,{signal});else await evidence(null);
}
