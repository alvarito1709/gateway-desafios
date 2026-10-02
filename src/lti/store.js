/* =========================================================================
   store.js — Almacenamiento efímero para el handshake OIDC/LTI:
     - transacciones de login (state -> { nonce, clientId, ... }) de un solo uso;
     - nonces ya consumidos (protección anti-replay del id_token).

   Implementación en memoria con expiración (TTL). Es suficiente para una
   sola instancia. Para escalar horizontalmente (varias réplicas) se reemplaza
   por Redis manteniendo esta MISMA interfaz: putTransaction/takeTransaction/
   isNonceUsed/markNonceUsed.
   ========================================================================= */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutos: cubre de sobra un login OIDC.

function now() { return Date.now(); }

class MemoryStore {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.transactions = new Map(); // state -> { data, expiresAt }
    this.usedNonces = new Map();   // nonce -> expiresAt
    // Limpieza periódica de entradas vencidas.
    this.timer = setInterval(() => this.sweep(), 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  sweep() {
    const t = now();
    for (const [k, v] of this.transactions) if (v.expiresAt <= t) this.transactions.delete(k);
    for (const [k, exp] of this.usedNonces) if (exp <= t) this.usedNonces.delete(k);
  }

  /* --- Transacción de login (state de un solo uso) --- */
  putTransaction(state, data) {
    this.transactions.set(state, { data, expiresAt: now() + this.ttlMs });
  }
  // Devuelve y ELIMINA la transacción (consumo atómico → el state es de un solo uso).
  takeTransaction(state) {
    const entry = this.transactions.get(state);
    if (!entry) return null;
    this.transactions.delete(state);
    if (entry.expiresAt <= now()) return null;
    return entry.data;
  }

  /* --- Nonces consumidos (anti-replay) --- */
  isNonceUsed(nonce) {
    const exp = this.usedNonces.get(nonce);
    if (!exp) return false;
    if (exp <= now()) { this.usedNonces.delete(nonce); return false; }
    return true;
  }
  markNonceUsed(nonce, ttlMs = this.ttlMs) {
    this.usedNonces.set(nonce, now() + ttlMs);
  }
}

const store = new MemoryStore();
export default store;
