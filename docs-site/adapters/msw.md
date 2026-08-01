# MSW (Mock Service Worker) adapter

```bash
npm install --save-dev msw
```

```ts
import { setupServer } from "msw/node";
import { generate } from "eco-faker";
import { toMswHandlers } from "eco-faker/msw";

const dataset = generate({ seed: 1, scenario: "black-friday" });
const server = setupServer(...toMswHandlers(dataset));
```

Same routes, same query semantics, same `X-Eco-Faker-Meaning` header as [`serve`](/cli/serve). `toMswHandlers(dataset, { basePath: "/mock-api" })` for a custom mount point.

Use `setupServer` for tests (Node) and `setupWorker` for a real offline browser dev experience — see `my-eco-gen init msw` in [Scaffolding](/cli/scaffolding) to generate both wired up automatically.

## Example project

See [Testing → Example Projects](/testing/examples) for a full Vitest + React Testing Library project using this adapter, including shared handlers between tests and a dev-mode browser worker.
