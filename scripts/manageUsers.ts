#!/usr/bin/env tsx
/**
 * CLI tool to manage users in the database.
 *
 * Commands:
 *   create --username <username> --password <password>
 *   update --username <username> [--password <newPassword>] [--last-research <lastResearch>] [--input <inputTokens>] [--output <outputTokens>]
 *   delete --username <username>
 *   list
 *   dump
 *
 * Examples:
 *   tsx scripts/manageUsers.ts create --username alice --password secret123
 *   tsx scripts/manageUsers.ts update --username alice --password newSecret --last-research "2023-04-25T12:34:56.789Z" --input 100 --output 150
 *   tsx scripts/manageUsers.ts delete --username alice
 *   tsx scripts/manageUsers.ts list
 *   tsx scripts/manageUsers.ts dump
 */

import { createUser, getUserByUsername, getAllUsers, updateUser, deleteUser } from "../src/db";

function printUsage() {
  console.log(`Usage:
  tsx scripts/manageUsers.ts <command> [options]

Commands:
  create --username <username> --password <password>
  update --username <username> [--password <newPassword>] [--last-research <lastResearch>] [--input <inputTokens>] [--output <outputTokens>]
  delete --username <username>
  list
  dump

Examples:
  tsx scripts/manageUsers.ts create --username alice --password secret123
  tsx scripts/manageUsers.ts update --username alice --password newSecret --last-research "2023-04-25T12:34:56.789Z" --input 100 --output 150
  tsx scripts/manageUsers.ts delete --username alice
  tsx scripts/manageUsers.ts list
  tsx scripts/manageUsers.ts dump
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
      // If the current key already has a value, append with a space
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
    case "create":
      {
        const username = options.username;
        const password = options.password;
        if (!username || !password) {
          console.error("Error: --username and --password are required for create command.");
          printUsage();
          process.exit(1);
        }
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
          console.error(`Error: User with username "${username}" already exists.`);
          process.exit(1);
        }
        const user = await createUser(username, password);
        console.log("User created successfully:");
        console.log(user);
      }
      break;
    case "update":
      {
        const username = options.username;
        if (!username) {
          console.error("Error: --username is required for update command.");
          printUsage();
          process.exit(1);
        }
        const fields: {
          password?: string;
          last_research?: string;
          input_tokens_usage?: number;
          output_tokens_usage?: number;
          total_tokens_usage?: number;
        } = {};
        if (options.password !== undefined) {
          fields.password = options.password;
        }
        if (options["last-research"] !== undefined) {
          fields.last_research = options["last-research"];
        }
        if (options.input !== undefined) {
          const inputTokens = parseInt(options.input, 10);
          if (isNaN(inputTokens)) {
            console.error("Error: --input must be a valid number.");
            process.exit(1);
          }
          fields.input_tokens_usage = inputTokens;
        }
        if (options.output !== undefined) {
          const outputTokens = parseInt(options.output, 10);
          if (isNaN(outputTokens)) {
            console.error("Error: --output must be a valid number.");
            process.exit(1);
          }
          fields.output_tokens_usage = outputTokens;
        }
        if (fields.input_tokens_usage !== undefined && fields.output_tokens_usage !== undefined) {
          fields.total_tokens_usage = fields.input_tokens_usage + fields.output_tokens_usage;
        }
        const updatedUser = await updateUser(username, fields);
        if (!updatedUser) {
          console.error(`Error: User with username "${username}" not found.`);
          process.exit(1);
        }
        console.log("User updated successfully:");
        console.log(updatedUser);
      }
      break;
    case "delete":
      {
        const username = options.username;
        if (!username) {
          console.error("Error: --username is required for delete command.");
          printUsage();
          process.exit(1);
        }
        const success = await deleteUser(username);
        if (success) {
          console.log(`User "${username}" deleted successfully.`);
        } else {
          console.error(`Error: User "${username}" not found or could not be deleted.`);
          process.exit(1);
        }
      }
      break;
    case "list":
      {
        const users = await getAllUsers();
        if (users.length === 0) {
          console.log("No users found.");
        } else {
          console.table(users);
        }
      }
      break;
    case "dump":
      {
        const users = await getAllUsers();
        console.log(JSON.stringify(users, null, 2));
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
