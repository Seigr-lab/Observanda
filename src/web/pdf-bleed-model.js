const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const colour=value=>typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value);
export function pdfBleedArtworkDefaults(){return {background:'#ffffff',image:null,pages:'all'};}
export function validPdfBleedArtwork(value){return !!exact(value,'background,image,pages')&&colour(value.background)&&['all','first','except-first'].includes(value.pages)&&(value.image===null||exact(value.image,'asset,crop')&&/^[a-f0-9]{64}$/.test(value.image.asset)&&exact(value.image.crop,'x,y')&&Object.values(value.image.crop).every(number=>Number.isFinite(number)&&number>=0&&number<=100));}
export function pdfBleedPage(artwork,index){return artwork.pages==='all'||(artwork.pages==='first'?index===0:index>0);}
// Crop percentages follow the editor: x=0 is left, y=0 is top. PDF coordinates
// start at the bottom, so vertical alignment deliberately reverses the offset.
export function pdfBleedImageBox(box,image,crop){
 const scale=Math.max(box.width/image.width,box.height/image.height),width=image.width*scale,height=image.height*scale;
 return {x:box.x+(box.width-width)*crop.x/100,y:box.y+(box.height-height)*(1-crop.y/100),width,height};
}
export function pdfBleedBackgroundCSS(press,name,background){
 if(press?.version!==2)return '';
 if(!validPdfBleedArtwork(press.artwork)||!/^($|pdf-layout-[0-9]+)$/.test(name)||!colour(background))throw Error('PDF_PRESS');
 const selector='@page '+name;
 if(press.artwork.pages==='first')return selector+':first{background:transparent}';
 return selector+'{background:transparent}'+(press.artwork.pages==='except-first'?selector+':first{background:'+background+'}':'');
}
