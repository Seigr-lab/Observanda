import {validMaterialReference} from './material-reference.js';

export const sampleSourceRoles = ['method', 'calibration', 'evidence', 'reading'];

export function validSampleSource(role, source) {
  const ref = source?.ref;
  if (!sampleSourceRoles.includes(role) || !ref?.workspaceId || !validMaterialReference(ref) ||
      Object.keys(ref).length !== 4 || !['workspaceId','kind','id','revision'].every(key=>Object.hasOwn(ref,key))) return false;
  if (role === 'reading' && ref.kind === 'dataset') {
    const s = source.cell;
    return Object.keys(source).length === 2 && !!s && Object.keys(s).length === 3 &&
      ['page','row','column'].every(key=>Number.isSafeInteger(s[key]) && s[key] >= 0) && s.row < 256;
  }
  return Object.keys(source).length === 1 && (role !== 'reading' || ref.kind === 'analysis') &&
    (role !== 'method' || ref.kind === 'record');
}

export function validSampleSources(sources) {
  return !!sources && typeof sources === 'object' && !Array.isArray(sources) &&
    Object.keys(sources).length > 0 && Object.entries(sources).every(([role,source])=>validSampleSource(role,source));
}
