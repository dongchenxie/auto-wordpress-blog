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
    // 模拟console以避免测试输出中的日志
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = originalEnv;
  });

  // 测试API密钥从环境变量读取
  it("should read API key from environment variables if not provided", async () => {
    // 设置环境变量
    process.env.CLAUDE_API_KEY = "env_api_key";

    // 模拟OpenAI构造函数
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                {
                  message: {
                    content: "Content",
                  },
                },
              ],
            }),
          },
        },
      } as unknown as OpenAI;
    });

    // 设置请求配置，使用环境变量中的API密钥
    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
      serviceType: "claude",
      apiKey: process.env.CLAUDE_API_KEY as string
    };

    // 调用函数
    await generateContent(config);

    // 验证使用了环境变量中的API密钥
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "env_api_key",
      })
    );
  });

  // 测试自定义系统提示
  it("should use custom system prompt when provided", async () => {
    // 模拟OpenAI的create方法以验证接收到的参数
    const createMock = jest.fn().mockResolvedValue({
      choices: [{ message: { content: "Content" } }],
    });

    // 模拟OpenAI构造函数
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: createMock,
          },
        },
      } as unknown as OpenAI;
    });

    // 设置请求配置，包含自定义系统提示
    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
      serviceType: "claude",
      apiKey: "test_api_key",
      systemPrompt: "Custom system prompt",
    };

    // 调用函数
    await generateContent(config);

    // 验证create方法接收到了自定义系统提示
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "Custom system prompt" },
          { role: "user", content: "Test prompt" },
        ],
      })
    );
  });

  // 测试达到最大重试次数
  it("should return fallback content after max retries", async () => {
    // 模拟每次调用都失败
    const createMock = jest
      .fn()
      .mockRejectedValue(new Error("429 Rate limit exceeded"));

    // 模拟OpenAI构造函数
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: createMock,
          },
        },
      } as unknown as OpenAI;
    });

    // 设置请求配置
    const config: ClaudeRequestConfig = {
      prompt: "Test prompt",
      keywords: ["test"],
      serviceType: "claude",
      apiKey: "test_api_key",
      retryOnRateLimit: true,
      maxRetries: 2,
    };

    // 替换setTimeout以加快测试
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((callback) => {
      callback();
      return {} as any;
    }) as any;

    try {
      // 调用函数
      const result = await generateContent(config);

      // 验证返回了备用内容
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("fallback", true);
      expect(result).toHaveProperty("content");

      // 验证create方法被调用了三次（初始 + 两次重试）
      expect(createMock).toHaveBeenCalledTimes(3);
    } finally {
      // 恢复原始setTimeout
      global.setTimeout = originalSetTimeout;
    }
  });
});
