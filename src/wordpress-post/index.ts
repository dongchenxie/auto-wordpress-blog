import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { createLogger } from "./logger";
import { generateContent } from "../claude-service";
// import { imageLoader } from "../image-service/pexels";

// Request body structure definition
interface WordPressPostRequest {
  url: string;
  username: string;
  password: string;
  keywords: string[];

  metaUserPrompt?: string;
  metaSystemPrompt?: string;
  metajson?: boolean;
  contentUserPrompt?: string;
  contentSystemPrompt?: string;
  metainput?: boolean;
  status?: "publish" | "draft" | "pending" | "private";

  apiKey?: string;
  model?: string;
}

// WordPress post data interface
interface WordPressPostData {
  title: string;
  content: string;
  categories: number[];
  tags: number[];
  excerpt: string;
  meta: Record<string, any>;
  status: string;
}

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
  const { url, username, password, keywords } = request;

  // 修改验证逻辑，检查trim后的值
  if (!url || url.trim() === "") return "WordPress URL(url) cannot be empty";
  if (!username || username.trim() === "")
    return "Username(username) cannot be empty";
  if (!password || password.trim() === "")
    return "Password(password) cannot be empty";
  if (!Array.isArray(keywords) || keywords.length === 0)
    return "Keywords(keywords) must be a non-empty array";

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

    // 记录未找到的分类
    const foundNames = result.categoryIds.length;
    if (foundNames < categoryNames.length) {
      const missingCategories = categoryNames.filter((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        return categoriesMap[normalizedName] === undefined;
      });

      // logger.warn("Some categories not found", {
      //   found: foundNames,
      //   total: categoryNames.length,
      //   missing: missingCategories,
      //   missingNormalized: missingCategories.map(normalizeTaxonomyName),
      // });
    }
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

    // 记录未找到的标签
    const foundNames = result.tagIds.length;
    if (foundNames < tagNames.length) {
      const missingTags = tagNames.filter((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        return tagsMap[normalizedName] === undefined;
      });

      // logger.warn("Some tags not found", {
      //   found: foundNames,
      //   total: tagNames.length,
      //   missing: missingTags,
      //   missingNormalized: missingTags.map(normalizeTaxonomyName),
      // });
    }
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
  const logger = createLogger("wordpress-taxonomy");
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
      // logger.error(`Error fetching ${taxonomyType}`, {
      //   error: error instanceof Error ? error.message : String(error),
      //   page,
      // });
      hasMore = false; // 出错时停止获取
    }
  }

  // logger.info(`Completed fetching ${taxonomyType}`, {
  //   totalItems: Object.keys(cacheObj).length,
  // });
};

// WordPress API service
// const wordPressService = {
//   createPost: async (request: WordPressPostRequest): Promise<any> => {
//     const {
//       url,
//       username,
//       password,
//       keywords,
//       prompt,

//       title,
//       content,
//       categories,
//       tags,
//       excerpt,
//       meta,
//       status = "draft", // 默认为草稿

//       apiKey,
//       model,
//     } = request;

//     const logger = createLogger("wordpress-post");

//     // 确定分类和标签的类型和处理方法
//     let categoryIds: number[] = [];
//     let tagIds: number[] = [];

//     // 处理分类
//     if (categories) {
//       if (Array.isArray(categories) && categories.length > 0) {
//         // 检查是否为字符串数组
//         if (typeof categories[0] === "string") {
//           // logger.info("Converting category names to IDs");
//           const result = await getTaxonomyIds(
//             url,
//             { username, password },
//             categories as string[],
//             undefined
//           );
//           categoryIds = result.categoryIds;
//         } else {
//           // 已经是数字ID数组
//           categoryIds = categories as number[];
//         }
//       }
//     }

//     // 处理标签
//     if (tags) {
//       if (Array.isArray(tags) && tags.length > 0) {
//         // 检查是否为字符串数组
//         if (typeof tags[0] === "string") {
//           // logger.info("Converting tag names to IDs");
//           const result = await getTaxonomyIds(
//             url,
//             { username, password },
//             undefined,
//             tags as string[]
//           );
//           tagIds = result.tagIds;
//         } else {
//           // 已经是数字ID数组
//           tagIds = tags as number[];
//         }
//       }
//     }

//     // const tagsInput = keywords?.map((tag) => tag.trim()).filter(Boolean) || [];

