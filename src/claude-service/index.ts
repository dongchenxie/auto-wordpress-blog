import OpenAI from "openai";
import { createLogger } from "../wordpress-post/logger";

// Claude请求配置接口
export interface ClaudeRequestConfig {
  prompt: string;
  keywords: string[];
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  model?: string;
}

// Claude响应接口
export interface ClaudeResponse {
  content: string;
  title: string;
}

/**
 * 使用Claude API生成文章内容
 * @param config Claude请求配置
 * @returns 生成的文章内容和标题
 */
export const generateContent = async (
  config: ClaudeRequestConfig
): Promise<ClaudeResponse> => {
  const logger = createLogger("claude-service");

  try {
    const {
      prompt,
      keywords,
      temperature = 0.7,
      apiKey: configApiKey,
      model = "claude-3-haiku-20240307",
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

    //     // 构建系统提示
    //     const systemPrompt = `You are a professional blog content writer.
    // Write a high-quality, informative blog post about the topic provided.
    // Include the following keywords naturally in the content: ${keywords.join(", ")}.
    // Structure the content with appropriate headings (using markdown ## for h2 and ### for h3).
    // Include an engaging title at the beginning using # format.
    // Format your response as valid markdown.
    // Do not include any disclaimers or mentions that this was created by AI.`;

    logger.info("Calling Claude API through OpenAI compatibility layer", {
      promptLength: prompt.length,
      keywordsCount: keywords.length,
      prompt,
      keywords,
      temperature,
      model,
    });

    // 发送请求到Claude API
    const response = await openai.chat.completions.create({
      model: model,
      temperature: temperature,
      messages: [
        // { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    // 解析响应
    const fullContent = response.choices[0].message.content || "";

    // 提取标题 (假设标题是第一个#开头的行)
    const titleMatch = fullContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : `Article about ${keywords[0]}`;

    logger.info("Successfully generated content with Claude", {
      contentLength: fullContent.length,
      title,
      fullContent,
    });

    return {
      content: fullContent,
      title,
    };
  } catch (error) {
    logger.error("Failed to generate content with Claude API", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
