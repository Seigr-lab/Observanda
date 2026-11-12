import {wrapIn} from 'prosemirror-commands';
import {closeHistory} from 'prosemirror-history';
import {semanticAppearance,semanticNode,semanticRoles,validSemanticStyles} from '../web/semantic-text-styles.js';

const localMarks=new Set(['font_family','text_color','text_size','highlight']);

function currentStyle(selection){
 const {$from}=selection;
 for(let depth=$from.depth;depth>0;depth--){
  const node=$from.node(depth);
  if(node.attrs.semanticRole)return node.attrs.semanticRole;
 }
 return '';
}
function blockRange(selection){
 const {from,to,$from}=selection;
 return selection.empty&&$from.parent.isTextblock?{from:$from.start(),to:$from.end()}:{from,to};
}
function applyRole(state,role){
 const {schema,selection}=state,{$from,from,to}=selection,tr=state.tr;
 if(role===''){
  state.doc.nodesBetween(from,to,(node,pos)=>{
   if(!node.attrs.semanticRole)return;
   const attrs={...node.attrs,semanticRole:null};
   if(node.type===schema.nodes.heading)attrs.level=Math.max(2,Math.min(4,attrs.level));
   tr.setNodeMarkup(pos,null,attrs);
  });
  return tr;
 }
 const name=semanticNode(role);
 if(name==='blockquote'){
  for(let depth=$from.depth;depth>0;depth--){
   if($from.node(depth).type===schema.nodes.blockquote&&to<=$from.end(depth)){
    return tr.setNodeAttribute($from.before(depth),'semanticRole',role);
   }
  }
  let wrapped=null;wrapIn(schema.nodes.blockquote,{semanticRole:role})(state,next=>{wrapped=next;});return wrapped;
 }
 if(!name)return null;
 return tr.setBlockType(from,to,schema.nodes[name],old=>({
  ...old.attrs,semanticRole:role,...(name==='heading'?{level:Number(role.slice(-1))}:{})
 }));
}

export function semanticStyleEditor({view,toolbar,signal}){
 const panel=toolbar.querySelector('[data-semantic-tools]');if(!panel)return null;
 const control=name=>panel.querySelector('[data-semantic-'+name+']');
 const role=control('role'),surface=control('surface'),status=control('status');
 const fields=['size','weight','color','italic'];
 const owner=view.dom.ownerDocument,sheet=new owner.defaultView.CSSStyleSheet(),scope='rt-scope-'+crypto.randomUUID();
 view.dom.classList.add(scope);const ownerRoot=view.dom.getRootNode(),root='adoptedStyleSheets' in ownerRoot?ownerRoot:owner;
 root.adoptedStyleSheets=[...root.adoptedStyleSheets,sheet];
 signal.addEventListener('abort',()=>{root.adoptedStyleSheets=root.adoptedStyleSheets.filter(item=>item!==sheet);},{once:true});
 let definitions,previousRole,previousSelection;
 function showFields(){
  const values=view.state.doc.attrs.semanticStyles?.roles?.[role.value]?.[surface.value]??{};
  for(const field of fields)control(field).value=values[field]===undefined?'':String(values[field]);
  control('apply').disabled=!role.value&&!currentStyle(view.state.selection);control('save').disabled=!role.value;
 }
 function sync(){
  const {doc,selection}=view.state,selected=currentStyle(selection);
  const changed=doc.attrs.semanticStyles!==definitions;
  if(changed){
   definitions=doc.attrs.semanticStyles;
   const admitted=validSemanticStyles(definitions)?definitions:null;
   const rules=semanticRoles.map(name=>{
    const style=semanticAppearance(admitted,name,'reading'),declarations=[];
    if(style.size!==undefined)declarations.push('font-size:'+style.size+'px');
    if(style.weight!==undefined)declarations.push('font-weight:'+style.weight);
    if(style.color!==undefined)declarations.push('color:'+style.color);
    if(style.italic!==undefined)declarations.push('font-style:'+(style.italic?'italic':'normal'));
    return '.'+scope+' .rt-semantic-v1-'+name+'{'+declarations.join(';')+'}';
   });
   sheet.replaceSync(rules.join('\n'));
  }
  if(changed||selected!==previousRole||!selection.eq(previousSelection??selection)){
   if(selected!==previousRole||!selection.eq(previousSelection??selection))role.value=selected;
   previousRole=selected;previousSelection=selection;showFields();
  }
  const {from,to}=blockRange(selection);
  let direct=Boolean(selection.$from.parent.attrs.align&&selection.$from.parent.attrs.align!=='inherit');
  doc.nodesBetween(from,to,node=>{
   if(node.attrs.align&&node.attrs.align!=='inherit'||node.marks.some(mark=>localMarks.has(mark.type.name)))direct=true;
   return !direct;
  });
  status.textContent=direct?status.dataset.exception:status.dataset.inherited;control('clear').disabled=!direct;
 }
 function dispatch(tr){
  if(!tr?.docChanged)return;
  view.dispatch(closeHistory(tr));view.dispatch(closeHistory(view.state.tr));view.focus();
 }
 role.addEventListener('change',showFields,{signal});surface.addEventListener('change',showFields,{signal});
 control('apply').addEventListener('click',()=>dispatch(applyRole(view.state,role.value)),{signal});
 control('save').addEventListener('click',()=>{
  if(!semanticRoles.includes(role.value))return;
  const value={};
  for(const field of fields){
   const input=control(field);if(!input.reportValidity())return;
   if(input.value!=='')value[field]=field==='color'?input.value.toLowerCase():field==='italic'?input.value==='true':Number(input.value);
  }
  const current=view.state.doc.attrs.semanticStyles?.roles??{},roles={...current},targets={...roles[role.value]};
  if(Object.keys(value).length)targets[surface.value]=value;else delete targets[surface.value];
  if(Object.keys(targets).length)roles[role.value]=targets;else delete roles[role.value];
  const next={version:1,roles};if(!validSemanticStyles(next))return;
  dispatch(view.state.tr.setDocAttribute('semanticStyles',Object.keys(roles).length?next:null));
 },{signal});
 control('clear').addEventListener('click',()=>{
  const {doc,selection,schema}=view.state,tr=view.state.tr,{from,to}=blockRange(selection);
  for(const name of localMarks)tr.removeMark(from,to,schema.marks[name]);
  doc.nodesBetween(from,to,(node,pos)=>{
   if(node.attrs.align&&node.attrs.align!=='inherit')tr.setNodeAttribute(pos,'align','inherit');
  });
  dispatch(tr);
 },{signal});
 sync();return {sync};
}
