import {fontFamily,customFontId} from './font-catalogue.js';
import {pdfSectionFontIds} from './pdf-font-model.js';
// Loaded faces belong to this editor lifetime. Exact edition requests use the
// retained PDF owner and remain valid after the research font library changes.
export function pdfEditorFonts({read,notify}){
 let owner=null,generation=0,controller=new AbortController();const loaded=new Map(),pending=new Map();
 function clear(){generation++;controller.abort();controller=new AbortController();for(const face of loaded.values())document.fonts.delete(face);loaded.clear();pending.clear();owner=null;}
 function update(selected,section,fonts){
  if(owner!==selected?.header.id){clear();owner=selected?.header.id;}if(!owner)return;
  const wanted=new Set([selected.header.layout.font,...pdfSectionFontIds(section)]),id=owner,epoch=generation,signal=controller.signal;
  for(const fontId of wanted){
   if(!customFontId(fontId)||loaded.has(fontId)||pending.has(fontId)||!selected.header.fonts?.some(pin=>pin.id===fontId))continue;
   const metadata=fonts.find(font=>font.id===fontId);if(!metadata)continue;
   const face=metadata.faces[0],revision=selected.revision;
   const task=(async()=>{const blob=await read({id,revision,fontId},{signal}),bytes=await blob.arrayBuffer();signal.throwIfAborted();const font=new FontFace(fontFamily(fontId),bytes,{style:face.style,weight:face.weight.join(' '),...(face.axes.wdth?{stretch:face.axes.wdth.min+'% '+face.axes.wdth.max+'%'}:{})});await font.load();signal.throwIfAborted();if(epoch===generation){document.fonts.add(font);loaded.set(fontId,font);}})().catch(error=>{if(!signal.aborted&&epoch===generation)notify(error.message??String(error));}).finally(()=>{if(epoch===generation)pending.delete(fontId);});pending.set(fontId,task);
  }
 }
 return {update,clear};
}
