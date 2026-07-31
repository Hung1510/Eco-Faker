// src/mocks/browser.ts
//
// Browser-side MSW worker -- run the app fully offline in dev mode, no
// backend process, no `serve` server. Started conditionally from main.tsx.

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
