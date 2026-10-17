// Research snapshots carry hierarchy and record membership. Website originals
// have separate authenticated owners; their fields here are neutral schema
// defaults, never a second current copy of any site's authored document.
import {startingAppearance} from './web/themes.js';
import {websiteDefaults,emptyHomepage,siteLayoutDefaults} from './web/website-model.js';
import {presentationDefaults} from './web/media-presentation.js';
import {WEBSITE_DOCUMENT_FIELDS} from './web/website-sites-model.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';

export function websiteMetadataShell(metadata){
 const {websites,...base}=metadata;void websites;
 return {...base,website:{...websiteDefaults(),home:emptyHomepage(),design:siteLayoutDefaults(),assets:[],layouts:[],templates:[],typography:{},presentation:presentationDefaults(),palette:{},logoId:null,logoAlt:'',footer:'',navigation:[]},pages:[],branding:[],appearance:startingAppearance('research'),themes:[],activeThemeId:null};
}
export function assertWebsiteMetadataShell(metadata){
 const shell=websiteMetadataShell(metadata);
 if(Object.hasOwn(metadata,'websites')||WEBSITE_DOCUMENT_FIELDS.some(key=>serialize(metadata[key])!==serialize(shell[key])))throw new AppError('INVALID');
}
// Capture existing consent once during the explicit writer transition. Only
// admitted publication summaries are read; no original prose/media is loaded.
export async function defaultWebsiteSelection(store,snapshot,{signal}={}){
 const selection={defaultShare:false,includeProjects:[],records:[]};
 for await(const row of store.members(snapshot,{signal})){
  signal?.throwIfAborted();if(row.share===false)continue;
  for await(const value of store.queryDocuments([row],snapshot.metadata,{signal,search:false,publication:true})){
   if(!value.share)continue;selection.records.push({id:row.id,share:true,attachments:(value.publication?.attachments??[]).map(({id,share})=>({id,share}))});
  }
 }
 return selection;
}
// An older default editor sent sparse changes against original sharing flags.
// Preserve its pinned base choices while making the new owner self-contained.
export function mergeLegacyWebsiteSelection(base,changes){
 if(!changes)return structuredClone(base);
 const records=new Map(base.records.map(value=>[value.id,structuredClone(value)]));
 for(const change of changes.records){
  const previous=records.get(change.id),attachments=new Map((previous?.attachments??[]).map(value=>[value.id,value]));
  for(const value of change.attachments)attachments.set(value.id,structuredClone(value));
  records.set(change.id,{id:change.id,share:change.share??previous?.share??null,attachments:[...attachments.values()]});
 }
 return {defaultShare:false,includeProjects:[...changes.includeProjects],records:[...records.values()]};
}
