import { TABLE_ROUTES } from "./serve.js";

export interface PostmanExportOptions {
  port: number;
  /** If set, adds a collection-level Bearer auth block matching `serve --api-key`. */
  apiKey?: string;
}

function resourceFolderName(route: string): string {
  return route
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function listRequest(route: string) {
  return {
    name: `List ${route}`,
    request: {
      method: "GET",
      header: [],
      url: {
        raw: `{{baseUrl}}/api/${route}?page=1&pageSize=25`,
        host: ["{{baseUrl}}"],
        path: ["api", route],
        query: [
          { key: "page", value: "1" },
          { key: "pageSize", value: "25" },
          { key: "sort", value: "", disabled: true, description: "Any top-level field name, e.g. createdAt" },
          { key: "order", value: "desc", disabled: true },
          { key: "status", value: "", disabled: true, description: "Example filter -- any top-level field works as ?field=value" },
        ],
      },
    },
    response: [],
  };
}

function getByIdRequest(route: string) {
  return {
    name: `Get ${route.replace(/s$/, "")} by id`,
    request: {
      method: "GET",
      header: [],
      url: {
        raw: `{{baseUrl}}/api/${route}/:id`,
        host: ["{{baseUrl}}"],
        path: ["api", route, ":id"],
        variable: [{ key: "id", value: "", description: "An id from the corresponding List request's response" }],
      },
    },
    response: [],
  };
}

/**
 * Build a Postman Collection v2.1 for the mock API -- derived from the same
 * TABLE_ROUTES the REST server and the OpenAPI spec both use, so all three
 * stay in sync automatically. Import this file (or `GET /postman.json`
 * while the server with `--postman` is running) directly into Postman:
 * every resource gets a folder with a "List" and "Get by id" request
 * pre-filled with realistic query params.
 */
export function buildPostmanCollection(options: PostmanExportOptions): object {
  const folders = Object.keys(TABLE_ROUTES).map((route) => ({
    name: resourceFolderName(route),
    item: [listRequest(route), getByIdRequest(route)],
  }));

  const rootRequest = {
    name: "Root (endpoint list + counts)",
    request: { method: "GET", header: [], url: { raw: "{{baseUrl}}/", host: ["{{baseUrl}}"], path: [""] } },
    response: [],
  };

  const openApiRequest = {
    name: "OpenAPI spec",
    request: {
      method: "GET",
      header: [],
      url: { raw: "{{baseUrl}}/openapi.json", host: ["{{baseUrl}}"], path: ["openapi.json"] },
    },
    response: [],
  };

  const collection: Record<string, unknown> = {
    info: {
      name: "eco-faker mock API",
      description:
        "Generated from eco-faker's route table (the same one behind /openapi.json). Data resets every time the server restarts unless you pin --seed.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: `http://localhost:${options.port}`, type: "string" }],
    item: [rootRequest, openApiRequest, ...folders],
  };

  if (options.apiKey) {
    collection.auth = {
      type: "bearer",
      bearer: [{ key: "token", value: options.apiKey, type: "string" }],
    };
  }

  return collection;
}
