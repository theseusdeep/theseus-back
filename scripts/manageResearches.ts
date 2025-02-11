#!/usr/bin/env tsx
/**
 * CLI tool to manage researches in the database.
 *
 * Commands:
 *   list    List all research records in a table format.
 *   dump    Dump all research records as JSON.
 *
 * Examples:
 *   tsx scripts/manageResearches.ts list
 *   tsx scripts/manageResearches.ts dump
 */

import { getAllResearches } from "../src/db";

function printUsage() {
  console.log(`Usage:
  tsx scripts/manageResearches.ts <command>

Commands:
  list    List all research records in a table format.
  dump    Dump all research records as JSON.

Examples:
  tsx scripts/manageResearches.ts list
  tsx scripts/manageResearches.ts dump
`);
}

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const arg of args) {
    if (arg.startsWith("--")) {
      currentKey = arg.slice(2);
      options[currentKey] = "";
    } else if (currentKey) {
      if (options[currentKey]) {
        options[currentKey] += " " + arg;
      } else {
        options[currentKey] = arg;
      }
    }
  }
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }
  const command = args[0];
  const options = parseOptions(args.slice(1));

  switch (command) {
    case "list":
      {
        const researches = await getAllResearches();
        if (researches.length === 0) {
          console.log("No research records found.");
        } else {
          console.table(researches);
        }
      }
      break;
    case "dump":
      {
        const researches = await getAllResearches();
        console.log(JSON.stringify(researches, null, 2));
      }
      break;
    default:
      console.error(`Error: Unknown command "${command}".`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("An error occurred:", err);
  process.exit(1);
});
