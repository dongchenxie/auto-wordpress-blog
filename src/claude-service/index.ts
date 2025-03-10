import OpenAI from "openai";
import { createLogger } from "../wordpress-post/logger";

// Claude请求配置接口
export interface ClaudeRequestConfig {
  // 基本参数
  prompt: string;
  keywords: string[];

  // API控制参数
  temperature?: number;
  apiKey?: string;
  model?: string;
  max_tokens?: number;

  // 输出格式控制
  outputFormat?: "text" | "json" | "html"; // 添加html选项
  jsonSchema?: Record<string, any>;

  // 新增：允许从外部传入系统提示
  systemPrompt?: string;

  // 请求控制选项
  retryOnRateLimit?: boolean;
  maxRetries?: number;
}

// Claude响应接口
export interface ClaudeResponse {
  content: string;
  title: string;
  [key: string]: any;
}

/**
 * 使用Claude API生成内容
 * @param config 包含自定义systemPrompt的请求配置
 * @returns 生成的内容
 */
export const generateContent = async (
  config: ClaudeRequestConfig
): Promise<ClaudeResponse | Record<string, any> | string> => {
  const {
    prompt,
    keywords,
    apiKey: configApiKey,
    model: configModel,
    temperature = 0.7,
    outputFormat,
    max_tokens = 4000,
    systemPrompt: customSystemPrompt,
    retryOnRateLimit = true,
    maxRetries = 2,
  } = config;

  const logger = createLogger("claude-service");
  const model = configModel || "claude-3-haiku-20240307";
  const apiKey =
    configApiKey || process.env.API_KEY || process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    logger.error("API key not provided");
    throw new Error("API key is required for Claude API");
  }

  // 默认API客户端配置
  const baseOptions = {
    apiKey: apiKey,
    baseURL: "https://api.anthropic.com/v1/",
    defaultHeaders: {
      "anthropic-version": "2023-06-01",
    },
  };

  let attemptCount = 0;
  let lastError: Error | null = null;

  while (attemptCount <= maxRetries) {
    try {
      logger.info(`API request attempt ${attemptCount + 1}/${maxRetries + 1}`, {
        model,
        outputFormat: outputFormat || "text",
      });

      // 创建OpenAI客户端，指向Anthropic API
      const openai = new OpenAI(baseOptions);

      // 构建系统提示
      let finalSystemPrompt = customSystemPrompt || "";

      // 根据输出格式添加明确的格式指令
      if (
        outputFormat === "html" &&
        !finalSystemPrompt.includes("FORMAT: HTML")
      ) {
        finalSystemPrompt = "FORMAT: HTML\n\n" + finalSystemPrompt;
      } else if (
        outputFormat === "json" &&
        !finalSystemPrompt.includes("FORMAT: JSON")
      ) {
        finalSystemPrompt = "FORMAT: JSON\n\n" + finalSystemPrompt;
      }

      // 构建用户提示
      let finalUserPrompt = prompt;

      // 创建请求配置
      // 如果prompt为空，则只使用systemPrompt
      if (!finalUserPrompt && finalSystemPrompt) {
        finalUserPrompt =
          "Please follow the instructions in the system prompt.";
      }

      // 构建请求配置
      const requestConfig = {
        model: model,
        messages: [
          ...(finalSystemPrompt
            ? [{ role: "system", content: finalSystemPrompt }]
            : []),
          { role: "user", content: finalUserPrompt },
        ] as any,
        temperature: temperature,
        max_tokens: max_tokens,
        // 修改响应格式控制，确保HTML输出正确
        response_format:
          outputFormat === "json"
            ? { type: "json" }
            : outputFormat === "html"
            ? ({ type: "text" } as any) // Claude API 不直接支持HTML类型，但我们在系统提示中已指定
            : ({ type: "text" } as any),
      };

      logger.info("Sending request to Claude API", {
        model,
        finalSystemPrompt: finalSystemPrompt,
        finalUserPrompt: finalUserPrompt,
        outputFormat: outputFormat,
      });

      // 发送API请求
      const response = await openai.chat.completions.create(requestConfig);

      // 处理返回结果
      const content = response.choices[0]?.message?.content || "";

      // 检查内容格式是否符合预期
      if (
        outputFormat === "html" &&
        content.startsWith("#") &&
        !content.startsWith("<")
      ) {
        logger.warn(
          "Received Markdown format instead of HTML, content may need conversion"
        );
      }

      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否为速率限制错误
      const isRateLimit =
        lastError.message?.includes("429") ||
        lastError.message?.includes("rate limit");

      logger.error(
        `API request failed (attempt ${attemptCount + 1}/${maxRetries + 1})`,
        {
          error: lastError.message,
          isRateLimit,
        }
      );

      // 如果是速率限制错误且配置了重试，则等待后重试
      if (isRateLimit && retryOnRateLimit && attemptCount < maxRetries) {
        const waitTime = Math.pow(2, attemptCount + 1) * 1000; // 指数退避：2秒，4秒，8秒...
        logger.info(
          `Rate limit encountered, waiting ${waitTime / 1000}s before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        attemptCount++;
        continue;
      }

      // 其他类型的错误或已达到最大重试次数
      attemptCount++;

      // 如果还有重试机会，尝试使用简化的请求
      if (attemptCount <= maxRetries) {
        logger.info("Retrying with simplified request...");
        continue;
      }

      // 所有重试都失败，返回友好的错误对象
      return {
        error: lastError.message,
        fallback: true,
        content: `<p>Content generation service is currently unavailable. Please try again later.</p>
<p>Keywords: ${keywords ? keywords.join(", ") : "None provided"}</p>`,
        title: keywords ? `About: ${keywords.join(", ")}` : "Generated Content",
      };
    }
  }

  // 不应该到达这里，但为了类型安全添加
  return {
    error: lastError?.message || "Unknown error",
    fallback: true,
    content: "<p>An unexpected error occurred.</p>",
  };
};
