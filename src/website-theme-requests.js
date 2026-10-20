import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {AppError} from './errors.js';
import {WebsiteThemeExchange} from './website-theme-exchange.js';
import {WEBSITE_THEME_MIME} from './web/website-theme-model.js';
export async function websiteThemeRequest(req,res,{workspace,url,body,json,check=async()=>{},blockedValues=[]}){
 const route=typeof url==='string'?new URL(url,'http://localhost').pathname:url.pathname;
 if(!route.startsWith('/api/websites/themes/'))return false;
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort(new DOMException('Theme request ended','AbortError'));};
 req.once('aborted',abort);res.once('close',abort);
 try{
  await check();if(req.method!=='POST')throw new AppError('NOT_FOUND');const service=new WebsiteThemeExchange(workspace,{blockedValues,check}),options={signal:controller.signal};
  if(route==='/api/websites/themes/import'){
   if(req.headers['content-type']?.split(';')[0]!==WEBSITE_THEME_MIME||typeof req.headers['x-observanda-theme-target']!=='string'||req.headers['x-observanda-theme-target'].length>16384)throw new AppError('INVALID');
   let target;try{target=JSON.parse(req.headers['x-observanda-theme-target']);}catch{throw new AppError('INVALID');}json(await service.import(req,target,options));return true;
  }
  const value=await body();
  if(route==='/api/websites/themes/export/prepare')json(await service.prepare(value,options));
  else if(route==='/api/websites/themes/export'){const result=await service.export(value,options);res.writeHead(200,{'Content-Type':WEBSITE_THEME_MIME,'Content-Disposition':'attachment; filename="observanda-theme.obsvtheme"','Cache-Control':'no-store'});await pipeline(Readable.from(result.stream),res,{signal:controller.signal});}
  else if(route==='/api/websites/themes/discard'){await service.discard(value);json({discarded:true});}
  else throw new AppError('NOT_FOUND');return true;
 }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
}
