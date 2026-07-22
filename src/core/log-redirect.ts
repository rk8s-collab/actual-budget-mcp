// log-redirect.ts — stdout es el canal MCP: cualquier console.log va a stderr.
// Este módulo se importa EL PRIMERO en index.ts; los imports laterales se
// evalúan en orden de aparición, así que la redirección precede al resto.
console.log = (...args: unknown[]) => console.error('[log]', ...args);
