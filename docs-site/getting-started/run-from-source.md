# Run from Source

For anyone who'd rather clone the repo and see it work end-to-end than install the published package — everything below is copy-pasteable, in the order you'd actually run it. No need to read anything past this page just to see what eco-faker does; jump into the [CLI Reference](/cli/) whenever you're ready for the rest.

**1. Clone and install:**
```bash
git clone https://github.com/Hung1510/Eco-Faker.git
cd Eco-Faker
npm install
```

**2. Build:**
```bash
npm run build
```

**3. Run the full test suite** — confirms everything actually works on your machine before you rely on any of it:
```bash
npm test
```

**4. Generate your first dataset:**
```bash
node dist/cli.js generate --users 50 --seed 1 --scenario black-friday --format json --output ./eco-data.json
```
(Once installed globally with `npm install -g eco-faker`, every `node dist/cli.js <command>` below is just `my-eco-gen <command>`.)

**5. Spin up a live mock API against it and hit a real endpoint:**
```bash
node dist/cli.js serve --users 50 --seed 1 --port 4000 &
curl "http://localhost:4000/api/orders?status=delivered&pageSize=5"
```

**6. Run the same full verification pass CI runs, end to end:**
```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
npm test                             # full unit test suite
npm run build                        # compile
npm run smoke-test                   # runs dist/ against every scenario preset, checks referential integrity
```

That's the whole loop: clone → install → build → test → generate → serve. See [Contributing](/contributing/) for the deeper development setup, or the [CLI Reference](/cli/) for the full feature-by-feature reference.
