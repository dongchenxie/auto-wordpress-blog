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

  it("当API密钥不存在时应抛出错误", async () => {
    // 确保环境变量为空
    delete process.env.API_KEY;
    delete process.env.CLAUDE_API_KEY;

    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
    };

    await expect(generateContent(config)).rejects.toThrow(
      "Claude API key is required either in config or as environment variable"
    );
  });

  it("当API调用失败时应抛出错误", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API错误"));

    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
      apiKey: "test-key",
    };

    await expect(generateContent(config)).rejects.toThrow("API错误");
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

  it("应处理非Error类型的异常", async () => {
    // 模拟非Error类型的异常
    mockCreate.mockRejectedValueOnce("不是Error对象的异常");

    const config: ClaudeRequestConfig = {
      prompt: "Non-error exception test",
      keywords: ["test"],
      apiKey: "test-api-key",
    };

    await expect(generateContent(config)).rejects.toBeTruthy();
    // 无法直接测试String(error)分支，但至少验证非Error类型的异常也被捕获
  });
});
