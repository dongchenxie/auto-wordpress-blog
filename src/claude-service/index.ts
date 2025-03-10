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
 * 使用Claude API生成内容，采用流式输出确保完整响应
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
    think,
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
      systemPrompt = `LIMIT 2000-WORDS You are a JSON output API. 
You must ALWAYS respond with valid JSON only, without any additional text or explanations before or after.
Your output MUST be parseable by JSON.parse() and match the following schema:
${JSON.stringify(jsonSchema)}

Do not include any markdown formatting, code blocks, or text outside the JSON structure.`;
      systemPrompt = systemPrompt.replace(/\n/g, "");

      // 修改用户提示，确保它包含JSON要求
      finalPrompt = `${finalPrompt}\n\nRemember to respond ONLY with valid JSON matching the required schema.`;
    } else {
      // 内容生成模式系统提示 - 优化以确保完整输出
      systemPrompt = `LIMIT 2000-WORDS You are an experienced content writer specializing in creating well-structured, SEO-optimized HTML content.
Your responses should be direct, focused and implementation-ready without explanations or markdown formatting.
When asked to generate HTML content, provide only the requested HTML that can be directly used in a website.
IMPORTANT: Always complete your responses fully. Ensure all sections mentioned in the prompt are included in your response.`;
    }

    // 是否使用流式输出
    const useStreaming = !outputFormat || outputFormat !== "json";

    try {
      if (useStreaming) {
        // 使用流式API调用收集完整内容
        logger.info("Using streaming API for complete content");

        try {
          // 添加Anthropic API版本头
          const baseOptions = {
            apiKey: apiKey,
            baseURL: "https://api.anthropic.com/v1/",
            defaultHeaders: {
              "anthropic-version": "2023-06-01",
            },
          };

          const openai = new OpenAI(baseOptions);

          // 先尝试非流式调用，避免兼容性问题
          const response = await openai.chat.completions.create({
            model: model,
            messages: [
              ...(systemPrompt
                ? [{ role: "system", content: systemPrompt }]
                : []),
              { role: "user", content: finalPrompt },
            ] as any,
            temperature: temperature,
            max_tokens: max_tokens || 4000, // 降低token数量
          });

          // 处理收集到的内容
          const fullContent = response.choices[0].message.content || "";

          logger.info("Content generation completed", {
            contentLength: fullContent.length,
            isHtml: fullContent.includes("<"),
          });

          // 处理收集到的内容
          if (!fullContent.includes("<")) {
            // 非HTML内容
            return {
              content: fullContent,
              title: keywords
                ? `About: ${keywords.join(", ")}`
                : "Generated Content",
            };
          }

          // 返回HTML内容
          return fullContent;
        } catch (streamError) {
          // 流式调用失败，记录错误
          logger.warn(
            "Streaming API request failed, falling back to standard request",
            {
              error:
                streamError instanceof Error
                  ? streamError.message
                  : String(streamError),
            }
          );

          // 重新创建客户端，移除流式设置
          const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: "https://api.anthropic.com/v1/",
            defaultHeaders: {
              "anthropic-version": "2023-06-01",
            },
          });

          // 尝试常规API调用
          const response = await openai.chat.completions.create({
            model: model,
            messages: [
              ...(systemPrompt
                ? [{ role: "system", content: systemPrompt }]
                : []),
              { role: "user", content: finalPrompt },
            ] as any,
            temperature: temperature,
            max_tokens: max_tokens || 4000,
          });

          const content = response.choices[0].message.content || "";

          if (!content.includes("<")) {
            return {
              content: content,
              title: keywords
                ? `About: ${keywords.join(", ")}`
                : "Generated Content",
            };
          }

          return content;
        }
      } else {
        // JSON输出模式 - 使用常规API调用
        const openai = new OpenAI({
          apiKey: apiKey,
          baseURL: "https://api.anthropic.com/v1/",
          defaultHeaders: {
            "anthropic-version": "2023-06-01",
          },
        });

        const response = await openai.chat.completions.create({
          model: model,
          messages: [
            ...(systemPrompt
              ? [{ role: "system", content: systemPrompt }]
              : []),
            { role: "user", content: finalPrompt },
          ] as any,
          temperature: temperature,
          max_tokens: max_tokens || 4000,
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

        // 非JSON格式，返回文本内容
        if (!content.includes("<")) {
          return {
            content: content,
            title: keywords
              ? `About: ${keywords.join(", ")}`
              : "Generated Content",
          };
        }

        return content;
      }
    } catch (apiError) {
      // 处理API错误
      logger.error(
        "API request failed, trying one more time with simpler parameters",
        {
          error:
            apiError instanceof Error ? apiError.message : String(apiError),
        }
      );

      // 最终尝试：使用最简单的参数
      try {
        const openai = new OpenAI({
          apiKey: apiKey,
          baseURL: "https://api.anthropic.com/v1/",
          defaultHeaders: {
            "anthropic-version": "2023-06-01",
          },
        });

        // 简化提示词，减少token
        const simplifiedPrompt = `${keywords.join(
          ", "
        )}. ${finalPrompt.substring(0, 500)}...`;

        const response = await openai.chat.completions.create({
          model: model,
          messages: [{ role: "user", content: simplifiedPrompt }],
          temperature: 0.7,
          max_tokens: 2000,
        });

        const content = response.choices[0].message.content || "";

        return {
          content: content,
          title: keywords
            ? `About: ${keywords.join(", ")}`
            : "Generated Content",
          simplified: true,
        };
      } catch (finalError) {
        logger.error("All API attempts failed", {
          error:
            finalError instanceof Error
              ? finalError.message
              : String(finalError),
        });

        // 返回备用内容
        return {
          error: "API service unavailable",
          content: `<p>Content generation service is currently unavailable. Please try again later.</p>
<p>Keywords: ${keywords ? keywords.join(", ") : "None provided"}</p>`,
        };
      }
    }
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
