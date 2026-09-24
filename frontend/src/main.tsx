/**
 * Mini App entry point.
 *
 * Seller order flows share one in-memory server-state cache.
 * Telegram bindings stay behind `shared/telegram` so the rest of the app never
 * imports the SDK directly.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});

import { App } from "@/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
