# Gherkin/BDD Testing (`test --gherkin`)

The same [scenario engine](/testing/scenario-testing) above, authored in real `.feature` (Gherkin) syntax instead of YAML/JSON:

```gherkin
Feature: Order lifecycle

  Scenario: Fetch a real order
    Given I GET "/api/orders?pageSize=1" and call it "listOrders"
    Then the response status should be 200
    And I capture "data.0.id" as "firstOrderId"

  Scenario: A nonexistent order returns 404
    When I GET "/api/orders/does-not-exist" and call it "fetchMissing"
    Then the response status should be 404
```

```bash
my-eco-gen test --url https://api.example.com --contract ./your-openapi.json --gherkin ./order-lifecycle.feature
```

A `.feature` file translates directly into the same `Scenario`/`ScenarioStep` shape `--scenario` runs — every step actually fires a real request and is really asserted, not just parsed. Multiple `Scenario:` blocks in one file each run independently. <code v-pre>{{seed.*}}</code>/<code v-pre>{{stepName.field}}</code> placeholders work identically to `--scenario`, including with `--seed <dataset.json>`.

## Fixed step vocabulary

This is a small, **fixed step vocabulary** — not a general-purpose Gherkin runner with user-registrable step definitions the way real Cucumber/cucumber-js works (that's arbitrary custom code per step, a fundamentally different and much bigger feature):

- `I <GET|POST|PUT|PATCH|DELETE> "<path>" [with body <json>] [and call it "<name>"]`
- `the response status should be <code>`
- `the response field "<dot.path>" should be <json-value>` — the value is parsed as real JSON, so strings need their own quotes (`should be "delivered"`), numbers/booleans/null don't (`should be 129.99`, `should be true`)
- `I capture "<dot.path>" as "<localName>"`

`Given`/`When`/`Then`/`And`/`But` are all treated identically — only the step *text* is matched.

::: warning Not supported in this first slice
Tags (`@smoke`), `Background:` (repeat shared setup in each `Scenario:` instead), `Scenario Outline:`/`Examples:` (write out each case as its own plain `Scenario:` instead), and data tables/doc strings. Encountering any of these produces a clear parse error, not a silent misparse.
:::

## Related

- [Scenario Testing](/testing/scenario-testing) — the underlying engine, in YAML/JSON form
