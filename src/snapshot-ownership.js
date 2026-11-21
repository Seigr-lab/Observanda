// Every catalogue member carries its lab book ownership key. Writers that move
// or count members by lab book refuse a membership whose ownership disagrees.
import {SnapshotIndex} from './snapshot-index.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};

export async function assertSnapshotOwnership(store,snapshot){
 if(await new SnapshotIndex(store).scopedCount(snapshot.membership)!==snapshot.count)damaged();
}
