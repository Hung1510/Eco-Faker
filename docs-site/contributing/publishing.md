# Publishing to npm

```bash
npm version patch   # or minor / major
npm publish --access public
```

`prepublishOnly` runs build + full test suite + smoke-test first. Requires npm account 2FA.

## Hosted playground API

`Dockerfile.serve`, `render.yaml`, `fly.toml` — deploy config for running [`serve`](/cli/serve) as a public demo instance. Not deployed anywhere by default (needs your own Render/Fly account).

```bash
fly launch --dockerfile Dockerfile.serve --copy-config --now
```

See [Deployment](/guides/deployment) for the full detail on this and the Docker/dev-container setups.
