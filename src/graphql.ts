import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLString,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLList,
  GraphQLID,
  Kind,
  type GraphQLFieldConfigMap,
} from "graphql";
import type { ValueNode } from "graphql";
import type { Dataset } from "./types.js";
import {
  TABLE_ROUTES,
  applyFiltersToRecords,
  applySortToRecords,
  paginateRecords,
  resolveMeaning,
  type DatasetArrayKey,
} from "./serve.js";

/**
 * Minimal `JSON` scalar (serializes as-is, no validation) -- e-commerce
 * records here are nested (line items, addresses, tracking events) and
 * vary per table, so hand-typing six separate GraphQL object shapes would
 * be a lot of ceremony for a mock-data adapter whose whole point is "give
 * me realistic data fast." Filters are also accepted as a JSON object for
 * the same reason. This is a deliberate simplification, not an oversight
 * -- a real production GraphQL API would define concrete types per
 * resource; see the SDL export below for a starting point if you want to
 * take that further yourself.
 */
function parseLiteral(node: ValueNode): unknown {
  switch (node.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.OBJECT:
      return Object.fromEntries(node.fields.map((f) => [f.name.value, parseLiteral(f.value)]));
    case Kind.LIST:
      return node.values.map(parseLiteral);
    case Kind.NULL:
      return null;
    default:
      return undefined;
  }
}

const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON -- used for records (nested, shape varies per table) and filter objects.",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral,
});

const PageInfoType = new GraphQLObjectType({
  name: "PageInfo",
  fields: {
    page: { type: new GraphQLNonNull(GraphQLInt) },
    pageSize: { type: new GraphQLNonNull(GraphQLInt) },
    total: { type: new GraphQLNonNull(GraphQLInt) },
    totalPages: { type: new GraphQLNonNull(GraphQLInt) },
  },
});

function buildTableResultType(route: string): GraphQLObjectType {
  return new GraphQLObjectType({
    name: `${toPascalCase(route)}Result`,
    fields: {
      data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(JSONScalar))) },
      pagination: { type: new GraphQLNonNull(PageInfoType) },
      meaning: { type: new GraphQLNonNull(GraphQLString) },
    },
  });
}

function toPascalCase(routeName: string): string {
  return routeName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(routeName: string): string {
  const pascal = toPascalCase(routeName);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Turn a generated `Dataset` into an executable GraphQL schema -- one
 * `<table>(filters, sort, order, page, pageSize)` list field and one
 * `<table>ById(id)` field per table, plus `info`, reusing the exact same
 * `applyFiltersToRecords`/`applySortToRecords`/`paginateRecords` helpers
 * as `serve`, the MSW adapter, and the tRPC adapter -- four adapters, one
 * filter/sort/paginate implementation, so none of them can drift apart.
 *
 * Returns a real, executable `GraphQLSchema` (usable directly with
 * `graphql()`, or mounted into `graphql-yoga`/`apollo-server`/`mercurius`
 * via their schema-first setup) plus the equivalent SDL as a string, for
 * anyone who wants to hand-write typed resource shapes on top of this as
 * a starting point instead of the generic `JSON` scalar this uses.
 */
export function toGraphQLSchema(dataset: Dataset): { schema: GraphQLSchema; typeDefs: string } {
  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const resultTypeDefs: string[] = [];
  const queryFieldDefs: string[] = [];

  for (const [route, datasetKey] of Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]) {
    const fieldName = toCamelCase(route);
    const resultType = buildTableResultType(route);
    const resultTypeName = `${toPascalCase(route)}Result`;

    resultTypeDefs.push(`type ${resultTypeName} {\n  data: [JSON!]!\n  pagination: PageInfo!\n  meaning: String!\n}`);

    (queryFields as any)[fieldName] = {
      type: new GraphQLNonNull(resultType),
      args: {
        filters: { type: JSONScalar },
        sort: { type: GraphQLString },
        order: { type: GraphQLString },
        page: { type: GraphQLInt },
        pageSize: { type: GraphQLInt },
      },
      resolve: (_root: unknown, args: Record<string, unknown>) => {
        const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
        const query: Record<string, string | undefined> = {
          ...((args.filters as Record<string, string>) ?? {}),
          sort: args.sort as string | undefined,
          order: args.order as string | undefined,
          page: args.page !== undefined ? String(args.page) : undefined,
          pageSize: args.pageSize !== undefined ? String(args.pageSize) : undefined,
        };
        const filtered = applySortToRecords(applyFiltersToRecords(rows, query), query);
        const page = paginateRecords(filtered, query);
        return { ...page, meaning: resolveMeaning(datasetKey, false, 200) };
      },
    };

    const byIdFieldName = `${fieldName}ById`;
    (queryFields as any)[byIdFieldName] = {
      type: JSONScalar,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: (_root: unknown, args: { id: string }) => {
        const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
        return rows.find((r) => r.id === args.id) ?? null;
      },
    };

    queryFieldDefs.push(
      `  ${fieldName}(filters: JSON, sort: String, order: String, page: Int, pageSize: Int): ${resultTypeName}!`,
      `  ${byIdFieldName}(id: ID!): JSON`
    );
  }

  (queryFields as any).info = {
    type: new GraphQLNonNull(JSONScalar),
    resolve: () => ({
      name: "eco-faker mock API (GraphQL)",
      tables: Object.keys(TABLE_ROUTES).map(toCamelCase),
      counts: Object.fromEntries(
        (Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]).map(([route, key]) => [
          toCamelCase(route),
          dataset[key].length,
        ])
      ),
    }),
  };
  queryFieldDefs.push("  info: JSON!");

  const QueryType = new GraphQLObjectType({ name: "Query", fields: queryFields });
  const schema = new GraphQLSchema({ query: QueryType });

  const typeDefs = [
    "scalar JSON",
    "",
    "type PageInfo {\n  page: Int!\n  pageSize: Int!\n  total: Int!\n  totalPages: Int!\n}",
    "",
    ...resultTypeDefs,
    "",
    "type Query {",
    ...queryFieldDefs,
    "}",
  ].join("\n");

  return { schema, typeDefs };
}
