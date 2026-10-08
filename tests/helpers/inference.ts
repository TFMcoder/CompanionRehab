import type { Session } from '../../src/server/session.js';
import type { CareAuthority } from '../../src/server/care-access.js';
import type { InferenceBinding, InferenceScope } from '../../src/server/inference-binding.js';

export async function testAuthority(session: Session, clientId = session.user_id): Promise<CareAuthority> {
  return { actor_id: session.user_id, login_session_id: session.session_id, active_role: 'client', client_id: clientId, grant_revision: 'fixture-grant-v1' };
}
export async function bindTestInference(scope: InferenceScope): Promise<InferenceBinding> {
  return { ...scope, route_id: 'synthetic', account_binding_id: 'fixture-account-v1', qualification: 'owner_practice' };
}
