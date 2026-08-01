import { defineConfig } from "vitepress";

export default defineConfig({
  title: "eco-faker",
  description: "Stateful, relationally-consistent fake e-commerce data for real apps.",
  base: "/eco-faker-docs/",
  cleanUrls: true,

  themeConfig: {
    logo: undefined,
    nav: [
      { text: "Getting Started", link: "/getting-started/" },
      { text: "CLI Reference", link: "/cli/" },
      { text: "Library API", link: "/api/" },
      { text: "Adapters", link: "/adapters/" },
      { text: "Testing", link: "/testing/" },
      { text: "Contributing", link: "/contributing/" },
      { text: "GitHub", link: "https://github.com/Hung1510/Eco-Faker" },
      { text: "npm", link: "https://www.npmjs.com/package/eco-faker" },
    ],

    sidebar: {
      "/getting-started/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/getting-started/" },
            { text: "Installation", link: "/getting-started/installation" },
            { text: "Quick Start", link: "/getting-started/quick-start" },
            { text: "Run from Source", link: "/getting-started/run-from-source" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Reference",
          items: [
            { text: "Overview & Configuration", link: "/cli/" },
            { text: "generate", link: "/cli/generate" },
            { text: "serve", link: "/cli/serve" },
            { text: "Data Quality (lint, fuzz, score, diff)", link: "/cli/data-quality" },
            { text: "Data Lifecycle (version, replay, warp, events)", link: "/cli/data-lifecycle" },
            { text: "Exports (dashboard, k6, GE, OTel, benchmarks)", link: "/cli/exports" },
            { text: "mail & webhook", link: "/cli/mail-and-webhook" },
            { text: "Database Tools (db-snapshot, anonymize)", link: "/cli/db-tools" },
            { text: "Scaffolding (init)", link: "/cli/scaffolding" },
            { text: "docs & completion", link: "/cli/docs-and-completion" },
            { text: "MCP server", link: "/cli/mcp" },
          ],
        },
      ],
      "/api/": [
        {
          text: "Library API",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "Scenarios", link: "/api/scenarios" },
            { text: "Configuration", link: "/api/configuration" },
            { text: "Unique Values", link: "/api/unique-values" },
          ],
        },
      ],
      "/adapters/": [
        {
          text: "Adapters",
          items: [
            { text: "Overview", link: "/adapters/" },
            { text: "MSW", link: "/adapters/msw" },
            { text: "tRPC", link: "/adapters/trpc" },
            { text: "GraphQL", link: "/adapters/graphql" },
            { text: "React Query", link: "/adapters/react-query" },
            { text: "Apollo Client", link: "/adapters/apollo" },
          ],
        },
      ],
      "/testing/": [
        {
          text: "Testing",
          items: [
            { text: "Overview", link: "/testing/" },
            { text: "Contract Testing", link: "/testing/contract-testing" },
            { text: "Mutation Testing", link: "/testing/mutation-testing" },
            { text: "Scenario Testing", link: "/testing/scenario-testing" },
            { text: "Gherkin/BDD Testing", link: "/testing/gherkin-testing" },
            { text: "Example Projects", link: "/testing/examples" },
          ],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [
            { text: "Development Setup", link: "/contributing/" },
            { text: "Project Layout", link: "/contributing/project-layout" },
            { text: "Continuous Integration", link: "/contributing/ci" },
            { text: "Publishing to npm", link: "/contributing/publishing" },
            { text: "VS Code Extension", link: "/contributing/vscode-extension" },
          ],
        },
      ],
      "/guides/": [
        {
          text: "Guides",
          items: [
            { text: "Visual Tools", link: "/guides/visual-tools" },
            { text: "Deployment", link: "/guides/deployment" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/Hung1510/Eco-Faker" }],

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "eco-faker",
    },

    editLink: {
      pattern: "https://github.com/Hung1510/Eco-Faker/edit/main/docs-site/:path",
      text: "Edit this page on GitHub",
    },
  },
});
