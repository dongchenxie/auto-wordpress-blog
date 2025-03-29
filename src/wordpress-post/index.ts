import { APIGatewayProxyResult } from "aws-lambda";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { createLogger } from "./logger";
import { generateContent } from "../claude-service";
import { ImageLoader, ImageResult } from "../image-service/pexels";

// Request body structure definition
// 基础接口，包含共同的属性
interface BaseWordPressConfig {
  url: string;
  keywords: string[];
  modelService: string;
  apiKey: string;
  model: string;

  img_endword?: string;
  img_num?: number;

  metaModel?: string;
  metaTemperature?: number;
  metaMax_tokens?: number;
  metaUserPrompt?: string;
  metaSystemPrompt?: string;

  contentMax_tokens?: number;
  contentUserPrompt?: string;
  contentSystemPrompt?: string;
}

// 请求接口，继承基础接口
interface WordPressPostRequest extends BaseWordPressConfig {
  username: string;
  password: string;
}

// 配置接口，继承基础接口
interface WordPressPostConfig extends BaseWordPressConfig {
  auth: { username: string; password: string };
}

// 转换函数
const convertRequestToConfig = (
  request: WordPressPostRequest
): WordPressPostConfig => {
  const { username, password, ...baseConfig } = request;
  return {
    ...baseConfig,
    auth: { username, password },
  };
};

// Error handling function
const createErrorResponse = (
  message: string,
  statusCode = 400
): APIGatewayProxyResult => {
  return formatResponse(statusCode, { error: message });
};

// Success response function
const createSuccessResponse = (
  data: any,
  statusCode = 200
): APIGatewayProxyResult => {
  return formatResponse(statusCode, data);
};

// Response formatting function
const formatResponse = (
  statusCode: number,
  body: any
): APIGatewayProxyResult => {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
  };
};

// Validate request fields
const validateRequest = (request: WordPressPostRequest): string | null => {
  const { url, username, password, keywords, apiKey } = request;
  // 修改验证逻辑，检查trim后的值
  if (!url || url.trim() === "") return "WordPress URL(url) cannot be empty";
  if (!username || username.trim() === "")
    return "Username(username) cannot be empty";
  if (!password || password.trim() === "")
    return "Password(password) cannot be empty";
  if (!Array.isArray(keywords) || keywords.length === 0)
    return "Keywords(keywords) must be a non-empty array";
  // if (!apiKey) {
  //   return "Invalid API key";
  // }

  // URL格式验证
  try {
    new URL(url);
  } catch (e) {
    return "Invalid WordPress URL format";
  }

  return null;
};

/**
 * 规范化分类或标签名称以便于匹配
 * 处理HTML实体编码和Unicode字符差异
 * @param name 需要规范化的名称
 * @returns 规范化后的名称
 */
const normalizeTaxonomyName = (name: string): string => {
  if (!name) return "";
  let normalized = name.toLowerCase();

  // 解码常见HTML实体
  normalized = normalized
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "--")
    .replace(/&hellip;/g, "...");

  // 规范化Unicode特殊字符
  normalized = normalized
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // 智能单引号
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // 智能双引号
    .replace(/\u2026/g, "...") // 省略号
    .replace(/\u2013/g, "-") // en-dash
    .replace(/\u2014/g, "--") // em-dash (修改为双短横线)
    .replace(/\u00A0/g, " "); // 不间断空格

  // 移除多余空格并清理特殊字符
  normalized = normalized
    .replace(/\s+/g, " ") // 多个空格替换为单个
    .trim(); // 移除前后空格

  return normalized;
};

/**
 * 根据名称获取分类和标签的ID
 * @param url WordPress站点URL
 * @param auth 身份验证信息
 * @param categoryNames 分类名称数组
 * @param tagNames 标签名称数组
 * @returns 包含分类ID和标签ID的对象
 */
const getTaxonomyIds = async (
  url: string,
  auth: { username: string; password: string },
  categoryNames?: string[],
  tagNames?: string[]
): Promise<{ categoryIds: number[]; tagIds: number[] }> => {
  // const logger = createLogger("wordpress-taxonomy");
  const result = { categoryIds: [] as number[], tagIds: [] as number[] };

  // 临时存储分类数据的对象
  const categoriesMap: Record<string, number> = {};
  const tagsMap: Record<string, number> = {};

  // 处理分类
  if (categoryNames && categoryNames.length > 0) {
    // logger.info("Fetching categories data");
    await fetchAllTaxonomies(url, auth, "categories", categoriesMap);

    // 映射分类名称到ID，使用规范化后的名称查询
    result.categoryIds = categoryNames
      .map((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        const id = categoriesMap[normalizedName];
        return id;
      })
      .filter((id) => id !== undefined);
  }

  // 处理标签
  if (tagNames && tagNames.length > 0) {
    // logger.info("Fetching tags data");
    await fetchAllTaxonomies(url, auth, "tags", tagsMap);

    // 映射标签名称到ID，使用规范化后的名称查询
    result.tagIds = tagNames
      .map((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        const id = tagsMap[normalizedName];
        return id;
      })
      .filter((id) => id !== undefined);
  }

  return result;
};