//     // Generate content with error handling
//     // let generatedContent;
//     // try {
//     //   generatedContent = await generateContent({
//     //     prompt,
//     //     keywords,
//     //     apiKey,
//     //     model,
//     //   });
//     // } catch (error) {
//     //   // 当内容生成失败时使用备用内容
//     //   logger.warn("Content generation failed, using fallback content");

//     //   // 创建备用内容
//     //   generatedContent = {
//     //     title: `About: ${keywords.join(", ")}`,
//     //     content: `<p>${prompt}</p><p>Keywords: ${keywords.join(", ")}</p>`,
//     //   };
//     // }
//   },
// };

/**
 * WordPress blog post Lambda function
 * Receives a request containing WordPress URL, authentication information, and content
 * Automatically publishes the article and returns the article ID and link
 */
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

    logger.info("Using complete blog generation feature");

    const postData = await generateCompleteWordPressPost(
      requestBody.url,
      { username: requestBody.username, password: requestBody.password },
      requestBody.keywords,
      requestBody.model as any,
      requestBody.metaUserPrompt as any,
      requestBody.metaSystemPrompt as any,
      requestBody.metajson as any,
      requestBody.contentUserPrompt as any,
      requestBody.contentSystemPrompt as any,
      requestBody.metainput as any
    );

    // 添加状态
    postData.status = requestBody.status || "draft";

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
  url: string,
  auth: { username: string; password: string },
  keywords: string[],
  model?: string,
  metaUserPrompt?: string,
  metaSystemPrompt?: string,
  metajson?: boolean,
  contentUserPrompt?: string,
  contentSystemPrompt?: string,
  metainput?: boolean,
  categoryNames: string[] = [],
  tagNames: string[] = []
): Promise<any> {
  const logger = createLogger("wordpress-post-generator");
  logger.info("Generating complete WordPress post", {
    metaUserPrompt: metaUserPrompt,
    metaSystemPrompt: metaSystemPrompt,
    contentUserPrompt: contentUserPrompt,
    contentSystemPrompt: contentSystemPrompt,
    metajson: metajson,
    metainput: metainput,
    keywords: keywords.join(", "),
  });

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
    };

    // 5. 按顺序调用Claude API，避免速率限制
    let metadataResult: any = {};
    let contentResult: any = {};

    const metadataUserPrompt = metaUserPrompt
      ? metaUserPrompt
      : `I have a fishing online wordpress store,url is https://fishingfusion.com/主要是是做fishing产品以及各类相关产品. Remember in this conversation, my store potienal customers are english speakers,Be written in high-quality English, suitable for both enthusiasts and professionals.Think and write one comprehensive, detailed, and academically rigorous blog post topic and outline with main keyword ${primaryKeyword}, and other keywords with high search volume and many people willing to know about it.After the main content, please provide: an SEO blog title with power words containing a number,Blog categories,SEO slug,SEO-optimized tags (comma-separated) , and A compelling excerpt Focus keywords (comma-separated).use Focus Keyword in the SEO Title,Focus Keyword used inside SEO Meta Description,Focus Keyword used in the URL.`;

    try {
      // 构建配置对象
      const config = {
        prompt:
          metadataUserPrompt +
          Object.keys(categoriesMap).join(",") +
          Object.keys(tagsMap).join(","),
        systemPrompt: metaSystemPrompt,
        keywords,
        jsonSchema: metajson ? metadataSchema : undefined,
        model: "claude-3-5-haiku-20241022",
        temperature: 0.5,
        max_tokens: 2000,
      };

      // 打印配置信息
      logger.info("Metadata generation config:", config);

      metadataResult = await generateContent(config);

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
          logger.error("Failed to parse metadata JSON", {
            error: error instanceof Error ? error.message : String(error),
            metadataResult,
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
      }

      // 在两个API调用之间添加显著延迟，避免触发速率限制
      logger.info("Waiting to avoid rate limits before generating content...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 修改提示词，不再要求JSON格式输出
      const contentPrompt = contentUserPrompt
        ? contentUserPrompt
        : `give me the whole blog post of with the main keyword ${primaryKeyword}.Please write about 3000 words and in well-designed html.I need longer writing for SEO optimization purposes. The main keyword density is aimed at around 1%, and other keywords should be 0.5%.Be extensively researched and include in-text citations from real and credible academic sources,websites and news. Provide deep insights into the topic. a Key Takeaways section at the beginning. Include a table of contents at the beginning for easy navigation. Discuss the topic comprehensively, covering all major aspects. Include a comprehensive FAQ section (at least 5 questions) addressing common concerns. Provide a full APA-style reference list with clickable links to sources. Incorporate relevant examples, case studies, and statistics to support key points. Include at least one well-designed visual table( Put the table more toward the front) in the writing to help people understand better, such as a comparison table. Be written in high-quality English, suitable for both enthusiasts and professionals. Include outbound links to reputable external resources for additional information. Be significantly longer and more detailed than a typical blog post, aiming for a comprehensive guide on the topic.Be written in HTML format, promoting trust and encouraging customers to continue shopping and reading on my website. Structure the blog with proper HTML heading tags like <h1>, <h2>, and <h3> to ensure good readability and organization. Incorporate an appealing design by suggesting CSS styling that enhances user experience and visual comfort.`;

      // 构建内容生成配置
      const contentConfig = {
        prompt: metainput ? contentPrompt + metadataResult : contentPrompt,
        systemPrompt: contentSystemPrompt,
        keywords,
        model,
        temperature: 0.7,
        max_tokens: 8196,
      };

      // 打印内容生成配置信息
      logger.info("Content generation config:", contentConfig);

      contentResult = await generateContent(contentConfig);

      logger.info("Content generation successful", {
        contentResult: contentResult,
      });

      // 处理对话模式的响应 (不再作为JSON解析)
      let articleContent = "";
      if (typeof contentResult === "string") {
        // 如果直接返回字符串
        articleContent = contentResult;
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
        }
      } else if (contentResult?.content) {
        // 如果返回对象中包含content字段
        articleContent = contentResult.content;
        // 同样检查是否为Markdown格式
        if (
          typeof articleContent === "string" &&
          articleContent.startsWith("#") &&
          !articleContent.startsWith("<")
        ) {
          logger.warn(
            "Received Markdown format in content field instead of HTML, attempting simple conversion"
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
        }
      } else {
        // 无法获取内容，使用备用内容
        logger.warn("Could not extract content from response, using fallback");
        articleContent = `
          <h1>${primaryKeyword}</h1>
          <p>This is an article about ${primaryKeyword}.</p>
          <p>Keywords: ${keywords.join(", ")}</p>
        `;
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
    const generatedTags = generatedContent.tags || tagNames || keywords;

    if (generatedTags && generatedTags.length > 0) {
      // 处理已存在的标签
      const existingTagIds: number[] = [];
      const tagsToCreate: string[] = [];

      for (const tagName of generatedTags) {
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

    // 9. 构建最终的WordPress文章数据
    const postData = {
      slug: generatedContent.slug,
      title: generatedContent.title,
      content: generatedContent.content,
      excerpt: generatedContent.excerpt,
      rank_math_focus_keyword:
        generatedContent.focus_keywords?.join(",") || keywords.join(","),
      categories: categoryIds,
      tags: tagIds,
    };

    logger.info("WordPress post data prepared", {
      title: postData.title,
      slug: postData.slug,
      categorys: postData.categories,
      tags: postData.tags,
      content: postData.content,
      excerpt: postData.excerpt,
      focusKeyword: postData.rank_math_focus_keyword,
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
      const endpoint = `${url}/wp-json/wp/v2/tags`;
      const response = await axios.post(
        endpoint,
        { name: tagName },
        { auth, timeout: 10000 }
      );

      if (response.data && response.data.id) {
        tagIds.push(response.data.id);
        // logger.info(`Created new tag: ${tagName}`, { id: response.data.id });
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
  keyword: string
): Promise<number | undefined> {
  const logger = createLogger("wordpress-media");

  try {
    // 搜索媒体库中的图片
    const searchTerm = encodeURIComponent(keyword);
    const endpoint = `${url}/wp-json/wp/v2/media?search=${searchTerm}&media_type=image&per_page=1`;

    const response = await axios.get(endpoint, {
      auth,
      timeout: 10000,
    });

    if (response.data && response.data.length > 0) {
      logger.info(`Found matching media for keyword: ${keyword}`, {
        mediaId: response.data[0].id,
      });
      return response.data[0].id;
    }

    // 如果没找到，尝试只使用关键词的一部分
    if (keyword.includes(" ")) {
      const firstWord = keyword.split(" ")[0];
      return findFeaturedMedia(url, auth, firstWord);
    }

    logger.info(`No matching media found for keyword: ${keyword}`);
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
