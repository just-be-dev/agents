#!/usr/bin/env node
import { commands as githubCommands } from "@just-be/github-agent/cli";
import { commands as linearCommands } from "@just-be/linear-agent/cli";
import type { CommandDefinition } from "@just-be/github-agent/cli";

const agents: Record<string, Record<string, CommandDefinition>> = {
  github: githubCommands,
  linear: linearCommands,
};

function parseFlags(args: string[]): Record<string, string | undefined> {
  const flags: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== undefined && arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

function printTopLevelHelp(): void {
  console.log("Usage: agents <agent> <command> [flags]\n");
  console.log("Agents:");
  for (const name of Object.keys(agents)) {
    console.log(`  ${name}`);
  }
}

function printAgentHelp(agentName: string, commands: Record<string, CommandDefinition>): void {
  console.log(`Usage: agents ${agentName} <command> [flags]\n`);
  console.log("Commands:");
  for (const [cmdName, def] of Object.entries(commands)) {
    console.log(`  ${cmdName.padEnd(16)}${def.description}`);
    if (def.flags) {
      for (const [flagName, flagDef] of Object.entries(def.flags)) {
        const kebab = flagName.replace(/([A-Z])/g, "-$1").toLowerCase();
        const required = flagDef.required ? " (required)" : "";
        console.log(`    --${kebab.padEnd(18)}${flagDef.description}${required}`);
      }
    }
  }
}

const args = process.argv.slice(2);
const agentName = args[0];
const commandName = args[1];

if (!agentName) {
  printTopLevelHelp();
  process.exit(0);
}

const agentCommands = agents[agentName];
if (!agentCommands) {
  console.error(`Unknown agent: ${agentName}`);
  printTopLevelHelp();
  process.exit(1);
}

if (!commandName) {
  printAgentHelp(agentName, agentCommands);
  process.exit(0);
}

const command = agentCommands[commandName];
if (!command) {
  console.error(`Unknown command: ${commandName}`);
  printAgentHelp(agentName, agentCommands);
  process.exit(1);
}

await command.action(parseFlags(args.slice(2)));
