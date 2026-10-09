#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
const server=createServer();
try {
  await server.connect(new StdioServerTransport());
} catch(error) {
  process.stderr.write(`Material MCP startup failed: ${error instanceof Error?error.message.slice(0,500):'unknown error'}\n`);
  process.exitCode=1;
}
