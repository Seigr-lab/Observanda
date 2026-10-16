// Three-way record reconciliation. Conflicts are decisions, never last-write-wins.
import {retainRecord,retainOwnedRecord,sameValue as same} from './workspace-snapshot.js';
import {recordRecoveryMessage,recordConflictLabel} from './record-recovery-messages.js';
import {mergeAttemptAdditions} from './attempt-model.js';
const copy=value=>value===undefined?undefined:structuredClone(value);
const content=record=>record?Object.fromEntries(Object.entries(record).filter(([key])=>!['createdAt','updatedAt'].includes(key))):record;
export const sameRecord=(a,b)=>same(content(a),content(b));

export function reconcileRecords(changes,current,{message=recordRecoveryMessage,owned=false}={}){
  const retain=owned?retainOwnedRecord:retainRecord;
  changes=changes.map(change=>({...change,base:change.base?retain(change.base):null,record:retain(change.record)}));
  const labelFor=key=>recordConflictLabel(key,message);
  const conflicts=[],values=new Map(),decisions=new Map(),summaries=[],changesById=new Map(changes.map(change=>[change.record.id,change]));
  const originals=new Map(current.map(record=>[record.id,retain(record)]));
  function choose(path,label,base,mine,stored){
    const key=JSON.stringify(path);
    if(!values.has(key)){
      // Reorder choices are newly constructed ID arrays; other choices already
      // belong to an immutable source snapshot.
      for(const item of [base,mine,stored])if(item&&typeof item==='object'&&!Object.isFrozen(item))Object.freeze(item);
      values.set(key,{base,mine,stored});
      // The plan owns immutable source snapshots. Materialize a detached value
      // only when a caller inspects that conflict, never all figure/table data.
      conflicts.push(Object.defineProperties({key,label,recordTitle:changesById.get(path[0])?.record.title||message('untitled')},Object.fromEntries(['base','mine','stored'].map(version=>[version,{enumerable:true,get:()=>copy(values.get(key)[version])}]))));
    }
    return decisions.has(key)?decisions.get(key):stored;
  }
  function value(base,mine,stored,path,label){
    if(same(mine,base))return stored;
    if(same(stored,base)||same(mine,stored))return mine;
    return choose(path,label,base,mine,stored);
  }
  function items(base,mine,stored,path,label,{atomic=false}={}){
    const b=new Map(base.map(item=>[item.id,item])),m=new Map(mine.map(item=>[item.id,item])),s=new Map(stored.map(item=>[item.id,item]));
    const merged=new Map();
    for(const id of new Set([...b.keys(),...m.keys(),...s.keys()])){
      const prior=b.get(id),local=m.get(id),latest=s.get(id),name=local?.title||latest?.title||local?.name||latest?.name||local?.label||latest?.label||local?.caption||latest?.caption||label;
      let next;
      if(prior&&local&&latest&&!atomic){
        next={id};
        for(const key of new Set([...Object.keys(prior),...Object.keys(local),...Object.keys(latest)]))if(key!=='id'){
          const selected=value(prior[key],local[key],latest[key],[...path,id,key],message('fieldPath',{name,field:labelFor(key)}));
          if(selected!==undefined)next[key]=selected;
        }
      }else next=value(prior,local,latest,[...path,id],prior&&local&&latest?name:message('addedRemoved',{name}));
      if(next)merged.set(id,next);
    }
    // Compare reordering independently of additions and removals.
    const common=base.map(item=>item.id).filter(id=>m.has(id)&&s.has(id)&&merged.has(id));
    const commonIds=new Set(common),mineOrder=mine.map(item=>item.id).filter(id=>commonIds.has(id)),storedOrder=stored.map(item=>item.id).filter(id=>commonIds.has(id));
    const order=value(common,mineOrder,storedOrder,[...path,'order'],message('order',{name:label}));
    // Insert new/surviving items beside their previous neighbour.
    // A linked order preserves the same insertion semantics without rescanning
    // and shifting every prior section for each added item in a long record.
    const next=new Map(order.map((id,i)=>[id,order[i+1]??null]));let first=order[0]??null;
    for(const source of [stored,mine,base]){
      let previous=null;
      for(const item of source){
        if(!merged.has(item.id))continue;
        if(!next.has(item.id)){
          next.set(item.id,previous===null?first:next.get(previous));
          if(previous===null)first=item.id;else next.set(previous,item.id);
        }
        previous=item.id;
      }
    }
    const result=[];for(let id=first;id!==null;id=next.get(id))result.push(merged.get(id));return result;
  }
  function build({materialize=false}={}){
    const result=new Map(originals);
    for(const change of changes){
      const {base,record:mine}=change,stored=result.get(mine.id);
      if(sameRecord(base,mine))continue;
      let record;
      if(base&&stored){
        record={...stored};
        for(const key of new Set([...Object.keys(base),...Object.keys(mine),...Object.keys(stored)])){
          if(['id','createdAt','updatedAt'].includes(key))continue;
          const attempt=key==='attempt'?mergeAttemptAdditions(base[key],mine[key],stored[key]):null;
          // The retained source, numerical text and table are one result claim.
          // Merge independent claims; never synthesize a mixed evidence tuple.
          const results=key==='results'&&mine[key]?.version===1&&stored[key]?.version===1&&(base[key]===undefined||base[key]?.version===1)
            ?{version:1,statements:items(base[key]?.statements??[],mine[key].statements,stored[key].statements,[mine.id,key,'statements'],labelFor(key),{atomic:true})}:null;
          const selected=results??attempt??(['sections','attachments','contributors','relations','figures'].includes(key)&&[base[key],mine[key],stored[key]].every(Array.isArray)
            ?items(base[key],mine[key],stored[key],[mine.id,key],labelFor(key))
            :value(base[key],mine[key],stored[key],[mine.id,key],labelFor(key)));
          if(selected===undefined)delete record[key];else record[key]=selected;
        }
      }else if(!base&&!stored)record=mine;
      else if(sameRecord(mine,stored))record=stored;
      else record=choose([mine.id],message(stored?'createdBoth':'removedRecord',{name:mine.title||message('untitled')}),base,mine,stored);
      if(record){
        // Restoring a removed record or changing its notebook requires a fresh
        // sharing decision. Do not republish it by resolving a conflict.
        if(base&&!stored||stored&&record.notebookId!==stored.notebookId)record={...record,share:false};
        result.set(record.id,materialize?copy(record):record);
      }else result.delete(mine.id);
    }
    return [...result.values()];
  }
  for(const change of changes){
    const stored=originals.get(change.record.id);
    summaries.push({title:change.record.title||message('untitled'),local:[...new Set([...Object.keys(change.record),...Object.keys(change.base??{})])].filter(key=>!['id','createdAt','updatedAt'].includes(key)&&!same(change.record[key],change.base?.[key])).map(key=>labelFor(key)),remote:change.base&&stored?[...new Set([...Object.keys(stored),...Object.keys(change.base)])].filter(key=>!['id','createdAt','updatedAt'].includes(key)&&!same(stored[key],change.base[key])).map(key=>labelFor(key)):[]});
  }
  build();
  return {conflicts,summaries,inspect(key,version){
    if(!values.has(key)||!['base','mine','stored'].includes(version))throw new Error(message('chooseAll'));
    return values.get(key)[version];
  },resolve(choices){
    decisions.clear();
    for(const conflict of conflicts){
      if(!choices.has(conflict.key))throw new Error(message('chooseAll'));
      decisions.set(conflict.key,choices.get(conflict.key));
    }
    return build({materialize:true});
  },resolveVersions(choices){
    decisions.clear();
    for(const conflict of conflicts){
      const choice=choices.get(conflict.key);
      if(!choice||!['mine','stored','combined'].includes(choice.version))throw new Error(message('chooseAll'));
      decisions.set(conflict.key,choice.version==='combined'?choice.value:values.get(conflict.key)[choice.version]);
    }
    return build({materialize:true});
  }};
}
