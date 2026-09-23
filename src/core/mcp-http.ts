// Public-facing MCP HTTP endpoint.
//
// Wraps the same MCP server factory the stdio entry uses with a
// streamable-HTTP Node handler, mounted by the canvas Express app so one
// process serves both the canvas UI and remote MCP clients.
//
// Serving is stateless by default (each request gets a fresh instance from
// the factory) — exactly what a single-user public deployment wants.
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { excalidrawMcpServerFactory } from './mcp-server.js';
import logger from '../utils/logger.js';

const nodeHandler = toNodeHandler(createMcpHandler(excalidrawMcpServerFactory));

// Express's json body parser must NOT run before this handler (it would
// consume the request stream out from under the MCP transport), so
// server.ts mounts this BEFORE `express.json`.
export const mcpHttpEndpoint: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  Promise.resolve(nodeHandler(req, res)).catch(error => {
    logger.error('MCP HTTP endpoint error:', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    } else {
      res.end();
    }
  });
};
