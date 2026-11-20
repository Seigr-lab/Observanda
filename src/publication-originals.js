// A published record can be narrowed by sharing choices without creating a
// research revision. The narrowed derivative stays privately bound to its
// original, so revision checks always use the original; callers cannot forge
// this link.
const originals=new WeakMap();
export const publicationOriginal=record=>originals.get(record)??record;
export function publicationDerivative(record,original){originals.set(record,publicationOriginal(original));return record;}
