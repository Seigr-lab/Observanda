import {readFileSync,statSync,watchFile,unwatchFile} from 'node:fs';
import {translator,validLanguage} from './web/i18n/runtime.js';
import messages from './web/locales/en/desktopShell.json' with {type:'json'};
import errors from './web/locales/en/errors.json' with {type:'json'};

const english=translator('en',messages),progressKeys={install:'databaseInstall',extract:'databaseExtract',initialize:'databaseInitialize',start:'databaseStart',startup:'starting'};
const html=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// This reads only the existing, bounded display preference. It never repairs or
// writes preferences; the service retains responsibility for their full schema.
export function desktopLanguage(preferencesFile){
 if(!preferencesFile)return 'en';
 try{
  if(statSync(preferencesFile).size>1048576)return null;
  const value=JSON.parse(readFileSync(preferencesFile,'utf8'));
  return value?.formatVersion===1&&(value.language===undefined||validLanguage(value.language))?value.language??'en':null;
 }catch(error){return error.code==='ENOENT'?'en':null;}
}

export function desktopProgressMessage(message,text=english){
 if(message?.stage==='download'&&Number.isFinite(message.percent)&&message.percent>=0&&message.percent<=100)return text('databaseDownload',{percent:message.percent});
 if(Object.hasOwn(progressKeys,message?.stage))return text(progressKeys[message.stage]);
 return typeof message?.message==='string'?message.message.slice(0,500):text('starting');
}

export function desktopLocalization({preferencesFile,onChange=()=>{},watch=true}={}){
 const cached=new Map();let language=desktopLanguage(preferencesFile)??'en',current;
 function load(locale){
  if(!cached.has(locale)){
   const read=name=>JSON.parse(readFileSync(new URL('./web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8'));
   const localized=locale==='en'?{messages,errors}:{messages:read('desktopShell'),errors:read('errors')};
   cached.set(locale,{text:translator(locale,localized.messages,messages),errors:localized.errors,error:translator(locale,localized.errors,errors)});
  }
  return cached.get(locale);
 }
 current=load(language);
 const text=(key,parameters)=>current.text(key,parameters);
 function refresh(){const next=desktopLanguage(preferencesFile);if(next===null||next===language)return false;const loaded=load(next);language=next;current=loaded;onChange(next);return true;}
 if(watch&&preferencesFile)watchFile(preferencesFile,{persistent:false,interval:1000},refresh);
 return {
  get language(){return language;},text,refresh,
  progress:message=>desktopProgressMessage(message,text),
  error:message=>typeof message?.code==='string'&&Object.hasOwn(errors,message.code)?current.error(message.code):typeof message?.message==='string'?message.message.slice(0,1000):String(message??''),
  dispose:()=>{if(watch&&preferencesFile)unwatchFile(preferencesFile,refresh);}
 };
}

export function desktopStartupPage(language,text){
 return 'data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html lang="'+html(language)+'"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Observanda</title><style>body{font:18px system-ui;color:#263349;background:#f5f6fa;margin:12vh 10vw}h1{font-size:28px}p{line-height:1.6}</style><h1>Observanda</h1><p id="status" role="status">'+html(text('startingWorkspace'))+'</p></html>');
}

export function desktopMenuTemplate({text,platform=process.platform,quit,cancelClose,about,scheduled=false}){
 const role=(name,key)=>({role:name,label:text(key)}),separator={type:'separator'},aboutItem={label:text('about'),click:about};
 return [
  ...(platform==='darwin'?[{role:'appMenu',label:'Observanda',submenu:[aboutItem,separator,role('services','services'),separator,role('hide','hide'),role('hideOthers','hideOthers'),role('unhide','showAll'),separator,{label:text('quit'),accelerator:'CmdOrCtrl+Q',click:quit}]}]:[]),
  {label:text('fileMenu'),submenu:[{label:text('quit'),accelerator:'CmdOrCtrl+Q',click:quit},{id:'cancel-scheduled-close',label:text('cancel'),enabled:scheduled,click:cancelClose}]},
  {role:'editMenu',label:text('editMenu'),submenu:[role('undo','undo'),role('redo','redo'),separator,role('cut','cut'),role('copy','copy'),role('paste','paste'),role('pasteAndMatchStyle','pasteMatchStyle'),role('delete','delete'),separator,role('selectAll','selectAll')]},
  {label:text('viewMenu'),submenu:[role('resetZoom','resetZoom'),role('zoomIn','zoomIn'),role('zoomOut','zoomOut'),role('togglefullscreen','fullScreen')]},
  {label:text('helpMenu'),submenu:[aboutItem]}
 ];
}
