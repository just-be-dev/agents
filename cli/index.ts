#!/usr/bin/env node
import { Cli } from "incur";
import { cli as github } from "@just-be/github-agent/cli";
import { cli as linear } from "@just-be/linear-agent/cli";

const cli = Cli.create("agents", {
  description: "CLI for @just-be agents",
});

cli.command(github);
cli.command(linear);

cli.serve();

export default cli;
