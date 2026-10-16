import {LabBookStorage} from './lab-book-storage.js';
import {ownedStorageTransfer} from './owned-storage-transfer.js';
import {LAB_BOOK_ARCHIVE_IDENTITY,readLabBookArchiveIdentity,writeLabBookArchiveIdentity} from './lab-book-archive.js';
const transfer=ownedStorageTransfer({Storage:LabBookStorage,placement:'lab-book',ownerId:'labBookId',archiveFile:LAB_BOOK_ARCHIVE_IDENTITY,readArchive:readLabBookArchiveIdentity,writeArchive:writeLabBookArchiveIdentity});
export const copyLabBookLocation=transfer.copy;
export const labBookTransferReceipt=transfer.receipt;
export const verifyLabBookTransfer=transfer.verify;
