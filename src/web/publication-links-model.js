// Deliberately excludes URL schemes, encoded traversal, reserved device names,
// query strings and server control files. Paths are relative to the site root.
export function legacyPagePath(value){
 return typeof value==='string'&&value.length<=500&&/^(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.html$/.test(value)&&!value.split('/').some(p=>/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))&&!/^(?:fonts|media|figures)\//i.test(value);
}
