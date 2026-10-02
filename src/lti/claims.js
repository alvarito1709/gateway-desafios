/* =========================================================================
   claims.js — Constantes de los claims de LTI 1.3 (IMS Global) y helpers
   para extraer/normalizar datos del id_token.
   ========================================================================= */

export const CLAIM = {
  MESSAGE_TYPE: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  VERSION:      'https://purl.imsglobal.org/spec/lti/claim/version',
  DEPLOYMENT:   'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  TARGET_URI:   'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  RESOURCE:     'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  CONTEXT:      'https://purl.imsglobal.org/spec/lti/claim/context',
  ROLES:        'https://purl.imsglobal.org/spec/lti/claim/roles',
  LIS:          'https://purl.imsglobal.org/spec/lti/claim/lis',
  // Servicios LTI Advantage (para fases futuras: AGS / NRPS).
  AGS:          'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  NRPS:         'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice',
};

export const MESSAGE_TYPE_RESOURCE_LINK = 'LtiResourceLinkRequest';
export const MESSAGE_TYPE_DEEP_LINKING = 'LtiDeepLinkingRequest';
export const LTI_VERSION = '1.3.0';

// Prefijos de roles (IMS LIS v2). El array de roles trae URIs completas.
const ROLE_INSTRUCTOR = /membership#(Instructor|TeachingAssistant|ContentDeveloper|Mentor)/i;
const ROLE_LEARNER = /membership#(Learner|Student)/i;
const ROLE_ADMIN = /(#Administrator|institution\/person#Administrator|system\/person#Administrator)/i;

/**
 * Deriva un rol principal simple a partir del array de roles del claim.
 * Devuelve 'instructor' | 'student' | 'admin' | 'other'.
 */
export function primaryRole(rolesArray) {
  const roles = Array.isArray(rolesArray) ? rolesArray : [];
  if (roles.some((r) => ROLE_ADMIN.test(r))) return 'admin';
  if (roles.some((r) => ROLE_INSTRUCTOR.test(r))) return 'instructor';
  if (roles.some((r) => ROLE_LEARNER.test(r))) return 'student';
  return 'other';
}
