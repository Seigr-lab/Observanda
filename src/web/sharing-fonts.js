import {fontFamily} from './font-catalogue.js';

export function sharingFonts(){
 const loaded=new Map();let generation=0;
 return {
  async add(fonts,url){
   const version=generation;
   for(const font of fonts){
    if(version!==generation)return;
    if(loaded.has(font.id))continue;
    const face=font.faces[0],descriptors={weight:face.weight.join(' '),style:face.style};
    if(face.axes.wdth)descriptors.stretch=face.axes.wdth.min+'% '+face.axes.wdth.max+'%';
    const value=new FontFace(fontFamily(font.id),'url("'+url(font.id)+'")',descriptors);loaded.set(font.id,value);document.fonts.add(value);await value.load();
   }
  },
  clear(){generation++;for(const value of loaded.values())document.fonts.delete(value);loaded.clear();}
 };
}
