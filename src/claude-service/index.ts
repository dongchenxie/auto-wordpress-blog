import OpenAI from "openai";
import { createLogger } from "../wordpress-post/logger";

// 请求配置接口
export interface ClaudeRequestConfig {
  // 基本参数
  prompt: string;
  keywords: string[];
  // 新增：指定AI服务类型
  serviceType: string;
  apiKey: string;
  model?: string;

  // API控制参数
  systemPrompt?: string;
  temperature?: number;
  max_tokens?: number;
  jsonSchema?: Record<string, any>;

  // 请求控制选项
  retryOnRateLimit?: boolean;
  maxRetries?: number;
}

// 响应接口
export interface ClaudeResponse {
  content: string;
  title: string;
  [key: string]: any;
}

/**
 * 使用AI服务生成内容，支持Claude、OpenAI和Gemini
 * @param config 请求配置
 * @returns 生成的内容
 */
export const generateContent = async (
  RequestConfig: ClaudeRequestConfig
): Promise<ClaudeResponse | Record<string, any> | string> => {
  const {
    prompt,
    keywords,
    serviceType: configServiceType,
    apiKey: configApiKey,
    model: configModel,
    systemPrompt: SystemPrompt,
    temperature = 0.7,
    max_tokens = 4000,
    retryOnRateLimit = true,
    maxRetries = 2,
    jsonSchema,
  } = RequestConfig;

  const logger = createLogger("ai-service");

  // 确定模型和服务类型
  const serviceType = configServiceType;
  
  // 根据服务类型选择默认模型
  const model = configModel || 
    (serviceType === "gemini" 
      ? "gemini-2.0-flash" 
      : serviceType === "openai" 
        ? "gpt-4o" 
        : "claude-3-5-haiku-20241022");

  // 根据服务类型获取API密钥
  let apiKey: string | undefined;
  switch (serviceType) {
    case "claude":
      apiKey =
        configApiKey || process.env.API_KEY || process.env.CLAUDE_API_KEY;
      break;
    case "openai":
      apiKey = configApiKey || process.env.OPENAI_API_KEY;
      break;
    case "gemini":
      apiKey = configApiKey || process.env.GEMINI_API_KEY;
      break;
  }

  if (!apiKey) {
    logger.error(`API key not provided for ${serviceType} service`);
    throw new Error(`API key is required for ${serviceType} service`);
  }

  // 根据服务类型配置API客户端
  let baseOptions: any;
  switch (serviceType) {
    case "claude":
      baseOptions = {
        apiKey: apiKey,
        baseURL: "https://api.anthropic.com/v1/",
        defaultHeaders: {
          "anthropic-version": "2023-06-01",
        },
      };
      break;
    case "openai":
      baseOptions = {
        apiKey: apiKey,
      };
      break;
    case "gemini":
      // 更新 Gemini 的配置以使用 OpenAI 兼容层
      baseOptions = {
        apiKey: apiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        defaultHeaders: {
          "Authorization": `Bearer ${apiKey}`,
        },
      };
      break;
  }

  let attemptCount = 0;
  let lastError: Error | null = null;

  while (attemptCount <= maxRetries) {
    try {
      logger.info(`API request attempt ${attemptCount + 1}/${maxRetries + 1}`, {
        model,
        serviceType,
      });

      // 创建API客户端
      const openai = new OpenAI(baseOptions);

      // 构建用户提示
      let finalUserPrompt = prompt;

      let finalSystemPrompt = SystemPrompt || "";
      // 如果存在jsonSchema，则构建包含schema的系统提示
      if (jsonSchema) {
        // 构建更严格的系统提示，确保JSON输出的稳定性
        finalSystemPrompt = `
You must follow these JSON output rules:
1.Match this schema: ${JSON.stringify(jsonSchema)}
2. Use valid JSON format
3. Include all required fields
4. Output pure JSON only
Required fields:{${Object.keys(jsonSchema).join(",")}}
${SystemPrompt || ""}`;
        finalSystemPrompt = finalSystemPrompt.replace(/\n/g, " ");
      }

      // 构建请求配置
      let requestConfig: any;

      // 根据不同服务类型构建请求
      switch (serviceType) {
        case "claude":
        case "openai":
          requestConfig = {
            model: model,
            messages: [
              { role: "system", content: finalSystemPrompt },
              { role: "user", content: finalUserPrompt },
            ],
            temperature: temperature,
            max_tokens: max_tokens,
          };
          break;
        case "gemini":
          // Gemini 的请求格式
          requestConfig = {
            model: model,
            messages: [
              ...(finalSystemPrompt
                ? [{ role: "system", content: finalSystemPrompt }]
                : []),
              { role: "user", content: finalUserPrompt },
            ],
            temperature: temperature,
            maxOutputTokens: max_tokens,
          };
          break;
      }

      logger.info(`Sending request to ${serviceType} API`, {
        requestConfig: {
          ...requestConfig,
          model: requestConfig.model,
        },
      });

      // 发送API请求
      const response = await openai.chat.completions.create(requestConfig);

      // 处理返回结果
      const content = response.choices[0]?.message?.content || "";

      // 如果期望JSON输出，验证并修复JSON格式
      if (jsonSchema && typeof content === "string") {
        try {
          // 尝试解析JSON
          const jsonContent = JSON.parse(content);
          return jsonContent;
        } catch (jsonError) {
          // JSON解析失败，尝试修复常见问题
          logger.warn("JSON parsing failed, attempting to fix", {
            error:
              jsonError instanceof Error
                ? jsonError.message
                : String(jsonError),
          });

          // 修复不完整的JSON (缺少结尾括号)
          let fixedContent = content;

          // 计算开括号和闭括号的数量
          const openBraces = (content.match(/\{/g) || []).length;
          const closeBraces = (content.match(/\}/g) || []).length;

          // 如果开括号比闭括号多，添加缺少的闭括号
          if (openBraces > closeBraces) {
            const missingBraces = openBraces - closeBraces;
            fixedContent = content + "}".repeat(missingBraces);
            logger.info("Fixed incomplete JSON by adding closing braces", {
              missingBraces,
            });

            try {
              // 尝试解析修复后的JSON
              const fixedJson = JSON.parse(fixedContent);
              return fixedJson;
            } catch (e) {
              // 修复失败，返回原始内容
              logger.error("JSON repair failed", {
                error: e instanceof Error ? e.message : String(e),
              });
              return content;
            }
          }

          // 其他JSON错误，返回原始内容
          return content;
        }
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
          serviceType,
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
