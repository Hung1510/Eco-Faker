// src/lib/queryHooks.ts
import { createEcoFakerQueryHooks } from "eco-faker/react-query";

export const hooks = createEcoFakerQueryHooks({ baseUrl: "/api" });
