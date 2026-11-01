import {NativeMediaAdmission} from './native-media-admission.js';
import {nativeResources} from './native-resource-budget.js';

// Whole-buffer operations share the native memory budget with managed databases
// and converters. Streaming originals do not acquire a whole-file reservation.
// This bounds admitted live work; it is not an OS limit on retained JS objects.
export const contentBufferAdmission=new NativeMediaAdmission({kind:'buffer',active:4,queued:8,memoryBytes:nativeResources.memoryBytes,budget:nativeResources});
