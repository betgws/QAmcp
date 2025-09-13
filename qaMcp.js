#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer from "puppeteer";
import { z } from "zod";

const server = new McpServer({ name: "qa-mcp-server", version: "0.4.0" });

let browser = null;
let page = null;
let networkLogs = []; // 네트워크 요청 기록 저장

// 브라우저 초기화
async function initBrowser() {
  try {
    // 브라우저가 없거나 죽었을 때 다시 실행
    if (!browser || !browser.isConnected()) {
      if (browser) await browser.close();
      browser = await puppeteer.launch({
        headless: false, // 안정성을 위해 기본값 headless
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }

    // 페이지가 없거나 닫혔을 때 새로 열기
    if (!page || page.isClosed()) {
      page = await browser.newPage();

      // 네트워크 응답 기록
      page.on("response", async (res) => {
        const url = res.url();
        const status = res.status();
        if (!url.startsWith("http")) return;

        let body = null;
        try {
          body = await res.json();
        } catch {
          try {
            body = await res.text();
          } catch {
            body = null;
          }
        }

        networkLogs.push({ url, status, body, time: new Date().toISOString() });
      });
    }

    return page;
  } catch (err) {
    console.error("initBrowser error:", err);
    browser = null;
    page = null;
    throw err;
  }
}

// 페이지 방문
server.registerTool(
  "visit_page",
  {
    title: "Visit a webpage",
    description: "특정 URL로 이동",
    inputSchema: { url: z.string() },
  },
  async ({ url }) => {
    const p = await initBrowser();
    try {
      await p.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      return { content: [{ type: "text", text: `✅ Visited ${url}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Visit failed: ${err.message}` }] };
    }
  }
);

// 요소 목록 가져오기
server.registerTool(
  "list_elements",
  {
    title: "List clickable and input elements",
    description: "버튼, 링크, input 등 상호작용 가능한 요소들을 확인",
    inputSchema: {},
  },
  async () => {
    const p = await initBrowser();
    const elements = await p.evaluate(() =>
      Array.from(document.querySelectorAll("a, button, input, textarea")).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || null,
        placeholder: el.getAttribute("placeholder") || null,
        text: el.innerText || el.value || null,
      }))
    );
    return { content: [{ type: "text", text: JSON.stringify(elements, null, 2) }] };

  }
);

// 버튼/링크 클릭
server.registerTool(
  "click_element",
  {
    title: "Click element by text or type",
    description: "버튼이나 링크 텍스트 또는 type 속성으로 요소 클릭",
    inputSchema: { keyword: z.string() },
  },
  async ({ keyword }) => {
    const p = await initBrowser();
    const clicked = await p.evaluate((k) => {
      const els = Array.from(document.querySelectorAll("a, button, input[type=submit]"));
      const el = els.find(
        (e) =>
          (e.innerText && e.innerText.includes(k)) ||
          (e.type && e.type === k)
      );
      if (el) {
        el.click();
        return true;
      }
      return false;
    }, keyword);
    return { content: [{ type: "text", text: clicked ? `✅ Clicked ${keyword}` : `❌ Not Found: ${keyword}` }] };
  }
);


// 폼 입력 
server.registerTool(
  "fill_form",
  {
    title: "Fill input by placeholder or label",
    description: "placeholder 또는 label 텍스트로 input 찾기 후 값 입력",
    inputSchema: { keyword: z.string(), value: z.string() },
  },
  async ({ keyword, value }) => {
    const p = await initBrowser();

    // 1. input element 찾기 (브라우저 내부)
    const inputEl = await p.evaluateHandle((k) => {
      return Array.from(document.querySelectorAll("input, textarea")).find(
        (e) =>
          (e.placeholder && e.placeholder.includes(k)) ||
          (e.labels?.[0]?.innerText.includes(k))
      );
    }, keyword);

    // 2. Puppeteer ElementHandle로 변환
    const inputHandle = inputEl.asElement();

    if (!inputHandle) {
      return { content: [{ type: "text", text: `❌ Input not found: ${keyword}` }] };
    }

    // 3. 사람이 타이핑하듯 입력
    await inputHandle.click({ clickCount: 3 });
    await inputHandle.press("Backspace");
    await inputHandle.type(value);

    return { content: [{ type: "text", text: `✍️ Typed into ${keyword}` }] };
  }
);


// 텍스트 검증
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
    return {
      content: [{ type: "text", text: body.includes(text) ? `Found: ${text}` : ` Not Found: ${text}` }],
    };
  }
);

// 네트워크 로그 반환
server.registerTool(
  "get_network_logs",
  {
    title: "Get captured network logs",
    description: "지금까지 기록된 네트워크 요청/응답 반환",
    inputSchema: {},
  },
  async () => {
    return { content: [{ type: "text", text: JSON.stringify(networkLogs, null, 2) }] };
  }
);

// 특정 키워드 네트워크 요청 확인
server.registerTool(
  "check_network_request",
  {
    title: "Check network request",
    description: "특정 키워드가 포함된 네트워크 요청을 검색",
    inputSchema: { keyword: z.string() },
  },
  async ({ keyword }) => {
    const found = networkLogs.filter((log) => log.url.includes(keyword));
    return found.length
      ? { content: [{ type: "text", text: JSON.stringify(networkLogs, null, 2) }] }
      : { content: [{ type: "text", text: `No request found for ${keyword}` }] };
  }
);

// 실행
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
