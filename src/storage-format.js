import {hash} from 'node:crypto';
export const digest = content => hash('sha256',content,'hex');
export const serialize = value => JSON.stringify(value, null, 2) + '\n';
