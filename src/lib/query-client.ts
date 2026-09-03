import { QueryClient, defaultShouldDehydrateQuery, isServer } from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, an immediate refetch on the client is wasted work.
        staleTime: 60 * 1000,
        retry: 1,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // The server needs a fresh client per request; the browser must reuse one so
  // React doesn't blow the cache away on a suspense re-render.
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
