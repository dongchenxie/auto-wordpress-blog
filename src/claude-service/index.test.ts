import { generateContent, ClaudeRequestConfig } from "./index";
import OpenAI from "openai";

// 模拟OpenAI模块
jest.mock("openai");
jest.mock("../wordpress-post/logger", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

describe("Claude服务", () => {
  // 保存原始环境变量
  const originalEnv = process.env;

  // 模拟OpenAI的chat.completions.create方法
  const mockCreate = jest.fn();
  const mockOpenAIInstance = {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // 重置环境变量
    process.env = { ...originalEnv };
    // 模拟OpenAI构造函数
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => {
      return mockOpenAIInstance as any;
    });
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = originalEnv;
  });

  it("应从环境变量中读取API密钥", async () => {
    // 设置环境变量
    process.env.API_KEY = "env-api-key";

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "# Title\nContent" } }],
    });

    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
    };

    await generateContent(config);

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "env-api-key",
      baseURL: "https://api.anthropic.com/v1/",
    });
  });

  // 以下为新增测试用例，用于提高分支覆盖率

  it("应使用CLAUDE_API_KEY环境变量", async () => {
    // 设置CLAUDE_API_KEY环境变量
    delete process.env.API_KEY;
    process.env.CLAUDE_API_KEY = "claude-api-key";

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "# Title\nContent" } }],
    });

    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
    };

    await generateContent(config);

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "claude-api-key",
      baseURL: "https://api.anthropic.com/v1/",
    });
  });
});
