import {REGION_SLOTS} from './website-regions.js';
// Navigation hints contain no authored content. Retain a bounded recent set;
// forgetting a hint never removes a page, selection edit or unsaved draft.
const tools=new Set(['page','selection','insert','site','typography','layout','page-settings','library','content','media','menu','gallery','actions']);
const path=value=>typeof value==='string'&&/^(index\.html|(?:projects|notebooks|entries|pages)\/[a-f0-9-]{36}\.html)$/.test(value);
const label=value=>typeof value==='string'&&value.length<=160?value:null;
function normalized(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const media=value.media&&typeof value.media==='object'&&!Array.isArray(value.media)&&label(value.media.id)&&label(value.media.scope)?
  {id:value.media.id,scope:value.media.scope,...(label(value.media.entryId)?{entryId:value.media.entryId}:{})}:null;
 return {area:['body',...REGION_SLOTS].includes(value.area)?value.area:'body',section:label(value.section),media,
  tool:tools.has(value.tool)?value.tool:'page',sectionTab:['content','layout','style','link'].includes(value.sectionTab)?value.sectionTab:'content',
  typeTab:['fonts','size','spacing','colors'].includes(value.typeTab)?value.typeTab:'fonts',
  designTab:['layout','colors'].includes(value.designTab)?value.designTab:'layout',
  scroll:Number.isFinite(value.scroll)?Math.max(0,Math.min(1e7,value.scroll)):0};
}
export class WebsitePageContexts {
 #values=new Map();
 constructor({maxEntries=24}={}){if(!Number.isSafeInteger(maxEntries)||maxEntries<1)throw new TypeError('Invalid context budget');this.maxEntries=maxEntries;}
 get size(){return this.#values.size;}
 clear(){this.#values.clear();}
 get(key){return this.#values.get(key)??null;}
 set(key,value){
  if(!path(key))return;
  const clean=normalized(value);if(!clean)return;
  this.#values.delete(key);this.#values.set(key,clean);
  while(this.#values.size>this.maxEntries)this.#values.delete(this.#values.keys().next().value);
 }
 restore(value){
  this.clear();if(!value||typeof value!=='object'||Array.isArray(value))return;
  for(const [key,context] of Object.entries(value).slice(-this.maxEntries))this.set(key,context);
 }
 toJSON(){return Object.fromEntries(this.#values);}
}
