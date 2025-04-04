import { APIGatewayProxyResult } from "aws-lambda";
import axios from "axios";
import { createLogger } from "./logger";
import {
  WordPressPostRequest,
  WordPressPostConfig,
  WordPressPostData,
  convertRequestToConfig,
} from "./models/interfaces";
import { WordPressApiService } from "./services/wordpress-api";
import { ContentGeneratorService } from "./services/content-generator";
import { ImageService } from "./services/image-service";
import {
  validateRequest,
  createErrorResponse,
  createSuccessResponse,
} from "./services/utils";

/**
 * Lambda函数入口点
 * 处理API Gateway请求并返回响应
 */
export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("wordpress-post", event);
  try {
    // 验证请求体是否存在
    if (!event.body) {
      return createErrorResponse("Request body cannot be empty", 400);
    }

    // 验证请求体是否为有效JSON
    let requestBody: WordPressPostRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return createErrorResponse("Invalid request body JSON format", 400);
    }

    // 验证请求体是否包含所需字段并且不为空对象
    if (!requestBody || Object.keys(requestBody).length === 0) {
      return createErrorResponse("Request body cannot be empty", 400);
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

    // 转换请求为配置
    const inputConfig = convertRequestToConfig(requestBody);

    // 生成完整的WordPress文章
    const postData = await generateCompleteWordPressPost(inputConfig);

    // 添加状态
    postData.status = "draft";

    // 创建WordPress API服务并发布文章
    const wordpressService = new WordPressApiService(requestBody.url, {
      username: requestBody.username,
      password: requestBody.password,
    });

    const response = await wordpressService.publishPost(postData);

    // 返回成功响应
    return createSuccessResponse(response, 201);
  } catch (error) {
    // 处理API错误
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status || 500;
      const errorMessage = error.response?.data?.message || error.message;

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
 * 生成完整的WordPress文章
 * 业务主流程，协调各个服务模块的工作
 * @param config WordPress配置
 * @returns WordPress文章数据
 */
export async function generateCompleteWordPressPost(
  config: WordPressPostConfig
): Promise<WordPressPostData> {
  const logger = createLogger("wordpress-post-generator");
  logger.info("Generating complete WordPress post", { config });

  try {
    // 1. 创建服务实例
    const wordpressService = new WordPressApiService(config.url, config.auth);
    const contentGenerator = new ContentGeneratorService();
    const imageService = new ImageService(config.url, config.auth);

    // 2. 生成文章内容和元数据
    const generatedContent = await contentGenerator.generateContent(config);

    // 3. 处理分类和标签
    const { categoryIds, tagIds } = await processTaxonomies(
      wordpressService,
      generatedContent.categories,
      generatedContent.tags,
      config.keywords
    );

    // 4. 处理图片
    let processedContent = generatedContent.content;
    let imageKeywords = generatedContent.image_keywords || [config.keywords[0]];

    // 确保imageKeywords是数组
    if (!Array.isArray(imageKeywords)) {
      if (typeof imageKeywords === "string") {
        imageKeywords = imageKeywords.split(",").map((k) => k.trim());
      } else {
        imageKeywords = [config.keywords[0]];
      }
    }

    // 插入图片到内容中
    const imgNum = config.img_num || 3;
    processedContent = await imageService.insertImagesIntoContent(
      processedContent,
      imageKeywords,
      imgNum
    );

    // 5. 查找特色图片
    let featuredImageKeywords = [...imageKeywords];
    if (config.img_endword) {
      featuredImageKeywords.push(config.img_endword);
    }

    const featuredMediaId = await wordpressService.findFeaturedMedia(
      featuredImageKeywords
    );

    // 6. 处理焦点关键词
    let focusKeywordsString: string;
    if (typeof generatedContent.focus_keywords === "string") {
      focusKeywordsString = generatedContent.focus_keywords;
    } else if (Array.isArray(generatedContent.focus_keywords)) {
      focusKeywordsString = generatedContent.focus_keywords.join(",");
    } else {
      focusKeywordsString = config.keywords.join(",");
    }

    // 7. 构建最终的WordPress文章数据
    const postData: WordPressPostData = {
      slug: generatedContent.slug,
      title: generatedContent.title,
      content: processedContent,
      excerpt: generatedContent.excerpt,
      rank_math_focus_keyword: focusKeywordsString,
      categories: categoryIds,
      tags: tagIds,
      featured_media: featuredMediaId,
    };

    logger.info("WordPress post data prepared", { postData });
    return postData;
  } catch (error) {
    logger.error("Error generating WordPress post", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 处理分类和标签
 * @param wordpressService WordPress API服务
 * @param categories 分类名称数组
 * @param tags 标签名称数组
 * @param fallbackKeywords 备用关键词数组
 * @returns 分类ID和标签ID
 */
async function processTaxonomies(
  wordpressService: WordPressApiService,
  categories?: string[],
  tags?: string[],
  fallbackKeywords?: string[]
): Promise<{ categoryIds: number[]; tagIds: number[] }> {
  // 处理分类
  const categoryNames = categories || ["Fishing"];

  // 处理标签
  let tagNames = tags || fallbackKeywords || [];

  // 处理标签数组，确保所有元素都是字符串
  if (!Array.isArray(tagNames)) {
    // 如果不是数组，转换为字符串后分割
    tagNames = String(tagNames)
      .split(",")
      .map((tag) => tag.trim());
  } else if (tagNames.length > 0) {
    // 如果是数组，处理每个元素
    const expandedTags: string[] = [];
    for (const tag of tagNames) {
      if (typeof tag === "string" && tag.includes(",")) {
        expandedTags.push(...tag.split(",").map((t) => t.trim()));
      } else {
        expandedTags.push(String(tag).trim());
      }
    }
    tagNames = expandedTags;
  }

  // 获取分类和标签ID
  const { categoryIds, tagIds } = await wordpressService.getTaxonomyIds(
    categoryNames,
    tagNames
  );

  // 如果没有找到标签ID，创建新标签
  if (tagNames.length > 0 && tagIds.length === 0) {
    const newTagIds = await wordpressService.createNewTags(tagNames);
    return { categoryIds, tagIds: newTagIds };
  }

  return { categoryIds, tagIds };
}

// 为测试目的导出内部函数
export { validateRequest, createErrorResponse, createSuccessResponse };

// 导出WordPressApiService中的方法以支持测试
export const normalizeTaxonomyName = (name: string): string => {
  const wordpressService = new WordPressApiService("https://example.com", {
    username: "",
    password: "",
  });
  return wordpressService.normalizeTaxonomyName(name);
};

export const getTaxonomyIds = async (
  url: string,
  auth: { username: string; password: string },
  categoryNames?: string[],
  tagNames?: string[]
) => {
  const wordpressService = new WordPressApiService(url, auth);
  return wordpressService.getTaxonomyIds(categoryNames, tagNames);
};

export const fetchAllTaxonomies = async (
  url: string,
  auth: { username: string; password: string },
  taxonomyType: "categories" | "tags",
  cacheObj: Record<string, number>
): Promise<void> => {
  const wordpressService = new WordPressApiService(url, auth);
  return wordpressService.fetchAllTaxonomies(taxonomyType, cacheObj);
};

// 导出formatResponse函数
export { formatResponse } from "./services/utils";
