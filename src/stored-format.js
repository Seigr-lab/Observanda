// Stored formats change without migrating existing data. Workspace files and
// database rows sit behind one gate: the catalogue generation, checked whenever a
// catalogue connection opens. A later release that changes any of them first
// admits a catalogue extension feature (catalogue-extensions.js), so an older
// release refuses the whole workspace as newer and never reads the changed data.
// Files read before that gate (access, catalogue binding and activation, the
// database service file, operation markers, the job queue head) and files that
// travel without their workspace (database archives, exchange packages, lab book
// folders, publication starters) carry their own version and refuse a newer one
// here, before any other check: never as damage or as an earlier format.
import {AppError} from './errors.js';
export function refuseNewerFormat(version,newest){
 if(Number.isSafeInteger(version)&&version>newest)throw new AppError('STORAGE_NEWER');
}
