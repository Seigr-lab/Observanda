import {AppError} from './errors.js';
import {MAX_FONT_BYTES} from './font-inspector.js';
import {hasPrivateText} from './privacy-text.js';
import {bundledFonts} from './fonts.js';
import {BUNDLED_FONTS,customFontId,faceCSS,validCustomFont} from './web/font-catalogue.js';
import {digest} from './storage-format.js';

const rightsKinds=new Set(['open-license','organization','permission']);
const bundled=new Map(BUNDLED_FONTS.map(font=>[font.id,font]));
export const bundledStyleFile=name=>bundledFonts.has(name);
const fail=code=>{throw new AppError(code);};
const noticePath=id=>'licenses/'+id+'.txt';
export const validStyleFont=font=>validCustomFont(font)&&!font.restricted&&!font.hidden&&rightsKinds.has(font.rights)&&typeof font.notice==='string'&&font.notice.length<=16384&&(!font.embed||font.rights!=='open-license'||Boolean(font.notice.trim()));

export async function prepareStyleFont({encoded,embed,rights,notice='',signal,blockedValues=[]}){
 if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_FONT_BYTES/3)*4||typeof embed!=='boolean'||!rightsKinds.has(rights)||typeof notice!=='string'||notice.length>16384)fail('INVALID');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length>MAX_FONT_BYTES||bytes.toString('base64')!==encoded)fail('FONT_INVALID');
 const {inspectUploadedFont}=await import('./workspace-fonts.js');
 const info=await inspectUploadedFont(bytes,{signal});
 if(info.restricted)fail('FONT_EMBED');
 if(info.extraMetadata||hasPrivateText(info.metadata,blockedValues)||hasPrivateText(notice,blockedValues))fail('PRIVACY');
 const id='custom-'+info.sha256;
 const font={id,label:info.label,embed,restricted:false,hidden:false,rights,notice:notice.trim(),faces:[{file:id+'.'+info.extension,style:info.style,weight:info.weight,axes:info.axes}]};
 if(!validStyleFont(font))fail('INVALID');
 return {font,bytes};
}

export function fontDefinitions(token,custom){
 const fonts=new Set(Object.values(token.rules).map(state=>state['font-family']).filter(Boolean));
 const css=[],files=new Map();
 for(const id of fonts){
  const stock=bundled.get(id),font=stock??custom.get(id);
  if(!font){if(customFontId(id))fail('FONT_MISSING');continue;}
  if(!stock&&!font.embed)continue;
  for(const face of font.faces){
   const name='fonts/'+face.file;
   files.set(name,stock?bundledFonts.get(name):null);
   css.push(faceCSS(id,face,'../'+name));
  }
  if(stock)files.set('fonts/'+stock.license,bundledFonts.get('fonts/'+stock.license));
  else if(font.notice)files.set(noticePath(id),font.notice);
 }
 return {css:css.join('\n'),files};
}

// A site can also have a pre-existing, deliberately included font for
// hand-authored CSS. Never withdraw or change the owner of that file.
export async function syncFontFiles(store,site,files,required,custom,signal){
 const byName=new Map(files.map(f=>[f.name,f])),retained=new Set();
 for(const font of custom.values())retained.add('fonts/'+font.faces[0].file);
 for(const [name,{value,publicUse}] of required){
  const old=byName.get(name),sha=value===null?name.slice('fonts/custom-'.length).split('.')[0]:digest(value);
  if(old&&(old.sha256!==sha||old.sourceId||old.feedAsset)&&!(old.tokenFont&&name.startsWith('licenses/')))fail('CONFLICT');
  if(old&&!old.tokenFont){if(old.draft&&publicUse)fail('CONFLICT');continue;}
  if(old?.sha256===sha){byName.set(name,await store.ownFile(site,old,!publicUse,signal));continue;}
  if(value===null)fail('FONT_MISSING');
  byName.set(name,{...await store.siteFile(site,name,value,{draft:!publicUse,signal}),tokenFont:true});
 }
 for(const [name,file] of byName){
  if(!file.tokenFont||required.has(name))continue;
  if(retained.has(name))byName.set(name,await store.ownFile(site,file,true,signal));else byName.delete(name);
 }
 return [...byName.values()];
}
