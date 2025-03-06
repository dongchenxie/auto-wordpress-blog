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

  it("应正确调用Claude API并返回内容", async () => {
    // 模拟API响应
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "# Generated Title\n\nThis is the generated content.",
          },
        },
      ],
    });

    const config: ClaudeRequestConfig = {
      prompt: "Write about fishing",
      keywords: ["fish", "fishing"],
      apiKey: "test-api-key",
    };

    const result = await generateContent(config);

    // 验证结果
    expect(result.title).toBe("Generated Title");
    expect(result.content).toBe(
      "# Generated Title\n\nThis is the generated content."
    );

    // 验证OpenAI实例化
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      baseURL: "https://api.anthropic.com/v1/",
    });

    // 验证API调用
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-3-haiku-20240307",
        messages: [
          { role: "system", content: expect.stringContaining("fish, fishing") },
          { role: "user", content: "Write about fishing" },
        ],
      })
    );
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
});
