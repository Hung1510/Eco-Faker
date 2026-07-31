// src/mocks/server.ts
//
// Node-side MSW server for tests -- intercepts real fetch() calls at the
// network layer, so components under test run their actual fetch logic
// unmodified. No component code needs to know it's running in a test.

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
