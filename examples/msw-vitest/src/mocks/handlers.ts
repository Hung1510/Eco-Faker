// src/mocks/handlers.ts
//
// One line turns the dataset into a full set of MSW request handlers --
// GET /api/<table> (paginated/filterable/sortable) and GET /api/<table>/:id
// per table, mirroring eco-faker's `serve` REST API route-for-route. Used
// by both the dev-mode browser worker and the test-mode Node server, so
// "what my tests mock" and "what I browse against locally" are the exact
// same handlers -- they cannot drift apart.

import { toMswHandlers } from "eco-faker/msw";
import { dataset } from "../lib/dataset";

export const handlers = toMswHandlers(dataset);
