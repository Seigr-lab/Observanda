import {recordContentRevision} from './record-encoding.js';
import {AppError} from './errors.js';
import {reconcileWebsiteMembership} from './website-membership.js';
import {upgradeNotebook,validateNotebook,validateRecordChanges} from './model.js';
import {validateAttemptChange} from './attempts.js';
import {validateResultSources} from './result-statements.js';
import {validateFigureSources} from './figure-provenance.js';

// These opaque content revisions are independent of the storage adapter and
// workspace revision. A change elsewhere must not invalidate this record.
export const recordRevision=record=>recordContentRevision(record);
// Upgrade a historical record without including unrelated presentation targets.
export function historicalBook(metadata,record){
 const book={...metadata,entries:[record]};
 delete book.websites;
 if(book.formatVersion>=3)book.branding=[];
 if(book.website?.layouts)book.website={...book.website,layouts:[]};
 // Catalogue metadata and records have independent budgets. Reconstructing a
 // serialized legacy notebook here charges indentation and unrelated metadata
 // against a valid record, including during indexing, history and verification.
 if(book.formatVersion===21){
  validateRecordChanges(book,[record],[],{capacity:false});
  return structuredClone(book);
 }
 return upgradeNotebook(book);
}
// Index and history owners only inspect the validated value. Current records
// need no upgraded copy; mutable authoring callers still use historicalBook.
export function historicalRecordValue(metadata,record){
 if(metadata.formatVersion!==21)return historicalBook(metadata,record).entries[0];
 validateRecordChanges(metadata,[record],[],{capacity:false});return record;
}
export const recordRevisions=book=>Object.fromEntries(book.entries.map(record=>[record.id,recordRevision(record)]));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function validateRecordEdits(changes){
  if(!Array.isArray(changes))throw new AppError('INVALID');
  const identifiers=new Set();
  for(const change of changes){
    if(!exact(change,['id','expectedRevision','record'])||!id(change.id)||identifiers.has(change.id)||
      !(change.expectedRevision===null||revision(change.expectedRevision))||!change.record||change.record.id!==change.id)throw new AppError('INVALID');
    identifiers.add(change.id);
  }
}

