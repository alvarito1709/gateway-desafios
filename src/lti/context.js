/* =========================================================================
   context.js — Restricción opcional por curso de Moodle.

   Si LTI_ALLOWED_CONTEXT_IDS tiene valores, solo se acepta un launch cuyo
   context.id (el id del curso) esté en la lista. Vacío = sin restricción.
   Sirve para que el contenido solo se abra desde el aula de egresados aunque
   la herramienta quede visible en otros cursos del mismo Moodle.
   ========================================================================= */
import config from '../config.js';

export function isAllowedContext(contextId, allowed = config.lti.allowedContextIds) {
  if (!allowed || allowed.length === 0) return true;
  if (contextId === undefined || contextId === null || contextId === '') return false;
  return allowed.includes(String(contextId));
}
