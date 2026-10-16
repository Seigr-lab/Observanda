// Owned project paths travel with their workspace. External owners retain
// explicit absolute locations; decoding a location never opens a database.
import path from 'node:path';
import {AppError} from './errors.js';
function segments(relative) {
  if(typeof relative!=='string'||!relative||/[\\:\u0000]/.test(relative))throw new AppError('FORMAT');
  const parts=relative.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))throw new AppError('FORMAT');
  return parts;
}
export function encodeProjectRegistryLocations(value,root,paths=path) {
  const saved=structuredClone(value);saved.version=value.version>=7?7:6;
  for(const entry of saved.projects) {
    if(typeof entry.root!=='string'||!paths.isAbsolute(entry.root))throw new AppError('FORMAT');
    const relative=paths.relative(root,entry.root);
    if(relative!==''&&relative!=='..'&&!relative.startsWith('..'+paths.sep)&&!paths.isAbsolute(relative)) {
      const portable=relative.split(paths.sep).join('/');segments(portable);
      entry.root={relative:portable};
    }
  }
  return saved;
}
export function decodeProjectRegistryLocations(value,root,paths=path) {
  if(![6,7].includes(value?.version))return value;
  if(!Array.isArray(value.projects))throw new AppError('FORMAT');
  const resolved=structuredClone(value);
  for(const entry of resolved.projects) {
    if(!entry||typeof entry!=='object')throw new AppError('FORMAT');
    if(typeof entry.root==='string')continue;
    if(!entry.root||typeof entry.root!=='object'||Array.isArray(entry.root)||Object.keys(entry.root).join()!=='relative')throw new AppError('FORMAT');
    const target=paths.resolve(root,...segments(entry.root.relative)),relative=paths.relative(root,target);
    if(relative===''||relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw new AppError('FORMAT');
    entry.root=target;
  }
  return resolved;
}
