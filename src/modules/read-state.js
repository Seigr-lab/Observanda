// Only explicitly admitted, fixed read-only domain snapshots share these
// encrypted rows. Mutable command transactions always read current state.
export function moduleStateRow(store,slot){
 const load=()=>store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
 return store.readOnly&&store.readCache?store.readCache.row(slot,load):load();
}
