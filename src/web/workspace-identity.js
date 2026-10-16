import {messageText,messageAttribute} from './i18n/dom.js';
import {t} from './i18n/index.js';
// Describes the workspace; it does not grant membership or change ownership.
export const IDENTITY_KINDS = [
  ['personal', 'Personal'], ['organization', 'Organization'], ['laboratory', 'Laboratory'],
  ['studio', 'Studio'], ['collective', 'Collective'], ['workspace', 'Workspace'], ['custom', 'Custom']
];
export function validIdentity(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && IDENTITY_KINDS.some(([id]) => id === value.kind) &&
    typeof value.label === 'string' && value.label.length <= 60 && !/[\x00-\x1f\x7f]/.test(value.label) &&
    (value.kind === 'custom' ? value.label.trim().length > 0 : value.label === '');
}
export function identityLabel(identity) {
  return identity?.kind === 'custom' ? identity.label : IDENTITY_KINDS.find(([id]) => id === identity?.kind)?.[1] ?? 'Workspace';
}
export function identityFields({field, option, esc}, identity = {kind:'personal',label:''}) {
  return field(messageText('setup','identityType',esc), `<select name="identityKind">${IDENTITY_KINDS.map(([id]) => `<option value="${id}" data-i18n-text="setup:identity.${id}" ${id===identity.kind?'selected':''}>${esc(t('setup','identity.'+id))}</option>`).join('')}</select>`) +
    `<div data-custom-identity ${identity.kind === 'custom' ? '' : 'hidden'}>${field(messageText('setup','identityLabel',esc), `<input name="identityLabel" maxlength="60" value="${esc(identity.label)}" ${messageAttribute('setup','identityPlaceholder','placeholder',esc)} ${identity.kind === 'custom' ? 'required' : 'disabled'}>`)}</div>`;
}
export function identityInput(el) {
  if (el.name !== 'identityKind') return false;
  const container = el.form.querySelector('[data-custom-identity]'), input = container.querySelector('input');
  container.hidden = el.value !== 'custom'; input.disabled = container.hidden; input.required = !container.hidden;
  return true;
}
export const identityFromForm = data => ({kind:data.get('identityKind'),label:data.get('identityKind') === 'custom' ? (data.get('identityLabel') ?? '').trim() : ''});
