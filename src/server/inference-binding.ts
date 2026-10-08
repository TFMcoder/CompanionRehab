import { createHash } from 'node:crypto';
import type { CareAuthority } from './care-access.js';

export const NANCY_POLICY_VERSION = 'nancy-2026-10-07-v1';
export interface InferenceScope extends CareAuthority { policy_version: string }
export interface InferenceBinding extends InferenceScope {
  route_id: string;
  account_binding_id: string;
  qualification: 'owner_practice' | 'intended_user';
}
export function bindingRef(binding: InferenceBinding): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify([
    binding.actor_id, binding.login_session_id, binding.active_role, binding.client_id,
    binding.grant_revision, binding.policy_version, binding.route_id, binding.account_binding_id, binding.qualification,
  ])).digest('hex');
}
