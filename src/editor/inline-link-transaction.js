import {TextSelection} from 'prosemirror-state';
import {closeHistory} from 'prosemirror-history';
import {safeRichLink} from '../web/rich-text-model.js';

// Notes annotate the end of a selection. Replacing a selected word is an
// explicit reference action and must never be a side effect of adding a note.
export function inlineLinkTransaction(state,{href,label},markerAction){
 if(!safeRichLink(href)||typeof label!=='string'||!label.trim()||label.length>2000)return null;
 const {selection,schema}=state,mark=schema.marks.link;
 if(markerAction!=='remove'){
  if(!(selection instanceof TextSelection)||!selection.$to.parent.inlineContent||!selection.$to.parent.type.allowsMarkType(mark))return null;
  if(!markerAction&&!selection.$from.sameParent(selection.$to))return null;
 }
 const tr=closeHistory(state.tr);
 if(markerAction==='move'||markerAction==='remove'){
  const matches=[];
  state.doc.descendants((node,pos)=>{
   if(node.isText&&mark.isInSet(node.marks)?.attrs.href===href)matches.push({node,pos});
  });
  for(const {node,pos} of matches.reverse()){
   if(node.text===label)tr.delete(pos,pos+node.nodeSize);
   else tr.removeMark(pos,pos+node.nodeSize,mark);
  }
 }
 if(markerAction==='remove')return tr;
 if(markerAction){
  const end=tr.mapping.map(selection.to,-1);
  tr.setSelection(TextSelection.create(tr.doc,end));
 }
 const surrounding=state.storedMarks??tr.selection.$from.marks();
 const link=mark.create({href,title:'',target:'_self',nofollow:false});
 tr.replaceSelectionWith(schema.text(label,link.addToSet(surrounding)),false);
 return tr.setStoredMarks(mark.removeFromSet(surrounding));
}