/**
 * 获取所有分类或标签数据
 * @param url WordPress站点URL
 * @param auth 身份验证信息
 * @param taxonomyType 分类类型（categories或tags）
 * @param cacheObj 临时存储对象
 */
const fetchAllTaxonomies = async (
  url: string,
  auth: { username: string; password: string },
  taxonomyType: "categories" | "tags",
  cacheObj: Record<string, number>
): Promise<void> => {
  const config: AxiosRequestConfig = {
    auth,
    timeout: 10000,
  };

  let page = 1;
  const perPage = 100; // 每页获取最大数量
  let hasMore = true;

  // logger.info(`Fetching WordPress ${taxonomyType}`, { url, page });

  while (hasMore) {
    try {
      const endpoint = `${url}/wp-json/wp/v2/${taxonomyType}?page=${page}&per_page=${perPage}`;
      const response = await axios.get(endpoint, config);
      const items = response.data;

      // 如果返回空数组，表示没有更多数据
      if (!items || items.length === 0) {
        hasMore = false;
        break;
      }

      // 将获取的数据添加到缓存
      items.forEach((item: any) => {
        if (item.id && item.name) {
          // 使用规范化的名称作为键
          const normalizedName = normalizeTaxonomyName(item.name);
          cacheObj[normalizedName] = item.id;

          // 原始小写名称作为备用键
          cacheObj[item.name.toLowerCase()] = item.id;

          // 缓存规范化的slug
          if (item.slug) {
            const normalizedSlug = normalizeTaxonomyName(item.slug);
            cacheObj[normalizedSlug] = item.id;
            cacheObj[item.slug.toLowerCase()] = item.id;
          }
        }
      });

      // 如果获取的数据少于perPage，表示已经是最后一页
      if (items.length < perPage) {
        hasMore = false;
      } else {
        // 翻到下一页
        page++;
        // 添加延迟，避免频繁请求
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      hasMore = false; // 出错时停止获取
    }
  }
};

export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("wordpress-post", event);
  try {
    // 验证请求体是否存在
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Request body cannot be empty" }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    // 验证请求体是否为有效JSON
    let requestBody: WordPressPostRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid request body JSON format" }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    // 验证请求体是否包含所需字段并且不为空对象
    if (!requestBody || Object.keys(requestBody).length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Request body cannot be empty" }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }

    // 验证请求字段
    const validationError = validateRequest(requestBody);
    if (validationError) {
      logger.error("Validation failed", {
        error: validationError,
        request: requestBody,
      });
      return createErrorResponse(validationError, 400);
    }
    const inputConfig = convertRequestToConfig(requestBody);
    const postData = await generateCompleteWordPressPost(inputConfig);

    // 添加状态
    postData.status = "draft";

    // 发送到WordPress
    const endpoint = `${requestBody.url}/wp-json/wp/v2/posts`;
    const config: AxiosRequestConfig = {
      headers: { "Content-Type": "application/json" },
      auth: {
        username: requestBody.username,
        password: requestBody.password,
      },
      timeout: 30000, // 增加超时时间
    };

    const response = await axios.post(endpoint, postData, config);
    // 返回成功响应
    // logger.info("Post created successfully", { postId: response.data.id });
    return createSuccessResponse(
      {
        message: "Article published successfully",
        postId: response.data.id,
        postUrl: response.data.link,
      },
      201
    );
  } catch (error) {
    // 处理API错误
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status || 500;

      // 提供基于错误类型的具体错误信息
      if (statusCode === 401) {
        logger.error("Authentication failed", { status: 401 });
        return createErrorResponse(
          "WordPress authentication failed, please check username and password",
          401
        );
      } else if (statusCode === 403) {
        logger.error("Permission denied", { status: 403 });
        return createErrorResponse(
          "Insufficient permissions, user cannot publish articles",
          403
        );
      } else if (statusCode === 404) {
        logger.error("Endpoint not found", { status: 404 });
        return createErrorResponse(
          "WordPress API endpoint not found, please check the URL",
          404
        );
      }

      // 一般API错误
      const errorMessage =
        (axiosError.response?.data as { message?: string })?.message ||
        axiosError.message;
      logger.error("WordPress API error", {
        status: statusCode,
        message: errorMessage,
      });
      return createErrorResponse(
        `WordPress API error: ${errorMessage}`,
        statusCode
      );
    }

    // 未知错误处理
    logger.error("Unexpected error", { error: String(error) });
    return createErrorResponse("Internal server error", 500);
  }
};

