import {validFont,validAxes,fontStack,variationCSS} from './font-catalogue.js';

export const ACTION_KINDS=['link','hero','popup','copy-text','download'];
export const ACTION_NUMBERS={fontSize:1,fontWeight:1,lineHeight:.1,letterSpacing:-100,paddingX:0,paddingY:0,borderWidth:0,radius:0};
export const ACTION_COLORS=['color','background','borderColor','hoverColor','hoverBackground','hoverBorderColor'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validActionStyle(style){
 return object(style)&&Object.entries(style).every(([key,value])=>{
  if(key==='font')return validFont(value);if(key==='fontAxes')return validAxes(value);
  if(Object.hasOwn(ACTION_NUMBERS,key))return Number.isFinite(value)&&value>=ACTION_NUMBERS[key]&&(key!=='fontWeight'||value<=1000);
  if(ACTION_COLORS.includes(key))return typeof value==='string'&&(/^(#[a-f0-9]{6}|transparent)$/i.test(value));
  return key==='underline'?typeof value==='boolean':key==='width'?['auto','full'].includes(value):key==='borderStyle'?['solid','dashed','dotted','double'].includes(value):false;
 });
}
export function validAction(value,{close=false}={}){
 return object(value)&&Object.entries(value).every(([key,v])=>key==='appearance'?['link','button'].includes(v):key==='arrow'?!close&&typeof v==='boolean':['style','linkStyle'].includes(key)?validActionStyle(v):close&&key==='content'?['icon','text','both'].includes(v):close&&key==='label'?typeof v==='string'&&v.length<=160&&!/[\x00-\x1f]/.test(v):false);
}
export const actionAppearance=(section,close=false)=>close?section.close?.appearance??'link':section.action?.appearance??'button';
export const actionClasses=(section,close=false)=>'site-action site-action--'+actionAppearance(section,close)+(close?' public-popup-close':'');
export const actionArrow=section=>section.action?.arrow??section.kind==='link';
export const actionStyleKey=(section,close=false)=>actionAppearance(section,close)==='link'?'linkStyle':'style';
export const actionStyle=(section,close=false)=>section[close?'close':'action']?.[actionStyleKey(section,close)]??{};
export function actionFonts(design,sections){return [design.buttons?.font,design.links?.font,...sections.flatMap(s=>[actionStyle(s).font,actionStyle(s,true).font])].filter(Boolean);}
export function sectionActionRules(section,root){
 const rules=[],selector={download:' > .site-action',link:' > .site-action',hero:' > .hero-copy > .site-action',popup:' > details > summary.site-action','copy-text':' > .public-copy > .site-action'}[section.kind];
 const render=close=>actionStyleRules(actionStyle(section,close),'action',actionAppearance(section,close));
 if(selector&&Object.keys(actionStyle(section)).length)rules.push(root+selector+'{'+render(false)+'}');
 if(section.kind==='popup'&&Object.keys(actionStyle(section,true)).length)rules.push(root+' > .public-popup > .popup-body > .popup-controls > .site-action,'+root+' > details > .popup-body > .popup-controls > .site-action{'+render(true)+'}');
 return rules;
}
// Emit variables, not author-supplied CSS. Link and button defaults have separate
// scopes, so changing button colours cannot turn ordinary text links into buttons.
export function actionStyleRules(style={},prefix='action',appearance=prefix==='link'?'link':'button'){
 const declarations=[];
 for(const[key,value]of Object.entries(style)){
  if(appearance==='link'&&!['font','fontAxes','fontSize','fontWeight','lineHeight','letterSpacing','color','hoverColor','underline','width'].includes(key))continue;
  const name=key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());let css=value;
  if(key==='font')css=fontStack(value);else if(key==='fontAxes')css=variationCSS(value);
  else if(['fontSize','letterSpacing','paddingX','paddingY','borderWidth','radius'].includes(key))css=value+'px';
  else if(key==='width')css=value==='full'?'100%':'auto';else if(key==='underline')css=value?'underline':'none';
  declarations.push('--'+prefix+'-'+name+':'+css);
 }
 // The shared font owner routes wght through font-weight, leaving other
 // variation axes in font-variation-settings. A new family resets its axes.
 if(style.font!==undefined&&style.fontAxes===undefined)declarations.push('--'+prefix+'-font-axes:normal');
 if(style.fontWeight===undefined&&style.fontAxes?.wght!==undefined)declarations.push('--'+prefix+'-font-weight:'+style.fontAxes.wght);
 return declarations.join(';');
}
