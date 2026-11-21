// Relocation receipts record each owner directory by its exact file identity.
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys;
export const validPlacementIdentity=value=>exact(value,'dev,ino')&&Object.values(value).every(part=>typeof part==='string'&&/^\d+$/.test(part));
