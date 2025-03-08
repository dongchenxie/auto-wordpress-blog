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

  prompt?: string;
  title?: string;
  content?: string;
  categories?: number[] | string[]; // 支持数字ID或字符串名称
  tags?: number[] | string[]; // 支持数字ID或字符串名称
  excerpt?: string;
  meta?: Record<string, any>;
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
const wordPressService = {
  createPost: async (request: WordPressPostRequest): Promise<any> => {
    const {
      url,
      username,
      password,
      keywords,
      prompt,

      title,
      content,
      categories,
      tags,
      excerpt,
      meta,
      status = "draft", // 默认为草稿

      apiKey,
      model,
    } = request;

    const logger = createLogger("wordpress-post");

    // 确定分类和标签的类型和处理方法
    let categoryIds: number[] = [];
    let tagIds: number[] = [];

    // 处理分类
    if (categories) {
      if (Array.isArray(categories) && categories.length > 0) {
        // 检查是否为字符串数组
        if (typeof categories[0] === "string") {
          // logger.info("Converting category names to IDs");
          const result = await getTaxonomyIds(
            url,
            { username, password },
            categories as string[],
            undefined
          );
          categoryIds = result.categoryIds;
        } else {
          // 已经是数字ID数组
          categoryIds = categories as number[];
        }
      }
    }

    // 处理标签
    if (tags) {
      if (Array.isArray(tags) && tags.length > 0) {
        // 检查是否为字符串数组
        if (typeof tags[0] === "string") {
          // logger.info("Converting tag names to IDs");
          const result = await getTaxonomyIds(
            url,
            { username, password },
            undefined,
            tags as string[]
          );
          tagIds = result.tagIds;
        } else {
          // 已经是数字ID数组
          tagIds = tags as number[];
        }
      }
    }

    // const tagsInput = keywords?.map((tag) => tag.trim()).filter(Boolean) || [];

    // Generate content with error handling
    // let generatedContent;
    // try {
    //   generatedContent = await generateContent({
    //     prompt,
    //     keywords,
    //     apiKey,
    //     model,
    //   });
    // } catch (error) {
    //   // 当内容生成失败时使用备用内容
    //   logger.warn("Content generation failed, using fallback content");

    //   // 创建备用内容
    //   generatedContent = {
    //     title: `About: ${keywords.join(", ")}`,
    //     content: `<p>${prompt}</p><p>Keywords: ${keywords.join(", ")}</p>`,
    //   };
    // }
  },
};

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
      requestBody.prompt as any,
      requestBody.model as any
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
      timeout: 10 * 60 * 1000, // 增加超时时间
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

// 定义内容策略模板，包含关键词占位符
const contentStrategyPrompt = `
CONTENT STRATEGY REQUIREMENTS
Primary Focus: Generate comprehensive, research-based blog content strategy
Main Keyword: "{PRIMARY_KEYWORD}" (must be incorporated naturally throughout)
Secondary Keywords: {SECONDARY_KEYWORDS}
Content Goal: Position FishingFusion.com as an authoritative resource on fishing equipment
DELIVERABLE REQUIREMENTS
Topic Selection: Identify a specific, search-optimized topic related to {PRIMARY_KEYWORD}
Detailed Outline: Provide structured H2/H3 sections encompassing all critical aspects of the topic
Comprehensive Metadata Package: Include all SEO elements specified below
METADATA SPECIFICATIONS
SEO Title: Create compelling title with:
- Main keyword "{PRIMARY_KEYWORD}" positioned near beginning
- Inclusion of a specific number (e.g., "7 Best", "5 Ways", etc.)
- Incorporation of power words for click-through optimization
- Maximum 60 characters for optimal display
Blog Categories: Recommend 1-2 appropriate WordPress categories
SEO Slug: Create concise, keyword-rich URL segment:
- Must include main keyword "{PRIMARY_KEYWORD}"
- Exclude stop words (a, the, and, etc.)
- Use hyphens as word separators
- Maximum 5-6 words total
SEO-Optimized Tags: Provide 5-8 relevant tags:
- Present as comma-separated list
- Include primary and secondary keywords
- Target specific search terms users might employ
Compelling Excerpt: Create 150-160 character summary that:
- Incorporates main keyword naturally
- Highlights key value proposition of the content
- Contains clear call-to-action element
Focus Keywords: Identify 3-5 primary terms to optimize for:
- Present as comma-separated list
- Lead with "{PRIMARY_KEYWORD}" as primary term
- Include terms with high search volume and moderate competition
IMPLEMENTATION REQUIREMENTS
Keyword Integration: Ensure primary keyword appears in:
- SEO title (near beginning)
- Meta description
- URL slug
- H1 heading
- First paragraph of content
Alignment Verification: Confirm all metadata elements work together cohesively and support the same search intent
The complete package should provide all necessary metadata components for immediate implementation into WordPress or similar CMS systems for maximum search visibility.
`;

/**
 * 生成完整的WordPress文章，处理类别、标签、特色图片等
 */
export async function generateCompleteWordPressPost(
  url: string,
  auth: { username: string; password: string },
  keywords: string[],
  prompt?: string,
  model?: string,
  categoryNames: string[] = [],
  tagNames: string[] = []
): Promise<any> {
  const logger = createLogger("wordpress-post-generator");
  logger.info("Generating complete WordPress post", {
    prompt,
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
    const secondaryKeywords = keywords.slice(1).join(", ");

    // 3. 替换关键词占位符
    let finalPrompt = contentStrategyPrompt
      .replace(/\n/g, "")
      .replace(/\{PRIMARY_KEYWORD\}/g, primaryKeyword)
      .replace(/\{SECONDARY_KEYWORDS\}/g, secondaryKeywords);
    if (prompt) {
      finalPrompt += prompt;
    }

    // 4. 定义符合要求的JSON输出结构
    const jsonSchema = {
      slug: "string",
      title: "string",
      content: "string",
      excerpt: "string",
      categories: ["string"],
      tags: ["string"],
      focus_keywords: ["string"],
    };

    // 5. 调用Claude API生成JSON格式内容
    const generatedContent = await generateContent({
      prompt: finalPrompt,
      keywords,
      outputFormat: "json",
      jsonSchema,
      model,
    });

    logger.info("Content generated successfully", {
      generatedContent,
    });

    // 6. 处理分类
    const categoryIds: number[] = [];
    const generatedCategories = (generatedContent as any).categories ||
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
        logger.info(normalized, Object.keys(categoriesMap));
        if (fuzzyMatch && categoriesMap[fuzzyMatch]) {
          categoryIds.push(categoriesMap[fuzzyMatch]);
        }
      }
    }

    // 7. 处理标签
    let tagIds: number[] = [];
    const generatedTags =
      (generatedContent as any).tags || tagNames || keywords;

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

    // 8. 查找特色图片
    // let featuredMediaId = await findFeaturedMedia(url, auth, primaryKeyword);

    // 9. 构建最终的WordPress文章数据
    const postData = {
      slug: (generatedContent as any).slug,
      title: (generatedContent as any).title,
      content: (generatedContent as any).content,
      excerpt: (generatedContent as any).excerpt,
      // featured_media: featuredMediaId,
      rank_math_focus_keyword:
        (generatedContent as any).focus_keywords?.join(",") ||
        keywords.join(","),
      categories: categoryIds,
      tags: tagIds,
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
      Math.abs(closest.length - target.length)
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
