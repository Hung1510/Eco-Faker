// src/mocks/handlers.ts
//
// The read side (list/byId for every table) comes free from eco-faker's
// toMswHandlers(). Mutations don't -- the generator has no way to know what
// "cancel an order" should mean for your app, so that route is hand-written
// here, mutating the same `dataset` object the generated GET handlers read
// from. A deliberate artificial delay makes the optimistic-update timing
// in App.tsx visible rather than instantaneous.

import { http, HttpResponse, delay } from "msw";
import { toMswHandlers } from "eco-faker/msw";
import { dataset } from "../lib/dataset";

export const handlers = [
  ...toMswHandlers(dataset),
  http.post("*/api/orders/:id/cancel", async ({ params }) => {
    await delay(800);
    const order = dataset.orders.find((o) => o.id === params.id);
    if (!order) {
      return HttpResponse.json({ error: "Order not found" }, { status: 404 });
    }
    // eco-faker's own `Order.status` type is "processing" | "shipped" |
    // "delivered" -- it has no idea your app invented a "cancelled" action.
    // A narrow local cast at the one line that introduces the new value
    // keeps everything else in this file honestly typed.
    (order as { status: string }).status = "cancelled";
    return HttpResponse.json(order);
  }),
];
