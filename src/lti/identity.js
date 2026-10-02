/* =========================================================================
   identity.js — Construye la IDENTIDAD del estudiante a partir del id_token
   ya validado.

   Regla clave (pedido explícito): el identificador principal NO es el email.
   La identidad estable se deriva de los identificadores LTI:
       issuer  +  deployment_id  +  sub
   Estos tres, combinados, identifican de forma única y persistente a la
   persona dentro de un despliegue: el `sub` es estable por-issuer y no cambia
   aunque cambie el email o el nombre. El email se guarda solo como dato
   informativo/PII opcional.
   ========================================================================= */
import crypto from 'node:crypto';
import { CLAIM, primaryRole } from './claims.js';

/**
 * Deriva un id estable y opaco a partir de (issuer, deploymentId, sub).
 * Es determinístico: la misma persona en el mismo despliegue → el mismo id.
 * No es reversible (es un hash), así que sirve como clave sin exponer el sub.
 */
export function stableIdFrom(issuer, deploymentId, sub) {
  const material = `${issuer}\n${deploymentId}\n${sub}`;
  return crypto.createHash('sha256').update(material).digest('base64url');
}

/**
 * Extrae los datos del estudiante desde el payload del id_token validado.
 * Los campos de PII (nombre, email) pueden faltar según lo que la plataforma
 * decida compartir; por eso se devuelven como null cuando no están.
 */
export function buildIdentity(payload) {
  const issuer = payload.iss;
  const sub = payload.sub;
  const deploymentId = payload[CLAIM.DEPLOYMENT];

  const context = payload[CLAIM.CONTEXT] || {};
  const roles = payload[CLAIM.ROLES] || [];

  return {
    // --- Identidad estable (clave principal) ---
    stableId: stableIdFrom(issuer, deploymentId, sub),

    // --- Identificadores LTI crudos ---
    issuer,
    sub,
    deploymentId,
    clientId: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,

    // --- Contexto / curso ---
    contextId: context.id || null,
    contextLabel: context.label || null,
    contextTitle: context.title || null,

    // --- Datos personales (pueden faltar) ---
    name: payload.name || null,
    givenName: payload.given_name || null,
    familyName: payload.family_name || null,
    email: payload.email || null,

    // --- Rol ---
    roles,
    role: primaryRole(roles),

    launchedAt: new Date().toISOString(),
  };
}
