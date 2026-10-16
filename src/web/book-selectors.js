import {researchId} from './research-reference.js';
export const SELECTOR_KINDS=['section','figure','table','equation','citation','block'];
export const validBookSelector=v=>v&&Object.keys(v).sort().join()==='id,kind,version'&&v.version===1&&SELECTOR_KINDS.includes(v.kind)&&researchId(v.id);
export const selectorAnchor=s=>s.kind==='section'?'record-section-'+s.id:'record-'+s.kind+'-'+s.id;
export function bookSelectors(record){
 const result=(record.sections??[]).map(s=>({version:1,kind:'section',id:s.id,label:s.title}));
 for(const f of record.figures??[])result.push({version:1,kind:'figure',id:f.id,label:f.title});
 for(const a of record.attachments??[])if(a.kind==='image')result.push({version:1,kind:'figure',id:a.id,label:a.caption||a.alt});
 const visit=node=>{if(node?.attrs?.id){const kind={heading:'section',book_table:'table',book_equation:'equation',book_citation:'citation',book_preserved:'block',book_sketch:'block'}[node.type];if(kind)result.push({version:1,kind,id:node.attrs.id,label:node.attrs.title||node.attrs.label||(node.content??[]).map(n=>n.text??'').join('')});}for(const n of node?.content??[])visit(n);};
 for(const doc of [record.body,...(record.sections??[]).map(s=>s.body)])if(typeof doc==='object')visit(doc);
 return result;
}
export const selectorExists=(record,s)=>!s||(record.selectors??bookSelectors(record)).some(v=>v.kind===s.kind&&v.id===s.id);
export function placedFigures(record){const ids=new Set();const visit=n=>{if(n?.type==='book_figure')ids.add(n.attrs.figureId);for(const c of n?.content??[])visit(c);};for(const d of [record.body,...(record.sections??[]).map(s=>s.body)])visit(d);return ids;}
