# docs & completion

## CLI docs lookup

```bash
my-eco-gen docs score          # prints (and tries to open) the realism-score docs section
my-eco-gen docs mutate         # matches "Mutation testing", not "Contract testing"
my-eco-gen docs                # no topic -- opens the docs' top
```

`docs <topic>` case-insensitively matches `topic` against real documentation headings and prints the resolved URL, then tries to open it in your default browser — the URL is printed either way, so this is still useful headless. No match prints the real list of available sections instead of guessing.

## Shell completion

```bash
eval "$(my-eco-gen completion bash)"    # or: zsh / fish
my-eco-gen completion bash >> ~/.bashrc # persist it
```

`completion <bash|zsh|fish>` generates a completion script from the real, current set of subcommands and their real flags (introspected off the live Commander program, not a second hand-maintained copy that could drift the moment a flag changes).

## Locale listing

```bash
my-eco-gen locales
```

See [Locale support](/cli/generate#locale-support) in the `generate` reference for the full detail.