export class ResearchRecords {
  constructor(workspace,evidence){this.workspace=workspace;this.evidence=evidence;}
  // Removal changes the current membership and its presentation targets. Original
  // revisions, evidence and other records' references remain available unchanged.
  async remove(command){
    if(!exact(command,['workspaceId','recordId','expectedRevision'])||!id(command.workspaceId)||!id(command.recordId)||!revision(command.expectedRevision))throw new AppError('INVALID');
    const outline=await this.workspace.outline();
    if(outline.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
    if(outline.metadata.formatVersion!==21||await this.workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
    return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
      const head=await store.head(),source=await store.snapshot(head);
      if(source.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
      const row=await store.member(source,command.recordId);
      // A lost response can be retried. An already absent record needs no write;
      // a recreated or concurrently edited record must still match the revision.
      if(row){
        const history=store.historyIndex(row.id),historyHead=await history.head(),saved=await history.lookup(historyHead,'version',row.revision);
        // The authenticated history pointer ties this original to its canonical
        // revision. Removing membership needs that identity, not all its prose.
        // Older summaries still use the history owner's compatibility reader.
        if((await history.display(saved.item)).revision!==command.expectedRevision)throw new AppError('RECORD_CHANGED',[{field:'record',recordId:command.recordId}]);
        const current=await store.indexed(source),target='entry:'+command.recordId;
        const metadata={...current.metadata,branding:current.metadata.branding.filter(b=>b.target!==target),website:{...current.metadata.website,layouts:current.metadata.website.layouts.filter(l=>l.target!==target)}};
        await reconcileWebsiteMembership(metadata,id=>id===command.recordId?null:store.member(current,id));
        await store.validateMetadata(current,metadata,{removed:[command.recordId]});
        await store.commitChanges(head,current,metadata,[],{removed:[command.recordId]});
      }
      return store.recordSelection([command.recordId]);
    }));
  }
  async save(command,{compact=false,recordIds=null,receipt=false}={}){
    if(typeof receipt!=='boolean'||receipt&&recordIds!==null)throw new AppError('INVALID');
    if(!exact(command,['workspaceId','changes',...(Object.hasOwn(command??{},'baseEtag')?['baseEtag']:[])])||!id(command.workspaceId)||!Array.isArray(command.changes)||!command.changes.length)throw new AppError('INVALID');
    validateRecordEdits(command.changes);
    if(Object.hasOwn(command,'baseEtag')&&!revision(command.baseEtag))throw new AppError('INVALID');
    if(await this.workspace.storageKind()==='catalogue'){
      const eligible=await this.workspace.catalogue(async store=>[20,21].includes((await store.snapshot()).metadata.formatVersion));
      if(eligible)return this.workspace.updateRecords(command,source=>this.prepare(source,command),{compact,recordIds,receipt,storedBases:true});
    }
    if(receipt)throw new AppError('INVALID');
    return this.workspace.update(source=>this.prepare(source,command));
  }
  // Compose the same record command with a domain receipt in an existing
  // workspace transaction. The catalogue still checks revisions and references.
  async saveLocked(command,options={}){
    validateRecordEdits(command.changes);
    if(!id(command.workspaceId)||!command.changes.length)throw new AppError('INVALID');
    return this.workspace.catalogue(store=>store.updateRecords(command,source=>this.prepare(source,command),{...options,storedBases:true}));
  }
  async prepare(source,command){
    const {partialRecords,replacementBases,...value}=source;
    // Copy the headers that this command may change, not the untouched bodies
    // of every previous record. Incoming replacements retain their own copy.
    const book=partialRecords?{...value,entries:value.entries.map(record=>({...record}))}:upgradeNotebook(value);
    if(book.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
    let changed=false;
    for(const change of command.changes){
      const index=book.entries.findIndex(record=>record.id===change.id),previous=book.entries[index],basis=replacementBases?.get(change.id);
      const priorRevision=replacementBases?basis?.revision??null:previous?recordRevision(previous):null;
      if(priorRevision!==change.expectedRevision)throw new AppError('RECORD_CHANGED',[{field:'record',recordId:change.id}]);
      const record=structuredClone(change.record);
      if(!partialRecords&&(previous?.attempt||record.attempt))await validateAttemptChange(this.workspace,book.id,previous,record);
      if(!partialRecords&&record.results)await validateResultSources(this.workspace,record);
      if(!partialRecords)await validateFigureSources(this.workspace,record);
      if(record.template){
        const {values,...schema}=record.template;
        if(basis?.templateRevision){if(recordRevision(schema)!==basis.templateRevision)throw new AppError('INVALID',[{field:'Record type snapshot',recordId:record.id}]);}
        else if(previous?.template){const {values:oldValues,...oldSchema}=previous.template;if(JSON.stringify(schema)!==JSON.stringify(oldSchema))throw new AppError('INVALID',[{field:'Record type snapshot',recordId:record.id}]);}
        else{
          const notebook=book.notebooks.find(n=>n.id===record.notebookId),section=notebook?.configuration?.sections.find(s=>s.id===record.template.id);
          if(!section?.enabled||JSON.stringify(schema)!==JSON.stringify({id:section.id,profileId:section.profileId,label:section.label,description:section.description,fields:section.fields}))throw new AppError('RECORD_CHANGED',[{field:'Lab book record type changed',recordId:record.id}]);
        }
      }

      // Moving a record cannot implicitly publish it under a different project.
      const prior=basis??previous;
      if(prior&&prior.notebookId!==record.notebookId)record.share=false;
      if(prior&&priorRevision===recordRevision(record))continue;
      if(index<0)book.entries.push(record);else book.entries[index]=record;
      changed=true;
    }
    if(!source.partialRecords)validateNotebook(book);
    // Evidence is already staged privately. Check references before making
    // them visible in the same durable record/revision commit.
    for(const change of command.changes){
      if(!Array.isArray(change.record.attachments))throw new AppError('INVALID');
      for(const attachment of change.record.attachments){
        const file=await this.evidence.get(attachment.id,{streamed:true});
        if(file.kind!==attachment.kind)throw new AppError('MEDIA_INVALID');
      }
    }
    return changed?book:null;
  }

}
