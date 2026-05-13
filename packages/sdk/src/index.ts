// Public SDK surface.
//
// As of Phase C, the SDK is HTTP-only — the mock client and its
// MOCK_* fixtures were removed once every consumer screen migrated
// to real endpoints. If you need a deterministic test double, build
// one in your test setup against the `SDKClient` contract — don't
// reintroduce a mock here.

export * from './types';
export * from './clients/contract';
export { createHttpClient, type HttpClientOptions } from './clients/http';
// `AuthError` is exported as a value (it's a class) via `export * from './types'`,
// but re-exporting explicitly here makes it discoverable in autocomplete.
export { AuthError } from './types';
