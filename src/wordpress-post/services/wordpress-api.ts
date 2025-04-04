import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { createLogger } from "../logger";
import { WordPressPostData, TaxonomyIdsResult } from "../models/interfaces";

/**
 * WordPress API服务类
 * 负责与WordPress REST API的所有交互
 */
export class WordPressApiService {
  private url: string;
  private auth: { username: string; password: string };
  private logger = createLogger("wordpress-api");

  constructor(url: string, auth: { username: string; password: string }) {
    this.url = url;
    this.auth = auth;
  }

  /**
   * 发布文章到WordPress
   * @param postData 文章数据
   * @returns 发布结果
   */
  async publishPost(postData: WordPressPostData): Promise<any> {
    try {
      const endpoint = `${this.url}/wp-json/wp/v2/posts`;
      const config: AxiosRequestConfig = {
        headers: { "Content-Type": "application/json" },
        auth: this.auth,
        timeout: 30000, // 增加超时时间
      };

      const response = await axios.post(endpoint, postData, config);
      this.logger.info("Post created successfully", { postId: response.data.id });
      
      return {
        message: "Article published successfully",
        postId: response.data.id,
        postUrl: response.data.link,
      };
    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * 根据名称获取分类和标签的ID
   * @param categoryNames 分类名称数组
   * @param tagNames 标签名称数组
   * @returns 包含分类ID和标签ID的对象
   */
  async getTaxonomyIds(
    categoryNames?: string[],
    tagNames?: string[]
  ): Promise<TaxonomyIdsResult> {
    const result = { categoryIds: [] as number[], tagIds: [] as number[] };

    // 临时存储分类数据的对象
    const categoriesMap: Record<string, number> = {};
    const tagsMap: Record<string, number> = {};

    // 处理分类
    if (categoryNames && categoryNames.length > 0) {
      await this.fetchAllTaxonomies("categories", categoriesMap);

      // 映射分类名称到ID，使用规范化后的名称查询
      result.categoryIds = categoryNames
        .map((name) => {
          const normalizedName = this.normalizeTaxonomyName(name);
          const id = categoriesMap[normalizedName];
          return id;
        })
        .filter((id) => id !== undefined);
    }

    // 处理标签
    if (tagNames && tagNames.length > 0) {
      await this.fetchAllTaxonomies("tags", tagsMap);

      // 映射标签名称到ID，使用规范化后的名称查询
      result.tagIds = tagNames
        .map((name) => {
          const normalizedName = this.normalizeTaxonomyName(name);
          const id = tagsMap[normalizedName];
          return id;
        })
        .filter((id) => id !== undefined);
    }

    return result;
  }

  /**
   * 获取所有分类或标签数据
   * @param taxonomyType 分类类型（categories或tags）
   * @param cacheObj 临时存储对象
   */
  async fetchAllTaxonomies(
    taxonomyType: "categories" | "tags",
    cacheObj: Record<string, number>
  ): Promise<void> {
    const config: AxiosRequestConfig = {
      auth: this.auth,
      timeout: 10000,
    };

    let page = 1;
    const perPage = 100; // 每页获取最大数量
    let hasMore = true;

    while (hasMore) {
      try {
        const endpoint = `${this.url}/wp-json/wp/v2/${taxonomyType}?page=${page}&per_page=${perPage}`;
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
            const normalizedName = this.normalizeTaxonomyName(item.name);
            cacheObj[normalizedName] = item.id;

            // 原始小写名称作为备用键
            cacheObj[item.name.toLowerCase()] = item.id;

            // 缓存规范化的slug
            if (item.slug) {
              const normalizedSlug = this.normalizeTaxonomyName(item.slug);
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
        this.logger.error(`Error fetching ${taxonomyType}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * 创建新标签并返回创建的标签ID数组
   * @param tagNames 标签名称数组
   * @returns 创建的标签ID数组
   */
  async createNewTags(tagNames: string[]): Promise<number[]> {
    const tagIds: number[] = [];

    for (const tagName of tagNames) {
      try {
        // 跳过过长的标签名（WordPress通常限制在200个字符以内）
        if (tagName.length > 200) {
          this.logger.warn(
            `Skipping tag that exceeds length limit: ${tagName.substring(
              0,
              50
            )}...`
          );
          continue;
        }

        const endpoint = `${this.url}/wp-json/wp/v2/tags`;
        const response = await axios.post(
          endpoint,
          { name: tagName },
          { auth: this.auth, timeout: 10000 }
        );

        if (response.data && response.data.id) {
          tagIds.push(response.data.id);
          this.logger.info(`Created new tag: ${tagName}`, { id: response.data.id });
        }
      } catch (error) {
        this.logger.error(`Failed to create tag: ${tagName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return tagIds;
  }

  /**
   * 在现有WordPress媒体库中查找与关键词相关的图片
   * @param keywords 关键词数组
   * @returns 媒体ID或undefined
   */
  async findFeaturedMedia(keywords: string[]): Promise<number | undefined> {
    try {
      // 收集所有关键词搜索到的图片
      const allMedia: Array<{ id: number; title: string }> = [];

      // 按顺序遍历关键词数组搜索图片
      for (const kw of keywords) {
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

        const endpoint = `${this.url}/wp-json/wp/v2/media?search=${searchTerm}&media_type=image&per_page=100&orderby=${randomParam.orderby}&order=${randomParam.order}`;

        const response = await axios.get(endpoint, {
          auth: this.auth,
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

        this.logger.info(`Selected random media from ${allMedia.length} results`, {
          mediaId: selectedMedia.id,
          mediaTitle: selectedMedia.title,
        });
        return selectedMedia.id;
      }
      this.logger.warn(`No matching media found for keywords: ${keywords}`);
      return undefined;
    } catch (error) {
      this.logger.error(`Error finding featured media for: ${keywords}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * 规范化分类或标签名称以便于匹配
   * 处理HTML实体编码和Unicode字符差异
   * @param name 需要规范化的名称
   * @returns 规范化后的名称
   */
  normalizeTaxonomyName(name: string): string {
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
  }

  /**
   * 简单的模糊匹配函数，用于匹配分类名
   * @param target 目标字符串
   * @param candidates 候选字符串数组
   * @returns 匹配的字符串或undefined
   */
  findFuzzyMatch(target: string, candidates: string[]): string | undefined {
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

  /**
   * 处理API错误
   * @param error 错误对象
   * @throws 抛出格式化后的错误
   */
  private handleApiError(error: any): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status || 500;

      // 提供基于错误类型的具体错误信息
      if (statusCode === 401) {
        this.logger.error("Authentication failed", { status: 401 });
        throw new Error("WordPress authentication failed, please check username and password");
      } else if (statusCode === 403) {
        this.logger.error("Permission denied", { status: 403 });
        throw new Error("Insufficient permissions, user cannot publish articles");
      } else if (statusCode === 404) {
        this.logger.error("Endpoint not found", { status: 404 });
        throw new Error("WordPress API endpoint not found, please check the URL");
      }

      // 一般API错误
      const errorMessage =
        (axiosError.response?.data as { message?: string })?.message ||
        axiosError.message;
      this.logger.error("WordPress API error", {
        status: statusCode,
        message: errorMessage,
      });
      throw new Error(`WordPress API error: ${errorMessage}`);
    }

    // 未知错误处理
    this.logger.error("Unexpected error", { error: String(error) });
    throw new Error("Internal server error");
  }
}