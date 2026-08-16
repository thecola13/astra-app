// @astra/shared — the contract between mobile and the API.
//
// Everything that crosses the network boundary lives here:
//   - Zod schemas (single source of truth for request/response shapes)
//   - TypeScript types inferred from those schemas (never hand-duplicated)
//   - domain constants (e.g. points rules)
//   - the typed API client the mobile app uses to call apps/web
//
// Keep these barrels as the only public surface.

export * from "./schemas";
export * from "./client";
export * from "./domain";
export * from "./gradebook-stats";
