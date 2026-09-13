/**
 * Mini App entry point.
 *
 * Gate M1A provides the scaffold only: the real seller flows are gate M1D.
 * Telegram bindings stay behind `shared/telegram` so the rest of the app never
 * imports the SDK directly.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
