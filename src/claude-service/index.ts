import OpenAI from "openai";
import { createLogger } from "../wordpress-post/logger";

// Claude请求配置接口
export interface ClaudeRequestConfig {
  prompt: string;
  keywords: string[];
  temperature?: number;
  apiKey?: string;
  model?: string;
  outputFormat?: "text" | "json"; // 新增：输出格式选项
  jsonSchema?: Record<string, any>; // 新增：期望的JSON结构
}

// Claude响应接口
export interface ClaudeResponse {
  content: string;
  title: string;
}

/**
 * 使用Claude API生成内容
 * @param config Claude请求配置
 * @returns 生成的内容
 */
export const generateContent = async (
  config: ClaudeRequestConfig
): Promise<ClaudeResponse | Record<string, any>> => {
  const logger = createLogger("claude-service");

  try {
    const {
      prompt,
      keywords,
      temperature = 0.7,
      apiKey: configApiKey,
      model = "claude-3-haiku-20240307",
      outputFormat = "json",
      jsonSchema,
    } = config;

    // 优先使用传入的API密钥，其次使用环境变量中的API密钥
    const apiKey =
      configApiKey || process.env.API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Claude API key is required either in config or as environment variable"
      );
    }

    logger.info("Initializing OpenAI SDK with Claude compatibility", {
      model,
      usingEnvironmentKey:
        !configApiKey && !!(process.env.API_KEY || process.env.CLAUDE_API_KEY),
    });

    // 创建OpenAI客户端，但指向Anthropic API
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: "https://api.anthropic.com/v1/",
    });

    // 构建适当的提示词，基于所需的输出格式
    let finalPrompt = prompt;
    let systemPrompt = "";

    if (outputFormat === "json") {
      // 创建JSON系统提示
      systemPrompt = `You are a JSON output API. 
You must ALWAYS respond with valid JSON only, without any additional text or explanations before or after.
Your output MUST be parseable by JSON.parse() and match the following schema:
${JSON.stringify(jsonSchema)}

Do not include any markdown formatting, code blocks, or text outside the JSON structure.`;
      systemPrompt = systemPrompt.replace(/\n/g, "");
      // 修改用户提示，确保它包含JSON要求
      finalPrompt = `${prompt}\n
      \nRemember to respond ONLY with valid JSON matching the required schema.`;
    }

    logger.info(`Calling Claude API with ${outputFormat} format`, {
      promptLength: finalPrompt.length,
      finalPrompt: finalPrompt,
      keywordsCount: keywords.length,
      keywords: keywords,
      outputFormat,
      hasJsonSchema: !!jsonSchema,
    });

    // 发送请求到Claude API
    const createParams = {
      model: model,
      temperature: temperature,
      messages: [
        ...(systemPrompt
          ? [{ role: "system", content: systemPrompt as string }]
          : []),
        { role: "user", content: finalPrompt },
      ] as any,
    };

    logger.info("Calling openai.chat.completions.create with params", {
      createParams: createParams,
    });

    const response = await openai.chat.completions.create(createParams);
    logger.info("received response from Claude API", {
      response: response,
    });

    // 解析响应
    const content = response.choices[0].message.content || "";

    if (outputFormat === "json") {
      try {
        // 尝试解析JSON响应
        const jsonResponse = JSON.parse(content);
        logger.info("Successfully generated JSON content with Claude", {
          keys: Object.keys(jsonResponse),
        });
        return jsonResponse;
      } catch (error) {
        logger.error("Failed to parse JSON from Claude response", {
          error: error instanceof Error ? error.message : String(error),
          content:
            content.substring(0, 200) + (content.length > 200 ? "..." : ""),
        });
        // 返回纯文本作为内容，并添加错误提示
        return {
          parseError: "Failed to parse JSON from Claude response",
          rawContent: content,
        };
      }
    } else {
      // 文本模式处理
      // 提取标题 (假设标题是第一个#开头的行)
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : `Article about ${keywords[0]}`;

      logger.info("Successfully generated text content with Claude", {
        contentLength: content.length,
        title,
      });

      return {
        content: content,
        title,
      };
    }
  } catch (error) {
    logger.error("Failed to generate content with Claude API", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
