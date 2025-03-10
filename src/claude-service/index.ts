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
  max_tokens?: number;
  think?: { type: "enabled"; budget_tokens: number };
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
): Promise<ClaudeResponse | Record<string, any> | string> => {
  const {
    prompt,
    keywords,
    apiKey: configApiKey,
    model: configModel,
    temperature = 0.7,
    outputFormat,
    jsonSchema,
    max_tokens,
  } = config;

  const logger = createLogger("claude-service");
  const model =
    configModel || process.env.CLAUDE_MODEL || "claude-3-haiku-20240307";
  const apiKey =
    configApiKey || process.env.API_KEY || process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    logger.error("API key not provided");
    throw new Error("API key is required for Claude API");
  }

  try {
    logger.info("Initializing OpenAI SDK with Claude compatibility", {
      model,
      usingEnvironmentKey:
        !configApiKey && !!(process.env.API_KEY || process.env.CLAUDE_API_KEY),
      mode: outputFormat || "conversation",
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
      finalPrompt = `${finalPrompt}\n\nRemember to respond ONLY with valid JSON matching the required schema.`;
    } else {
      // 对话模式系统提示
      systemPrompt = `You are an experienced content writer specializing in creating well-structured, SEO-optimized HTML content.
Your responses should be direct, focused and implementation-ready without explanations or markdown formatting.
When asked to generate HTML content, provide only the requested HTML that can be directly used in a website.`;
    }

    // 调用Claude API，使用OpenAI兼容格式
    // 根据模式调整最大token数
    const maxResponseTokens =
      max_tokens || (outputFormat === "json" ? 2500 : 4000);

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: finalPrompt },
      ] as any,
      temperature: temperature,
      max_tokens: maxResponseTokens,
    });

    // 处理返回结果
    const content = response.choices[0].message.content || "";

    if (outputFormat === "json") {
      try {
        // 解析JSON响应
        const jsonResponse = JSON.parse(content);
        return jsonResponse;
      } catch (parseError) {
        logger.error("Failed to parse JSON response", {
          parseError:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          rawContent: content.substring(0, 200) + "...",
        });

        // 返回解析错误信息和原始内容
        return {
          parseError: "Failed to parse JSON",
          rawContent: content,
        };
      }
    }

    // 对话模式直接返回文本内容
    if (!content.includes("<")) {
      // 可能不是HTML内容，包装在对象中
      return {
        content: content,
        title: keywords ? `About: ${keywords.join(", ")}` : "Generated Content",
      };
    }

    // 直接返回HTML内容
    return content;
  } catch (error) {
    // 错误处理...与之前相同
    logger.error("Failed to generate content with Claude API", {
      error: error instanceof Error ? error.message : String(error),
    });

    // 返回友好的错误对象
    return {
      error: error instanceof Error ? error.message : String(error),
      content: `<p>Error generating content. Please try again later.</p>
<p>Keywords: ${keywords ? keywords.join(", ") : "None provided"}</p>`,
    };
  }
};
