import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { createLogger } from "./logger";

// Request body structure definition
interface WordPressPostRequest {
  url: string;
  username: string;
  password: string;

  title?: string;
  keywords: string[];
  prompt: string;
  categories?: number[] | string[]; // 支持数字ID或字符串名称
  tags?: number[] | string[]; // 支持数字ID或字符串名称
  excerpt?: string;
  meta?: Record<string, any>;
  status?: "publish" | "draft" | "pending" | "private";
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

// Standardized API response format
interface ApiResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | boolean>;
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
  const { url, username, password, keywords, prompt } = request;

  if (!url) return "WordPress URL(url) cannot be empty";
  if (!username) return "Username(username) cannot be empty";
  if (!password) return "Password(password) cannot be empty";
  if (!Array.isArray(keywords) || keywords.length === 0)
    return "Keywords(keywords) must be a non-empty array";
  if (!prompt || prompt.trim() === "")
    return "Content prompt(prompt) cannot be empty";

  // URL format validation
  try {
    new URL(url);
  } catch (e) {
    return "Invalid WordPress URL format";
  }

  return null;
};

// 缓存WordPress分类和标签数据
interface TaxonomyCache {
  categories: Record<string, number>; // 分类名称到ID的映射
  tags: Record<string, number>; // 标签名称到ID的映射
  lastUpdate: number; // 上次更新时间戳
  siteUrl?: string; // 缓存对应的站点URL
}

// 初始化缓存
let taxonomyCache: TaxonomyCache = {
  categories: {},
  tags: {},
  lastUpdate: 0,
};

// 缓存有效期（30分钟，单位毫秒）
const CACHE_TTL = 30 * 60 * 1000;

/**
 * 规范化分类或标签名称以便于匹配
 * 处理HTML实体编码和Unicode字符差异
 * @param name 需要规范化的名称
 * @returns 规范化后的名称
 */
const normalizeTaxonomyName = (name: string): string => {
  if (!name) return "";

  // 转换为小写
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
    .replace(/[\u2013\u2014]/g, "-") // 破折号
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
  const logger = createLogger("wordpress-taxonomy");
  const result = { categoryIds: [] as number[], tagIds: [] as number[] };

  // 检查缓存是否过期或者站点URL变更
  const now = Date.now();
  const isCacheExpired =
    now - taxonomyCache.lastUpdate > CACHE_TTL || taxonomyCache.siteUrl !== url;

  // 单独处理分类数据
  if (categoryNames && categoryNames.length > 0) {
    // 如果缓存过期或对象为空，则获取分类数据
    if (isCacheExpired || Object.keys(taxonomyCache.categories).length === 0) {
      if (isCacheExpired) {
        // 仅在完全过期时重置整个缓存
        logger.info("Cache expired or site changed, resetting cache", {
          cacheAge: (now - taxonomyCache.lastUpdate) / 1000,
          oldSite: taxonomyCache.siteUrl,
          newSite: url,
        });
        taxonomyCache = {
          categories: {},
          tags: {},
          lastUpdate: now,
          siteUrl: url,
        };
      } else {
        logger.info("Categories cache empty, fetching categories data");
      }

      await fetchAllTaxonomies(
        url,
        auth,
        "categories",
        taxonomyCache.categories
      );
      taxonomyCache.lastUpdate = now; // 更新缓存时间
    }

    // 映射分类名称到ID，使用规范化后的名称查询
    result.categoryIds = categoryNames
      .map((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        const id = taxonomyCache.categories[normalizedName];
        return id;
      })
      .filter((id) => id !== undefined);

    // 记录未找到的分类
    const foundNames = result.categoryIds.length;
    if (foundNames < categoryNames.length) {
      const missingCategories = categoryNames.filter((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        return taxonomyCache.categories[normalizedName] === undefined;
      });

      logger.warn("Some categories not found", {
        found: foundNames,
        total: categoryNames.length,
        missing: missingCategories,
        missingNormalized: missingCategories.map(normalizeTaxonomyName),
      });
    }
  }

  // 单独处理标签数据 (类似的逻辑)
  if (tagNames && tagNames.length > 0) {
    // 如果缓存过期或标签对象为空，则获取标签数据
    if (isCacheExpired || Object.keys(taxonomyCache.tags).length === 0) {
      if (!isCacheExpired) {
        logger.info("Tags cache empty, fetching tags data");
      }

      await fetchAllTaxonomies(url, auth, "tags", taxonomyCache.tags);
      taxonomyCache.lastUpdate = now; // 更新缓存时间
    }

    // 映射标签名称到ID，使用规范化后的名称查询
    result.tagIds = tagNames
      .map((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        const id = taxonomyCache.tags[normalizedName];
        return id;
      })
      .filter((id) => id !== undefined);

    // 记录未找到的标签
    const foundNames = result.tagIds.length;
    if (foundNames < tagNames.length) {
      const missingTags = tagNames.filter((name) => {
        const normalizedName = normalizeTaxonomyName(name);
        return taxonomyCache.tags[normalizedName] === undefined;
      });

      logger.warn("Some tags not found", {
        found: foundNames,
        total: tagNames.length,
        missing: missingTags,
        missingNormalized: missingTags.map(normalizeTaxonomyName),
      });
    }
  }

  return result;
};

/**
 * 获取所有分类或标签数据
 * @param url WordPress站点URL
 * @param auth 身份验证信息
 * @param taxonomyType 分类类型（categories或tags）
 * @param cacheObj 缓存对象
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

  logger.info(`Fetching WordPress ${taxonomyType}`, { url, page });

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

      logger.info(`Fetched ${items.length} ${taxonomyType} from page ${page}`, {
        totalCached: Object.keys(cacheObj).length,
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
      logger.error(`Error fetching ${taxonomyType}`, {
        error: error instanceof Error ? error.message : String(error),
        page,
      });
      hasMore = false; // 出错时停止获取
    }
  }

  logger.info(`Completed fetching ${taxonomyType}`, {
    totalItems: Object.keys(cacheObj).length,
  });
};

// WordPress API service
const wordPressService = {
  createPost: async (request: WordPressPostRequest): Promise<any> => {
    const {
      url,
      username,
      password,
      title,
      keywords,
      prompt,
      categories,
      tags,
      excerpt,
      meta,
      status = "draft", // 默认为草稿
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
          logger.info("Converting category names to IDs");
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
          logger.info("Converting tag names to IDs");
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

    // 处理关键词为标签 (tags_input功能)
    const tagsInput = keywords?.map((tag) => tag.trim()).filter(Boolean) || [];

    // Generate content
    const postContent = `
      <p>${prompt}</p>
      <p>input_Keywords: ${keywords.join(", ")}</p>
    `;

    // Build request data
    const postData: WordPressPostData = {
      title: title || `About: ${keywords.join(", ")}`,
      content: postContent,
      status,
      categories: categoryIds,
      tags: tagIds,
      excerpt: excerpt || "",
      meta: meta || {},
    };

    // Build request configuration
    const config: AxiosRequestConfig = {
      headers: {
        "Content-Type": "application/json",
      },
      auth: {
        username,
        password,
      },
      timeout: 10000, // 10 seconds timeout
    };

    // Send request
    const endpoint = `${url}/wp-json/wp/v2/posts`;
    return axios.post(endpoint, postData, config);
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

    // 调用WordPress API
    logger.info("Calling WordPress API", { requestBody: requestBody });
    const response = await wordPressService.createPost(requestBody);

    // 返回成功响应
    logger.info("Post created successfully", { postId: response.data.id });
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
