#!/usr/bin/env node
import { install } from "./install.ts";

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): { org?: string; webhookUrl?: string } {
  const flags: { org?: string; webhookUrl?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org" && args[i + 1]) {
      flags.org = args[i + 1];
      i++;
    } else if (args[i] === "--webhook-url" && args[i + 1]) {
      flags.webhookUrl = args[i + 1];
      i++;
    }
  }
  return flags;
}

switch (command) {
  case "install": {
    const flags = parseFlags(args.slice(1));
    await install(flags);
    break;
  }
  default:
    console.log("Usage: github-agent install [--org <name>] [--webhook-url <url>]");
    process.exit(command ? 1 : 0);
}
