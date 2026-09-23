// Progressive-disclosure tool surface (engram-style).
//
// Collapses the 26-tool flat surface into ONE entry tool `excalidraw`:
//   action: "discover"            → capability map (domains, what to call next)
//   action: "help", payload:{tool|domain} → full parameter manual, on demand
//   action: <original tool name>, payload: {...} → routed verbatim to the
//           legacy dispatcher `callExcalidrawTool` — zero adaptation layer.
//
// Opt back out with EXCALIDRAW_LEGACY_TOOLS=1 (restores the flat 26-tool list).
import { tools } from './mcp-tools.js';
import { callExcalidrawTool } from './mcp-dispatch.js';
import type { Tool } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

interface Domain {
  name: string;
  summary: string;
  tools: string[];
}

const DOMAINS: Domain[] = [
  { name: 'element', summary: 'element-level CRUD: create/read/update/delete/query/batch/duplicate', tools: ['create_element', 'get_element', 'update_element', 'delete_element', 'query_elements', 'batch_create_elements', 'duplicate_elements'] },
  { name: 'arrange', summary: 'layout ops: align, distribute, group/ungroup, lock/unlock', tools: ['align_elements', 'distribute_elements', 'group_elements', 'ungroup_elements', 'lock_elements', 'unlock_elements'] },
  { name: 'scene', summary: 'see the canvas: structured description + screenshot', tools: ['describe_scene', 'get_canvas_screenshot'] },
  { name: 'canvas', summary: 'viewport, snapshots, clear', tools: ['set_viewport', 'snapshot_scene', 'restore_snapshot', 'clear_canvas'] },
  { name: 'io', summary: 'files & formats: export/import scene, images, mermaid, share URLs', tools: ['export_scene', 'import_scene', 'export_to_image', 'export_to_excalidraw_url', 'create_from_mermaid'] },
  { name: 'guide', summary: 'design guidance & resources', tools: ['read_diagram_guide', 'get_resource'] }
];

const toolByName = new Map(tools.map(t => [t.name, t]));

function domainOf(toolName: string): string {
  return DOMAINS.find(d => d.tools.includes(toolName))?.name ?? 'other';
}

function discoverText(): string {
  const lines: string[] = [
    `Excalidraw canvas toolkit — ${tools.length} capabilities in ${DOMAINS.length} domains.`,
    '',
    ...DOMAINS.map(d => `- ${d.name}: ${d.summary}\n    tools: ${d.tools.join(', ')}`),
    '',
    'NEXT STEPS:',
    '  action="help", payload={"tool":"create_element"}  → full parameter manual for one tool',
    '  action="help", payload={"domain":"element"}       → manuals for a whole domain',
    '  action="<tool_name>", payload={...arguments}      → execute a tool directly',
    'Typical loop: create_element(s) → describe_scene → fix overlaps/truncation → export_scene.'
  ];
  return lines.join('\n');
}

function helpText(payload: Record<string, unknown> | undefined): string {
  const toolFilter = typeof payload?.tool === 'string' ? payload.tool : undefined;
  const domainFilter = typeof payload?.domain === 'string' ? payload.domain : undefined;

  const selected = toolFilter
    ? tools.filter(t => t.name === toolFilter)
    : domainFilter
      ? tools.filter(t => domainOf(t.name) === domainFilter)
      : [];

  if (selected.length === 0) {
    if (toolFilter || domainFilter) {
      return `Unknown ${toolFilter ? `tool "${toolFilter}"` : `domain "${domainFilter}"`}. Call action="discover" for the capability map.`;
    }
    return `Available domains: ${DOMAINS.map(d => d.name).join(', ')}. Pass payload={"domain":"..."} or {"tool":"..."}.`;
  }

  return selected
    .map(t => {
      const schema = JSON.stringify(t.inputSchema);
      return `## ${t.name}  [domain: ${domainOf(t.name)}]\n${t.description ?? ''}\narguments (JSON Schema): ${schema}`;
    })
    .join('\n\n');
}

export function progressiveToolsEnabled(): boolean {
  return process.env.EXCALIDRAW_LEGACY_TOOLS !== '1';
}

/** The single entry tool definition. */
export const progressiveTool: Tool = {
  name: 'excalidraw',
  description:
    'Excalidraw canvas toolkit, progressive disclosure. Start with action="discover" to get the capability map; ' +
    'action="help" with payload {"tool":"<name>"} returns a tool\'s full parameter manual; ' +
    'action="<tool_name>" with payload {..arguments} executes it (create elements, arrange, screenshot, export, ...).',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"discover" | "help" | an original tool name (call action="discover" first)'
      },
      payload: {
        type: 'object',
        description: 'Arguments forwarded verbatim to the selected tool; for "help": {"tool": "..."} or {"domain": "..."}.'
      }
    },
    required: ['action']
  }
};

/** Route a progressive call. */
export async function callProgressive(args: Record<string, unknown>): Promise<CallToolResult> {
  const action = typeof args.action === 'string' ? args.action : '';
  const payload = (args.payload ?? {}) as Record<string, unknown>;

  if (action === 'discover') return textResult(discoverText());
  if (action === 'help') return textResult(helpText(Object.keys(payload).length > 0 ? payload : undefined));

  const target = toolByName.get(action);
  if (!target) {
    return textResult(
      `Unknown action "${action}". Call action="discover" for the capability map, or action="help" with payload {"tool":"..."}.`
    );
  }
  return callExcalidrawTool(action, payload);
}
