import {WorkspaceFonts} from '../workspace-fonts.js';
import {customFontId} from '../web/font-catalogue.js';
import {contentBuffer} from '../file-content.js';
import {AppError} from '../errors.js';

// Read a package's font library without installing it in the recipient's
// workspace. Only fonts used by the reviewed record can be served.
export function reviewFonts(workspace,parts,record){
 const used=new Set();
 function visit(value){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(['font','headingFont'].includes(key)&&customFontId(item))used.add(item);else visit(item);}}
 visit(record);
 const source=parts?{async readMetadata(name,max){const item=await parts.descriptor('metadata',name);if(!item)return null;if(item.size>max)throw new AppError('LIMIT');return (await contentBuffer(parts.content(item))).toString('utf8');}}:workspace;
 const fonts=new WorkspaceFonts(source);
 return {async list(){return (await fonts.list()).filter(f=>used.has(f.id));},async get(id){if(!used.has(id))throw new AppError('NOT_FOUND');return fonts.get(id);}};
}
