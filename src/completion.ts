export interface CompletionCommandInfo {
  name: string;
  flags: string[]; // long-form flags only, e.g. "--users", "--format"
}

export type Shell = "bash" | "zsh" | "fish";
export const SUPPORTED_SHELLS: Shell[] = ["bash", "zsh", "fish"];

/**
 * Every completion script below is generated from the real, live list of
 * registered subcommands and their real options at the moment `completion`
 * runs -- not a hand-maintained copy that would silently drift the next
 * time a flag gets added or renamed. This project has hit that exact class
 * of bug before (a hand-maintained `required` list in the OpenAPI spec, a
 * hand-maintained field list in benchmark-export) and fixed it the same
 * way each time: derive it from the real source instead of duplicating it.
 */
function commandNames(commands: CompletionCommandInfo[]): string[] {
  return commands.map((c) => c.name);
}

export function generateBashCompletion(binName: string, commands: CompletionCommandInfo[]): string {
  const names = commandNames(commands).join(" ");
  const caseBranches = commands
    .map((c) => `    ${c.name}) opts="${c.flags.join(" ")}" ;;`)
    .join("\n");

  return `# ${binName} bash completion.
# Load once per shell session:  eval "$(${binName} completion bash)"
# Or persist it:                ${binName} completion bash >> ~/.bashrc
_${binName.replace(/-/g, "_")}_completions() {
  local cur cmd opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names}" -- "\${cur}") )
    return 0
  fi

  case "\${cmd}" in
${caseBranches}
    *) opts="" ;;
  esac
  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
}
complete -F _${binName.replace(/-/g, "_")}_completions ${binName}
`;
}

export function generateZshCompletion(binName: string, commands: CompletionCommandInfo[]): string {
  const names = commandNames(commands).join(" ");
  const caseBranches = commands
    .map((c) => `      ${c.name}) opts=(${c.flags.join(" ")}) ;;`)
    .join("\n");

  return `#compdef ${binName}
# ${binName} zsh completion.
# Load once per shell session:  eval "$(${binName} completion zsh)"
# Or persist it (in a directory on your $fpath):
#   ${binName} completion zsh > "\${fpath[1]}/_${binName}"
_${binName.replace(/-/g, "_")}() {
  local -a opts
  if (( CURRENT == 2 )); then
    compadd ${names}
    return
  fi
  case "\${words[2]}" in
${caseBranches}
      *) opts=() ;;
  esac
  compadd "\${opts[@]}"
}
_${binName.replace(/-/g, "_")} "$@"
`;
}

export function generateFishCompletion(binName: string, commands: CompletionCommandInfo[]): string {
  // -x (exclusive) on the subcommand-name completions: without it, fish
  // also offers real filesystem paths at that position (a real `scripts/`
  // directory matching the prefix "sc" showed up alongside the intended
  // "scenarios"/"score" in a real `complete -C` run before this was
  // added) -- subcommand names were never meant to compete with paths.
  const commandList = commandNames(commands)
    .map((name) => `complete -c ${binName} -n "__fish_use_subcommand" -x -a "${name}"`)
    .join("\n");
  const flagLines = commands
    .flatMap((c) => c.flags.map((flag) => `complete -c ${binName} -n "__fish_seen_subcommand_from ${c.name}" -l "${flag.replace(/^--/, "")}"`))
    .join("\n");

  return `# ${binName} fish completion.
# Load once per shell session:  ${binName} completion fish | source
# Or persist it:                ${binName} completion fish > ~/.config/fish/completions/${binName}.fish
${commandList}
${flagLines}
`;
}

export function generateCompletion(shell: Shell, binName: string, commands: CompletionCommandInfo[]): string {
  if (shell === "bash") return generateBashCompletion(binName, commands);
  if (shell === "zsh") return generateZshCompletion(binName, commands);
  return generateFishCompletion(binName, commands);
}
