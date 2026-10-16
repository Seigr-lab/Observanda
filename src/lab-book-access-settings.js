import {OwnedAccessSettings} from './owned-access-settings.js';
import {AppError} from './errors.js';
export class LabBookAccessSettings extends OwnedAccessSettings{constructor(storage){if(!storage.labBookId||storage.projectId!==undefined)throw new AppError('INVALID');super(storage);}}