/**
 * 生成完整的WordPress文章，处理类别、标签、特色图片等
 * 拆分为两个并行API请求以提高效率
 */
export async function generateCompleteWordPressPost(
  inputConfig: WordPressPostConfig
): Promise<any> {
  const logger = createLogger("wordpress-post-generator");
  let {
    url,
    auth,
    keywords,
    modelService,
    apiKey,
    model,

    img_endword,
    img_num,

    metaModel,
    metaTemperature,
    metaMax_tokens,
    metaUserPrompt,
    metaSystemPrompt,

    contentMax_tokens,
    contentUserPrompt,
    contentSystemPrompt,
  } = inputConfig;

  // 现在可以方便地记录所有配置
  logger.info("Generating complete WordPress post", {
    inputConfig: inputConfig,
  });

  let categoryNames: string[] = [];
  let tagNames: string[] = [];
  try {
    // 1. 获取所有分类和标签
    const categoriesMap: Record<string, number> = {};
    const tagsMap: Record<string, number> = {};

    await Promise.all([
      fetchAllTaxonomies(url, auth, "categories", categoriesMap),
      fetchAllTaxonomies(url, auth, "tags", tagsMap),
    ]);

    // 2. 准备关键词替换
    const primaryKeyword = keywords[0];

    // 3. 替换关键词占位符
    // 替换文本中的关键词占位符,仅当文本包含${primaryKeyword}时才进行替换
    const replaceKeywordPlaceholders = (text: string | undefined): string => {
      if (!text) return "";
      text = text ? text.toString() : "";
      // 检查是否包含${primaryKeyword}占位符
      if (text.includes("${primaryKeyword}")) {
        return text.replace(/\${primaryKeyword}/g, primaryKeyword);
      }
      return text;
    };

    // 替换用户提供的提示词中的占位符
    metaUserPrompt = replaceKeywordPlaceholders(metaUserPrompt);
    metaSystemPrompt = replaceKeywordPlaceholders(metaSystemPrompt);
    contentUserPrompt = replaceKeywordPlaceholders(contentUserPrompt);
    contentSystemPrompt = replaceKeywordPlaceholders(contentSystemPrompt);

    // 4. 定义两个不同的JSON输出结构
    const metadataSchema = {
      slug: "string",
      title: "string",
      excerpt: "string",
      categories: ["string"],
      tags: ["string"],
      focus_keywords: ["string"],
      image_keywords: ["string"],
    };

    // 5. 按顺序调用Claude API，避免速率限制
    let metadataResult: any = {};
    let contentResult: any = {};

    const metadataUserPrompt = metaUserPrompt
      ? metaUserPrompt
      : `I have a fishing online wordpress store,url is https://fishingfusion.com/主要是是做fishing产品以及各类相关产品. Remember in this conversation, my store potienal customers are english speakers,Be written in high-quality English, suitable for both enthusiasts and professionals.Think and write one comprehensive, detailed, and academically rigorous blog post topic and outline with main keyword ${primaryKeyword}, and other keywords with high search volume and many people willing to know about it.After the main content, please provide: an SEO blog title with power words containing a number,Blog categories,SEO slug,SEO-optimized tags (comma-separated) ,3 precise image_search_keywords for image API (be short and specific) and A compelling excerpt Focus keywords (comma-separated).use Focus Keyword in the SEO Title,Focus Keyword used inside SEO Meta Description,Focus Keyword used in the URL.`;

    try {
      // 构建配置对象
      const metadataConfig = {
        prompt: metadataUserPrompt + Object.keys(categoriesMap).join(","),
        keywords: keywords,
        serviceType: modelService,
        apiKey: apiKey,
        model: metaModel || model,
        systemPrompt: metaSystemPrompt,
        jsonSchema: metadataSchema,
        temperature: metaTemperature || 0.5,
        max_tokens: metaMax_tokens || 2000,
      };

      // 打印配置信息
      logger.info("Metadata generation metadataConfig:", metadataConfig);
      metadataResult = await generateContent(metadataConfig);
      logger.info("Metadata generation successful", {
        metadataResult: metadataResult,
      });

      // 处理返回的元数据结果
      if (typeof metadataResult === "string") {
        try {
          metadataResult = JSON.parse(metadataResult);
          logger.info("Metadata JSON parsed successfully", {
            parsedMetadata: metadataResult,
          });
        } catch (error) {
          logger.warn("Failed to parse metadata JSON", {
            error: error instanceof Error ? error.message : String(error),
            metadataResult,
          });

          // 尝试清理 Markdown 代码块标记后再解析
          if (typeof metadataResult === "string") {
            try {
              // 移除开头的 ```json\n 和结尾的 ```
              let cleanedJson = metadataResult;
              if (cleanedJson.includes("```")) {
                logger.info("Attempting to clean Markdown code block markers");
                // 移除开始的 ```json 或其他代码块标记
                cleanedJson = cleanedJson.replace(/```[a-z]*\n/g, "");
                // 移除结束的 ```
                cleanedJson = cleanedJson.replace(/\n```/g, "");

                // 尝试解析清理后的 JSON
                metadataResult = JSON.parse(cleanedJson);
                logger.info(
                  "Successfully parsed JSON after cleaning Markdown markers"
                );
              }
            } catch (cleanError) {
              logger.error("Failed to parse JSON even after cleaning", {
                error:
                  cleanError instanceof Error
                    ? cleanError.message
                    : String(cleanError),
              });

              // 如果解析失败，创建一个基本的元数据对象
              metadataResult = {
                title: `Ultimate Guide to ${primaryKeyword}`,
                slug: primaryKeyword.toLowerCase().replace(/\s+/g, "-"),
                excerpt: `Discover everything you need to know about ${primaryKeyword} in this comprehensive guide.`,
                categories: categoryNames || ["Fishing"],
                tags: tagNames || keywords,
                focus_keywords: keywords,
              };
            }
          } else {
            // 如果解析失败，创建一个基本的元数据对象
            metadataResult = {
              title: `Ultimate Guide to ${primaryKeyword}`,
              slug: primaryKeyword.toLowerCase().replace(/\s+/g, "-"),
              excerpt: `Discover everything you need to know about ${primaryKeyword} in this comprehensive guide.`,
              categories: categoryNames,
              tags: tagNames || keywords,
              focus_keywords: keywords,
            };
          }
        }
      }

      // 在两个API调用之间添加显著延迟，避免触发速率限制
      // logger.info("Waiting to avoid rate limits before generating content...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 修改提示词，不再要求JSON格式输出
      const contentPrompt = contentUserPrompt
        ? contentUserPrompt
        : `give me the whole blog post of with the main keyword ${primaryKeyword}.Please write about 3000 words and in well-designed html.I need longer writing for SEO optimization purposes. The main keyword density is aimed at around 1%, and other keywords should be 0.5%.Be extensively researched and include in-text citations from real and credible academic sources,websites and news. Provide deep insights into the topic. a Key Takeaways section at the beginning. Include a table of contents at the beginning for easy navigation. Discuss the topic comprehensively, covering all major aspects. Include a comprehensive FAQ section (at least 5 questions) addressing common concerns. Provide a full APA-style reference list with clickable links to sources. Incorporate relevant examples, case studies, and statistics to support key points. Include at least one well-designed visual table( Put the table more toward the front) in the writing to help people understand better, such as a comparison table. Be written in high-quality English, suitable for both enthusiasts and professionals. Include outbound links to reputable external resources for additional information. Be significantly longer and more detailed than a typical blog post, aiming for a comprehensive guide on the topic.Be written in HTML format, promoting trust and encouraging customers to continue shopping and reading on my website. Structure the blog with proper HTML heading tags like <h1>, <h2>, and <h3> to ensure good readability and organization. Incorporate an appealing design by suggesting CSS styling that enhances user experience and visual comfort.`;

      // 构建内容生成配置
      const contentConfig = {
        prompt: contentPrompt,
        keywords: keywords,
        serviceType: modelService,
        apiKey: apiKey,
        model: model,
        systemPrompt: contentSystemPrompt,
        temperature: 0.7,
        max_tokens: contentMax_tokens || 8196,
      };

      // 打印内容生成配置信息
      logger.info("Content generation contentConfig:", contentConfig);
      contentResult = await generateContent(contentConfig);
      logger.info("Metadata generation successful", {
        contentResult: contentResult,
      });
      let articleContent = "";
      if (typeof contentResult === "string") {
        // 如果直接返回字符串
        articleContent = contentResult;

        // 1. 首先尝试提取JSON中的content字段
        try {
          const jsonContent = JSON.parse(articleContent);
          if (jsonContent && typeof jsonContent.content === "string") {
            articleContent = jsonContent.content;
            logger.warn("Extracted content from JSON response");
          }
        } catch (e) {
          // 如果不是JSON格式，继续使用原始内容
          logger.warn("Response is not in JSON format, using as-is");
        }

        // 2. 移除开头的解释性文本
        if (articleContent.includes("<!DOCTYPE html>")) {
          const doctypeIndex = articleContent.indexOf("<!DOCTYPE html>");
          articleContent = articleContent.substring(doctypeIndex);
          logger.warn("Removed explanatory text before DOCTYPE");
        }

        // 3. 移除Markdown代码块标记
        if (articleContent.includes("```")) {
          logger.warn("Removing Markdown code block markers from content");

          // 更全面的正则表达式处理
          // 处理开头的代码块标记 (```html, ```javascript 等)
          articleContent = articleContent.replace(/```[a-z]*\n/g, "");
          articleContent = articleContent.replace(/\n\s*```\s*/g, "");
          articleContent = articleContent.replace(
            /```[a-z]*\s(.*?)\s```/g,
            "$1"
          );
          articleContent = articleContent.replace(/```/g, "");
        }

        // 4. 处理HTML结尾后的额外内容
        if (articleContent.includes("</html>")) {
          const htmlEndIndex = articleContent.indexOf("</html>") + 7;
          articleContent = articleContent.substring(0, htmlEndIndex);
          logger.warn("Removed content after HTML end tag");
        }

        // 将处理后的内容赋值回contentResult
        contentResult = articleContent;

        // 检查是否返回了Markdown格式而非HTML
        if (articleContent.startsWith("#") && !articleContent.startsWith("<")) {
          logger.warn(
            "Received Markdown format instead of HTML, attempting simple conversion"
          );
          // 简单转换Markdown标题为HTML标题
          articleContent = articleContent
            .replace(/^# (.*$)/gm, "<h1>$1</h1>")
            .replace(/^## (.*$)/gm, "<h2>$1</h2>")
            .replace(/^### (.*$)/gm, "<h3>$1</h3>")
            .replace(/^#### (.*$)/gm, "<h4>$1</h4>")
            .replace(/^##### (.*$)/gm, "<h5>$1</h5>")
            .replace(/^###### (.*$)/gm, "<h6>$1</h6>")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            .replace(/\n\n/g, "</p><p>")
            .replace(/^\s*\n/gm, "</p><p>");
          articleContent = "<p>" + articleContent + "</p>";

          // 将转换后的内容赋值回contentResult
          contentResult = articleContent;
        }
      } else {
        // 无法获取内容，使用备用内容
        logger.warn("Could not extract content from response, using fallback");
        articleContent = `
          <h1>${primaryKeyword}</h1>
          <p>This is an article about ${primaryKeyword}.</p>
          <p>Keywords: ${keywords.join(", ")}</p>
        `;
        // 将备用内容赋值给contentResult
        contentResult = articleContent;
      }
    } catch (error) {
      // 错误处理，检查是否为速率限制错误
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isRateLimit =
        errorMessage.includes("429") || errorMessage.includes("rate limit");

      logger.error("API request failed", {
        error: errorMessage,
        isRateLimit,
      });

      // 如果是第一个请求（元数据）失败
      if (!metadataResult || Object.keys(metadataResult).length === 0) {
        logger.info("Using fallback metadata");
        metadataResult = {
          title: `Ultimate Guide to ${primaryKeyword}`,
          slug: primaryKeyword.toLowerCase().replace(/\s+/g, "-"),
          excerpt: `Discover everything you need to know about ${primaryKeyword} in this comprehensive guide.`,
          categories: categoryNames || ["Fishing"],
          tags: tagNames || keywords,
          focus_keywords: keywords,
        };
      }

      // 如果是第二个请求（内容）失败
      if (!contentResult || !contentResult.content) {
        logger.info("Using fallback content");
        contentResult = {
          content: `
<h1>${metadataResult.title || `About ${primaryKeyword}`}</h1>

<p>This article provides detailed information about ${primaryKeyword}. If you're interested in fishing equipment, this guide will help you make informed decisions.</p>

<h2>Key Points About ${primaryKeyword}</h2>
<ul>
  <li>Important considerations when choosing ${primaryKeyword}</li>
  <li>How to find the best ${primaryKeyword} for your needs</li>
  <li>Maintaining your ${primaryKeyword} properly</li>
</ul>

<p>Keywords: ${keywords.join(", ")}</p>
`,
        };
      }
    }

    logger.info("Content and metadata generated successfully", {
      contentResult,
      metadataResult,
    });

    // 6. 合并两个API请求的结果
    const generatedContent = {
      content: contentResult as any,
      slug: (metadataResult as any).slug,
      title: (metadataResult as any).title,
      excerpt: (metadataResult as any).excerpt,
      categories: (metadataResult as any).categories,
      tags: (metadataResult as any).tags,
      focus_keywords: (metadataResult as any).focus_keywords,
      image_keywords: (metadataResult as any).image_keywords,
    };

    // 7. 处理分类
    const categoryIds: number[] = [];
    const generatedCategories = generatedContent.categories ||
      categoryNames || ["Fishing"];

    for (const categoryName of generatedCategories) {
      const normalized = normalizeTaxonomyName(categoryName);

      // 直接匹配或模糊匹配
      if (categoriesMap[normalized]) {
        categoryIds.push(categoriesMap[normalized]);
      } else {
        // 尝试模糊匹配
        const fuzzyMatch = findFuzzyMatch(
          normalized,
          Object.keys(categoriesMap)
        );
        if (fuzzyMatch && categoriesMap[fuzzyMatch]) {
          categoryIds.push(categoriesMap[fuzzyMatch]);
        }
      }
    }

    // 8. 处理标签
    let tagIds: number[] = [];
    let generatedTags = generatedContent.tags || tagNames || keywords;

    // 处理 tags 可能是字符串的情况
    if (typeof generatedTags === "string") {
      generatedTags = generatedTags.split(",").map((tag) => tag.trim());
    } else if (Array.isArray(generatedTags) && generatedTags.length > 0) {
      // 检查数组中的每个元素是否包含逗号，如果包含则需要进一步分割
      const expandedTags: string[] = [];
      for (const tag of generatedTags) {
        if (typeof tag === "string" && tag.includes(",")) {
          // 如果标签字符串包含逗号，则分割成多个标签
          expandedTags.push(...tag.split(",").map((t) => t.trim()));
        } else {
          expandedTags.push(tag);
        }
      }
      generatedTags = expandedTags;
    }

    if (generatedTags && generatedTags.length > 0) {
      // 处理已存在的标签
      const existingTagIds: number[] = [];
      const tagsToCreate: string[] = [];

      for (const tagName of generatedTags) {
        // 跳过空标签
        if (!tagName || typeof tagName !== "string" || tagName.trim() === "") {
          continue;
        }

        const normalized = normalizeTaxonomyName(tagName);
        if (tagsMap[normalized]) {
          existingTagIds.push(tagsMap[normalized]);
        } else {
          tagsToCreate.push(tagName);
        }
      }

      // 创建新标签
      if (tagsToCreate.length > 0) {
        const newTagIds = await createNewTags(url, auth, tagsToCreate);
        tagIds = [...existingTagIds, ...newTagIds];
      } else {
        tagIds = existingTagIds;
      }
    }

    // 9. 获取图片并插入到文章内容中
    let imageKeywords = generatedContent.image_keywords || [primaryKeyword];

    // 确保imageKeywords是数组
    if (!Array.isArray(imageKeywords)) {
      if (typeof imageKeywords === "string") {
        imageKeywords = imageKeywords.split(",").map((k) => k.trim());
      } else {
        imageKeywords = [primaryKeyword];
      }
    }
    let final_img_num = img_num ? img_num : 3;

    try {
      // 首先从WordPress Media库搜索图片
      const wpMediaImages = [];

      // 随机打乱关键词顺序
      const shuffledKeywords = [...imageKeywords].sort(
        () => Math.random() - 0.5
      );

      // 尝试从WordPress Media库获取图片
      for (const keyword of shuffledKeywords) {
        try {
          const mediaEndpoint = `${url}/wp-json/wp/v2/media?search=${encodeURIComponent(
            keyword
          )}&per_page=5`;
          const response = await axios.get(mediaEndpoint, { auth });
          const items = response.data;

          if (items && items.length > 0) {
            // 过滤并格式化媒体项
            const mediaItems = items.map((item: any) => ({
              url: item.source_url,
              sizes: {
                large2x:
                  item.media_details?.sizes?.large?.source_url ||
                  item.source_url,
                large:
                  item.media_details?.sizes?.large?.source_url ||
                  item.source_url,
                medium:
                  item.media_details?.sizes?.medium?.source_url ||
                  item.source_url,
                small:
                  item.media_details?.sizes?.thumbnail?.source_url ||
                  item.source_url,
              },
            }));
            wpMediaImages.push(...mediaItems);
            logger.info(
              `Found ${mediaItems.length} images in WordPress Media Library for keyword: ${keyword}`
            );
          }
        } catch (error) {
          logger.warn(
            `Failed to get images from WordPress Media Library for keyword: ${keyword}`,
            {
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      // 随机打乱WordPress图片
      const shuffledWPImages = [...wpMediaImages].sort(
        () => Math.random() - 0.5
      );

      // 如果WordPress Media库中的图片不够，才使用Pexels
      let allImages = [...shuffledWPImages];
      if (allImages.length < final_img_num) {
        logger.info(
          `WordPress Media Library only has ${allImages.length} images, fetching more from Pexels...`
        );
        const remainingCount = final_img_num - allImages.length;

        // 获取Pexels图片
        const imageLoader = new ImageLoader();
        for (const keyword of shuffledKeywords) {
          if (allImages.length >= final_img_num) break;

          try {
            const pexelsImages = await imageLoader.getImages(
              keyword,
              remainingCount
            );
            if (pexelsImages && pexelsImages.length > 0) {
              allImages.push(...pexelsImages);
              logger.info(
                `Found ${pexelsImages.length} additional images from Pexels for keyword: ${keyword}`
              );
            }
          } catch (error) {
            logger.warn(
              `Failed to get images from Pexels for keyword: ${keyword}`,
              {
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }

      // 限制图片数量并随机打乱
      allImages = allImages
        .slice(0, final_img_num)
        .sort(() => Math.random() - 0.5);

      // 后续的图片插入逻辑
      if (allImages.length > 0) {
        let content = generatedContent.content;
        const headingEndPositions = [];
        const headingRegex = /<\/h[1-4]>/gi;
        let match;
        const usedImageUrls = new Set(); // 使用 Set 来追踪已使用的图片 URL

        // 找到所有标题结束位置
        while ((match = headingRegex.exec(content)) !== null) {
          headingEndPositions.push({
            index: match.index,
            length: match[0].length,
          });
        }

        if (headingEndPositions.length > 0) {
          // 确保不超过可用的标题数和图片数
          const maxInserts = Math.min(
            final_img_num,
            allImages.length,
            headingEndPositions.length
          );
          const selectedPositions = [
            ...Array(headingEndPositions.length).keys(),
          ]
            .sort(() => Math.random() - 0.5)
            .slice(0, maxInserts);

          // 按位置从后向前插入，避免位置错乱
          selectedPositions.sort((a, b) => b - a);

          for (const posIndex of selectedPositions) {
            const pos = headingEndPositions[posIndex];

            // 查找未使用的图片
            const unusedImage = allImages.find((img) => {
              const imgUrl = img.sizes.large2x || img.sizes.large || img.url;
              return !usedImageUrls.has(imgUrl);
            });

            if (!unusedImage) {
              logger.warn("No unused images available, skipping insertion");
              continue;
            }

            const imageUrl =
              unusedImage.sizes.large2x ||
              unusedImage.sizes.large ||
              unusedImage.url;
            usedImageUrls.add(imageUrl); // 记录已使用的图片URL

            const keyword =
              shuffledKeywords[posIndex % shuffledKeywords.length];
            const imgHtml = `
    <figure class="wp-block-image">
      <img src="${imageUrl}" alt="${keyword}" class="wp-image"/>
    </figure>`;

            const insertPosition = pos.index + pos.length;
            content =
              content.slice(0, insertPosition) +
              imgHtml +
              content.slice(insertPosition);

            logger.info(`Inserted unique image at position ${insertPosition}`, {
              imageUrl,
              keyword,
            });
          }

          // 更新内容
          generatedContent.content = content;
        } else {
          // 如果没有找到标题标签，只插入一张图片在开头
          const imageData = allImages[0];
          const imageUrl =
            imageData.sizes.large2x || imageData.sizes.large || imageData.url;
          const keyword = shuffledKeywords[0];

          const imgHtml = `
    <figure class="wp-block-image">
      <img src="${imageUrl}" alt="${keyword}" class="wp-image"/>
    </figure>`;

          generatedContent.content = imgHtml + content;
          logger.info("Inserted single image at the beginning of content", {
            imageUrl,
            keyword,
          });
        }
      } else {
        logger.warn("No images found on Pexels for any of the keywords", {
          imageKeywords,
          primaryKeyword,
        });
      }
    } catch (error) {
      logger.error("Failed to insert Pexels images into content", {
        error: error instanceof Error ? error.message : String(error),
        keyword: primaryKeyword,
      });
    }

    // 处理image_keywords,确保其为字符串数组格式
    let featured_image_keywords: string[] = [];
    featured_image_keywords = [...imageKeywords, img_endword];

    let featured_media_id = await findFeaturedMedia(
      url,
      auth,
      featured_image_keywords
    );
    logger.info("Featured media ID:", featured_media_id);
    // 处理 focus_keywords，确保它是字符串或字符串数组
    let focusKeywordsString: string;
    if (typeof generatedContent.focus_keywords === "string") {
      // 如果已经是字符串，直接使用
      focusKeywordsString = generatedContent.focus_keywords;
    } else if (Array.isArray(generatedContent.focus_keywords)) {
      // 如果是数组，使用 join 方法
      focusKeywordsString = generatedContent.focus_keywords.join(",");
    } else {
      // 如果是其他类型或 undefined，使用 keywords 数组
      focusKeywordsString = keywords.join(",");
    }

    // 构建最终的WordPress文章数据
    const postData = {
      slug: generatedContent.slug,
      title: generatedContent.title,
      content: generatedContent.content,
      excerpt: generatedContent.excerpt,
      rank_math_focus_keyword: focusKeywordsString,
      categories: categoryIds,
      tags: tagIds,
      featured_media: featured_media_id,
    };

    logger.info("WordPress post data prepared", {
      postData: postData,
    });

    return postData;
  } catch (error) {
    logger.error("Error generating WordPress post", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 创建新标签并返回创建的标签ID数组
 */
async function createNewTags(
  url: string,
  auth: { username: string; password: string },
  tagNames: string[]
): Promise<number[]> {
  const tagIds: number[] = [];
  const logger = createLogger("wordpress-tags");

  for (const tagName of tagNames) {
    try {
      // 跳过过长的标签名（WordPress通常限制在200个字符以内）
      if (tagName.length > 200) {
        logger.warn(
          `Skipping tag that exceeds length limit: ${tagName.substring(
            0,
            50
          )}...`
        );
        continue;
      }

      const endpoint = `${url}/wp-json/wp/v2/tags`;
      const response = await axios.post(
        endpoint,
        { name: tagName },
        { auth, timeout: 10000 }
      );

      if (response.data && response.data.id) {
        tagIds.push(response.data.id);
        logger.info(`Created new tag: ${tagName}`, { id: response.data.id });
      }
    } catch (error) {
      logger.error(`Failed to create tag: ${tagName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return tagIds;
}

/**
 * 在现有WordPress媒体库中查找与关键词相关的图片
 */
async function findFeaturedMedia(
  url: string,
  auth: { username: string; password: string },
  keyword: string[]
): Promise<number | undefined> {
  const logger = createLogger("wordpress-media");

  try {
    // 收集所有关键词搜索到的图片
    const allMedia: Array<{ id: number; title: string }> = [];

    // 按顺序遍历关键词数组搜索图片
    for (const kw of keyword) {
      const searchTerm = encodeURIComponent(kw);

      // 使用不同的排序参数进行多次搜索以增加随机性
      const orderParams = [
        { orderby: "date", order: "desc" },
        { orderby: "date", order: "asc" },
        { orderby: "modified", order: "desc" },
        { orderby: "modified", order: "asc" },
      ];

      // 随机选择一个排序参数
      const randomParam =
        orderParams[Math.floor(Math.random() * orderParams.length)];

      const endpoint = `${url}/wp-json/wp/v2/media?search=${searchTerm}&media_type=image&per_page=100&orderby=${randomParam.orderby}&order=${randomParam.order}`;

      const response = await axios.get(endpoint, {
        auth,
        timeout: 10000,
      });

      if (response.data && response.data.length > 0) {
        // 将搜索结果添加到总集合中
        allMedia.push(
          ...response.data.map((item: any) => ({
            id: item.id,
            title: item.title?.rendered || "",
          }))
        );
      }
    }

    if (allMedia.length > 0) {
      // 随机选择一张图片
      const randomIndex = Math.floor(Math.random() * allMedia.length);
      const selectedMedia = allMedia[randomIndex];

      logger.info(`Selected random media from ${allMedia.length} results`, {
        mediaId: selectedMedia.id,
        mediaTitle: selectedMedia.title,
      });
      return selectedMedia.id;
    }
    logger.warn(`No matching media found for keyword: ${keyword}`);
    return undefined;
  } catch (error) {
    logger.error(`Error finding featured media for: ${keyword}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * 简单的模糊匹配函数，用于匹配分类名
 */
function findFuzzyMatch(
  target: string,
  candidates: string[]
): string | undefined {
  // 精确匹配
  if (candidates.includes(target)) {
    return target;
  }

  // 包含匹配
  const containsMatches = candidates.filter(
    (c) => c.includes(target) || target.includes(c)
  );

  if (containsMatches.length > 0) {
    // 返回长度最接近的匹配
    return containsMatches.reduce((closest, current) =>
      Math.abs(current.length - target.length) <
      Math.abs(closest.length - closest.length)
        ? current
        : closest
    );
  }

  return undefined;
}

// 为测试目的导出内部函数
export {
  formatResponse,
  normalizeTaxonomyName,
  validateRequest,
  getTaxonomyIds,
  fetchAllTaxonomies,
  createErrorResponse,
  createSuccessResponse,
};
