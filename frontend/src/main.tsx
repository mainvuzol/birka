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

/*
 * A read never sits paused (ADR-0013 §4.1). TanStack's default network mode
 * holds a query silently while the phone says it is offline, and
 * «Повторити» then does nothing visible; with "always" it runs, fails, and
 * says the server does not answer. That mode turns reading again on
 * reconnection off unless it is written out: written, every stale read —
 * one that failed with nothing to show among them — is read again when the
 * phone is back online, the till's list and a failed sign-in too.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: true,
      networkMode: "always",
      refetchOnReconnect: true,
    },
  },
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
