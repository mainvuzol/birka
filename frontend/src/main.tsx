/**
 * Mini App entry point.
 *
 * Seller order flows share one in-memory server-state cache.
 * Telegram bindings stay behind `shared/telegram` so the rest of the app never
 * imports the SDK directly.
 *
 * A screen that breaks shows «Щось пішло не так» instead of a blank page, and
 * a short note of it goes to the server's log (owner decision, 2026-10-03).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});

import { App } from "@/App";
import { CrashBoundary } from "@/shared/CrashScreen";
import { noteUnhandledErrors } from "@/shared/report";

noteUnhandledErrors();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <CrashBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </CrashBoundary>
  </StrictMode>,
);
