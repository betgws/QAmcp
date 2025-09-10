#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer from "puppeteer";
import { z } from "zod";

const server = new McpServer({ name: "qa-mcp-server", version: "0.1.0" });

let browser, page;

// 브라우저 열기
async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
  }
  return page;
}

// 툴 1: 페이지 방문
server.registerTool(
  "visit_page",
  {
    title: "Visit a webpage",
    description: "특정 URL로 이동",
    inputSchema: { url: z.string() },
  },
  async ({ url }) => {
    const p = await initBrowser();
    await p.goto(url);
    return { content: [{ type: "text", text: `✅ Visited ${url}` }] };
  }
);

// 툴 2: 텍스트 검증
server.registerTool(
  "assert_text",
  {
    title: "Assert page contains text",
    description: "페이지에 특정 텍스트가 있는지 검증",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => {
    const p = await initBrowser();
    const body = await p.content();
    const found = body.includes(text);
    return {
      content: [{ type: "text", text: found ? `✅ Found: ${text}` : `❌ Not Found: ${text}` }],
    };
  }
);

// 툴 3: 폼 입력
server.registerTool(
  "fill_form",
  {
    title: "Fill form input",
    description: "폼 입력창에 값 채우기",
    inputSchema: { selector: z.string(), value: z.string() },
  },
  async ({ selector, value }) => {
    const p = await initBrowser();
    await p.type(selector, value);
    return { content: [{ type: "text", text: `✍️ Filled ${selector} with ${value}` }] };
  }
);

// MCP 서버 실행
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("❌ Server error:", err);
  process.exit(1);
});
