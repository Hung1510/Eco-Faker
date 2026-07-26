import * as vscode from "vscode";
import path from "node:path";
import {
  buildGenerateInvocation,
  buildScaffoldInvocation,
  resolveCliCommand,
  resolveOutputPath,
  runCli,
  looksLikeGloballyInstalled,
  type OutputFormat,
} from "./cliRunner.js";
import { buildTableViewerHtml, loadDatasetTables } from "./tableViewer.js";

const SCENARIOS = ["(default config, no scenario)", "black-friday", "post-holiday-returns", "flash-sale", "supply-chain-crisis", "steady-state"];
const FORMATS: OutputFormat[] = ["json", "sql", "csv"];

let outputChannel: vscode.OutputChannel;

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function detectCli(): { command: string; baseArgs: string[] } {
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return resolveCliCommand(looksLikeGloballyInstalled(pathDirs));
}

async function runAndReport(
  invocation: { command: string; args: string[] },
  cwd: string,
  progressTitle: string,
  onSuccess: (stdout: string) => void | Promise<void>
): Promise<void> {
  outputChannel.appendLine(`$ ${invocation.command} ${invocation.args.join(" ")}`);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: progressTitle },
    () => runCli(invocation, cwd)
  );
  outputChannel.appendLine(result.stdout);
  if (result.stderr) outputChannel.appendLine(result.stderr);

  if (!result.ok) {
    const choice = await vscode.window.showErrorMessage(
      `eco-faker: ${progressTitle} failed${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ""}.`,
      "Show output"
    );
    if (choice === "Show output") outputChannel.show();
    return;
  }
  await onSuccess(result.stdout);
}

async function generateDatasetCommand(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("eco-faker: open a folder first -- there's no workspace to write the generated file into.");
    return;
  }

  const usersInput = await vscode.window.showInputBox({
    prompt: "Number of core users to generate",
    value: "100",
    validateInput: (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? undefined : "Enter a positive integer."),
  });
  if (usersInput === undefined) return; // cancelled

  const scenarioChoice = await vscode.window.showQuickPick(SCENARIOS, { placeHolder: "Scenario preset (optional)" });
  if (scenarioChoice === undefined) return;

  const formatChoice = await vscode.window.showQuickPick(FORMATS, { placeHolder: "Output format" });
  if (formatChoice === undefined) return;
  const format = formatChoice as OutputFormat;

  const defaultOutput = `./eco-data.${format}`;
  const outputInput = await vscode.window.showInputBox({ prompt: "Output file path (relative to the workspace root)", value: defaultOutput });
  if (outputInput === undefined) return;

  const users = Number(usersInput);
  const scenario = scenarioChoice.startsWith("(default") ? undefined : scenarioChoice;
  const outputPath = resolveOutputPath(workspaceRoot, outputInput);

  const invocation = buildGenerateInvocation({ users, scenario, format, outputPath }, detectCli());

  await runAndReport(invocation, workspaceRoot, `Generating dataset (${users} users${scenario ? `, ${scenario}` : ""})`, async () => {
    const buttons = format === "json" ? ["Open file", "View tables"] : ["Open file"];
    const choice = await vscode.window.showInformationMessage(`eco-faker: wrote ${path.relative(workspaceRoot, outputPath)}.`, ...buttons);
    if (choice === "Open file") {
      const doc = await vscode.workspace.openTextDocument(outputPath);
      await vscode.window.showTextDocument(doc);
    } else if (choice === "View tables") {
      await viewDatasetCommand(vscode.Uri.file(outputPath));
    }
  });
}

async function scaffoldCommand(target: "next" | "msw"): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("eco-faker: open a folder first -- there's no workspace to write the scaffold files into.");
    return;
  }

  const invocation = buildScaffoldInvocation({ target }, detectCli());
  await runAndReport(invocation, workspaceRoot, `Scaffolding ${target === "next" ? "Next.js" : "MSW"} integration`, async (stdout) => {
    const writtenFiles = [...stdout.matchAll(/^Wrote (.+)$/gm)].map((m) => m[1]);
    if (writtenFiles.length === 0) {
      vscode.window.showInformationMessage(`eco-faker: ${target} scaffold ran -- see output for details.`);
      return;
    }
    const choice = await vscode.window.showInformationMessage(`eco-faker: wrote ${writtenFiles.join(", ")}.`, "Open first file");
    if (choice === "Open first file") {
      const doc = await vscode.workspace.openTextDocument(path.join(workspaceRoot, writtenFiles[0]));
      await vscode.window.showTextDocument(doc);
    }
  });
}

async function viewDatasetCommand(preselected?: vscode.Uri): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  let fileUri = preselected;
  if (!fileUri) {
    const picked = await vscode.window.showOpenDialog({
      title: "Select a dataset.json (from eco-faker generate --format json)",
      defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined,
      filters: { "JSON files": ["json"] },
      canSelectMany: false,
    });
    if (!picked || picked.length === 0) return;
    fileUri = picked[0];
  }

  let tables: ReturnType<typeof loadDatasetTables>;
  try {
    const raw = await vscode.workspace.fs.readFile(fileUri);
    tables = loadDatasetTables(Buffer.from(raw).toString("utf-8"));
  } catch (err) {
    vscode.window.showErrorMessage(`eco-faker: couldn't read/parse that file as a dataset: ${(err as Error).message}`);
    return;
  }

  if (Object.keys(tables).length === 0) {
    vscode.window.showErrorMessage("eco-faker: that file has no array-valued tables to show -- is it a real dataset.json?");
    return;
  }

  const panel = vscode.window.createWebviewPanel("ecoFakerTableViewer", `eco-faker: ${path.basename(fileUri.fsPath)}`, vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = buildTableViewerHtml(tables);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("eco-faker");
  context.subscriptions.push(outputChannel);
  context.subscriptions.push(vscode.commands.registerCommand("eco-faker.generateDataset", generateDatasetCommand));
  context.subscriptions.push(vscode.commands.registerCommand("eco-faker.viewDataset", viewDatasetCommand));
  context.subscriptions.push(vscode.commands.registerCommand("eco-faker.scaffoldNext", () => scaffoldCommand("next")));
  context.subscriptions.push(vscode.commands.registerCommand("eco-faker.scaffoldMsw", () => scaffoldCommand("msw")));
}

export function deactivate(): void {
  // Nothing to clean up -- runCli's child processes are already
  // short-lived and don't outlive their own await.
}
