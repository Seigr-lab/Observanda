import {proseDocument} from './prose-model.js';
import {revisionText} from './revision-model.js';

export function hasPdfPlacements(section) {
  return Boolean(section?.composition || section?.pagination?.rules.length ||
    section?.images?.length || section?.notes?.length);
}

// Boxes and paragraph rules address blocks. Pictures and note calls address
// the gap between two blocks. Check both sides of a gap, including the end.
function placementChanged(previous, next) {
  if (!hasPdfPlacements(previous) || previous.content === next.content) return false;
  const before = proseDocument(previous.content).content ?? [];
  const after = proseDocument(next.content).content ?? [];
  const previousKeys = before.map(revisionText), currentKeys = after.map(revisionText);
  if (previousKeys.length === currentKeys.length && previousKeys.every((key,index)=>key === currentKeys[index])) return false;
  let repeated;
  function different(index) {
    const key = previousKeys[index];
    if (key !== currentKeys[index]) return true;
    if (key === undefined) return false;
    // Indistinguishable paragraphs can exchange places across an edit. A
    // matching text fragment in such a position does not prove identity.
    if (!repeated) {
      repeated = new Set();
      for (const keys of [previousKeys,currentKeys]) {
        const seen = new Set();
        for (const item of keys) { if (seen.has(item)) repeated.add(item); seen.add(item); }
      }
    }
    return repeated.has(key);
  }
  if (previous.composition && next.composition &&
      (before.length !== after.length || before.some((_, index) => different(index)))) return true;
  if (previous.pagination && next.pagination) {
    const existing = new Set(previous.pagination.rules.map(rule => rule.block));
    if (next.pagination.rules.some(rule => existing.has(rule.block) &&
        (different(rule.block) || (rule.keepWithNext && different(rule.block + 1))))) return true;
  }
  function changedGap(oldItems, newItems, getPosition) {
    const oldPositions = new Map((oldItems ?? []).map(item => [item.id, getPosition(item)]));
    return (newItems ?? []).some(item => {
      if (!oldPositions.has(item.id)) return false;
      const block = getPosition(item), left = Math.min(before.length, oldPositions.get(item.id)), right = Math.min(after.length, block);
      return left !== right || different(right - 1) || different(right);
    });
  }
  return changedGap(previous.notes, next.notes, note => note.block) ||
    changedGap(previous.images, next.images, image => image.position.block);
}

// Persist only the need for review. Historical prose or withdrawn source
// excerpts must never travel in a warning. Confirmation is a revision-bound
// command; an ordinary save cannot clear an outstanding review.
export function reconcilePdfPlacements(previous, next) {
  if (hasPdfPlacements(next)) {
    if (next.placementReview || !(previous?.placementReview || placementChanged(previous, next))) return next;
    return {...next, placementReview:true};
  }
  if (!next.placementReview) return next;
  const {placementReview, ...section} = next;
  return section;
}
