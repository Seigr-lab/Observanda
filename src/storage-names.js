import path from 'node:path';
import {AppError} from './errors.js';

// Owner names are literal directory components, never slugs or URLs.
// Explicit path dialects also let an installed server describe its filesystem
// correctly to a browser running on a different operating system.
const dialect=platform=>platform==='win32'?path.win32:path.posix;
export function validateStorageName(name,{platform=process.platform,nameError='FOLDER_NAME'}={}){
 if(typeof name!=='string'||!name.length||name!==name.trim()||name.length>160||!name.isWellFormed()||/[\x00-\x1f\x7f/]/.test(name)||name==='.'||name==='..')throw new AppError(nameError);
 if(platform==='win32'&&(/[<>:"\\|?*]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)))throw new AppError(nameError);
 if(platform!=='win32'&&Buffer.byteLength(name,'utf8')>255)throw new AppError(nameError);
 return name;
}
function absolutePath(root,platform){
 const paths=dialect(platform);
 if(typeof root==='string'&&platform==='win32')root=root.replaceAll('/','\\');
 if(typeof root!=='string'||!paths.isAbsolute(root)||/[\x00-\x1f]/.test(root)||platform==='win32'&&(!/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(root)||/^\\\\[?.][\\/]/.test(root)))throw new AppError('STORAGE_PATH');
 return paths.resolve(root);
}
export function storageFolderName(root,{platform=process.platform}={}){
 const paths=dialect(platform),resolved=absolutePath(root,platform),name=paths.basename(resolved);
 if(resolved===paths.parse(resolved).root||!name)throw new AppError('STORAGE_PATH');
 return name;
}
export function storageCreationPath(parent,name,{platform=process.platform,nameError='FOLDER_NAME'}={}){
 const paths=dialect(platform);validateStorageName(name,{platform,nameError});
 // Validate before joining: joining 'C:' with a child can conceal its
 // drive-relative meaning. Root directories remain valid parents.
 if(typeof parent!=='string'||!parent||parent.length>4096)throw new AppError('STORAGE_PATH');
 absolutePath(parent,platform);
 const result=paths.join(paths.resolve(parent),name);
 if(paths.basename(result)!==name||paths.dirname(result)!==paths.resolve(parent)||result.length>4096)throw new AppError('STORAGE_PATH');
 return result;
}
export function requireStorageName(root,name,options={}){
 validateStorageName(name,options);
 if(storageFolderName(root,options)!==name)throw new AppError(options.mismatchError??'STORAGE_NAME_MISMATCH');
 return root;
}
