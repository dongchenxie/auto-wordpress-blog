import { createLogger } from "../logger";
import { generateContent } from "../../claude-service";
import { WordPressPostConfig, GeneratedContent } from "../models/interfaces";
import { WordPressApiService } from "./wordpress-api";

/**
 * 内容生成服务类
 * 负责处理AI内容生成的逻辑
 */
export class ContentGeneratorService {
  private logger = createLogger("content-generator");

  /**
   * 获取WordPress网站的分类和标签数据
   * @param url WordPress网站URL
   * @param auth 认证信息
   * @returns 包含分类和标签的对象
   */
  private async fetchWordPressTaxonomies(
    url: string,
    auth: { username: string; password: string }
  ): Promise<{ categories: string[]; tags: string[] }> {
    this.logger.info("Fetching WordPress taxonomies");

    try {
      // 创建WordPress API服务实例
      const wordpressService = new WordPressApiService(url, auth);

      // 临时存储分类和标签数据的对象
      const categoriesMap: Record<string, number> = {};
      const tagsMap: Record<string, number> = {};

      // 获取所有分类和标签
      await wordpressService.fetchAllTaxonomies("categories", categoriesMap);
      await wordpressService.fetchAllTaxonomies("tags", tagsMap);

      // 提取分类和标签名称
      const categories = Object.keys(categoriesMap).filter(
        (name) => name.length > 0 && !name.includes("_")
      );
      const tags = Object.keys(tagsMap).filter(
        (name) => name.length > 0 && !name.includes("_")
      );

      this.logger.info("WordPress taxonomies fetched", {
        categoriesCount: categories.length,
        tagsCount: tags.length,
      });

      return { categories, tags };
    } catch (error) {
      this.logger.error("Error fetching WordPress taxonomies", {
        error: error instanceof Error ? error.message : String(error),
      });

      // 返回空数组作为备用
      return { categories: [], tags: [] };
    }
  }

  /**
   * 生成文章元数据和内容
   * @param config WordPress配置
   * @returns 生成的内容
   */
  async generateContent(
    config: WordPressPostConfig
  ): Promise<GeneratedContent> {
    const {
      keywords,
      modelService,
      apiKey,
      model,
      metaModel,
      metaTemperature,
      metaMax_tokens,
      metaUserPrompt,
      metaSystemPrompt,
      contentMax_tokens,
      contentUserPrompt,
      contentSystemPrompt,
      url,
      auth,
    } = config;

    // 记录配置信息
    this.logger.info("Generating content with configuration", {
      keywords,
      modelService,
      model,
    });

    // 准备关键词替换
    const primaryKeyword = keywords[0];

    // 定义元数据JSON输出结构
    const metadataSchema = {
      slug: "string",
      title: "string",
      excerpt: "string",
      categories: ["string"],
      tags: ["string"],
      focus_keywords: ["string"],
      image_keywords: ["string"],
    };

    try {
      // 0. 获取WordPress网站的分类和标签数据
      const { categories: existingCategories, tags: existingTags } =
        await this.fetchWordPressTaxonomies(url, auth);

      // 1. 生成元数据
      const metadataResult = await this.generateMetadata(
        primaryKeyword,
        keywords,
        modelService,
        apiKey,
        metaModel || model,
        metaSystemPrompt,
        metaUserPrompt,
        metaTemperature,
        metaMax_tokens,
        metadataSchema,
        existingCategories,
        existingTags
      );

      // 在两个API调用之间添加延迟，避免触发速率限制
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 2. 生成内容
      const contentResult = await this.generateArticleContent(
        primaryKeyword,
        keywords,
        modelService,
        apiKey,
        model,
        contentSystemPrompt,
        contentUserPrompt,
        contentMax_tokens
      );

      // 3. 合并结果
      return {
        content: contentResult,
        slug: metadataResult.slug,
        title: metadataResult.title,
        excerpt: metadataResult.excerpt,
        categories: metadataResult.categories,
        tags: metadataResult.tags,
        focus_keywords: metadataResult.focus_keywords,
        image_keywords: metadataResult.image_keywords,
      };
    } catch (error) {
      this.logger.error("Error generating content", {
        error: error instanceof Error ? error.message : String(error),
      });

      // 返回基本内容作为备用
      return this.createFallbackContent(primaryKeyword, keywords);
    }
  }

  /**
   * 生成文章元数据
   */
  private async generateMetadata(
    primaryKeyword: string,
    keywords: string[],
    modelService: string,
    apiKey: string,
    model: string,
    systemPrompt?: string,
    userPrompt?: string,
    temperature?: number,
    max_tokens?: number,
    jsonSchema?: Record<string, any>,
    existingCategories?: string[],
    existingTags?: string[]
  ): Promise<any> {
    // 替换关键词占位符
    // 准备现有分类和标签数据的字符串表示
    let existingCategoriesStr = "";
    let existingTagsStr = "";

    if (existingCategories && existingCategories.length > 0) {
      // 最多使用前20个分类，避免提示过长
      const limitedCategories = existingCategories.slice(0, 20);
      existingCategoriesStr = `\nExisting blog categories: ${limitedCategories.join(
        ", "
      )}.`;
    }

    if (existingTags && existingTags.length > 0) {
      // 最多使用前50个标签，避免提示过长
      const limitedTags = existingTags.slice(0, 50);
      existingTagsStr = `\nExisting blog tags: ${limitedTags.join(", ")}.`;
    }

    // 基础提示
    let basePrompt = userPrompt
      ? userPrompt
      : `I have a fishing online wordpress store,url is https://fishingfusion.com/主要是是做fishing产品以及各类相关产品. Remember in this conversation, my store potienal customers are english speakers,Be written in high-quality English, suitable for both enthusiasts and professionals.Think and write one comprehensive, detailed, and academically rigorous blog post topic and outline with main keyword ${primaryKeyword}, and other keywords with high search volume and many people willing to know about it.After the main content, please provide: an SEO blog title with power words containing a number,Blog categories,SEO slug,SEO-optimized tags (comma-separated) ,3 precise image_search_keywords for image API (be short and specific) and A compelling excerpt Focus keywords (comma-separated).use Focus Keyword in the SEO Title,Focus Keyword used inside SEO Meta Description,Focus Keyword used in the URL.`;

    // 如果有现有分类和标签，添加到提示中
    if (existingCategoriesStr || existingTagsStr) {
      basePrompt += `\n\nPlease use the following existing categories and tags when possible:${existingCategoriesStr}${existingTagsStr}\nYou can also suggest new categories and tags if needed, but prefer using existing ones when relevant.`;
    }

    // 替换关键词占位符
    const metadataUserPrompt = this.replaceKeywordPlaceholders(
      basePrompt,
      primaryKeyword
    );

    this.logger.info("Metadata generation prompt with taxonomies", {
      promptLength: metadataUserPrompt.length,
      hasTaxonomies: !!(existingCategoriesStr || existingTagsStr),
    });

    const metadataSystemPrompt = this.replaceKeywordPlaceholders(
      systemPrompt,
      primaryKeyword
    );

    // 构建配置对象
    const metadataConfig = {
      prompt: metadataUserPrompt,
      keywords: keywords,
      serviceType: modelService,
      apiKey: apiKey,
      model: model,
      systemPrompt: metadataSystemPrompt,
      jsonSchema: jsonSchema,
      temperature: temperature || 0.5,
      max_tokens: max_tokens || 2000,
    };

    // 打印配置信息
    this.logger.info("Metadata generation config:", metadataConfig);

    // 调用AI服务生成元数据
    let metadataResult = await generateContent(metadataConfig);
    this.logger.info("Metadata generation successful", {
      metadataResult: metadataResult,
    });

    // 处理返回的元数据结果
    if (typeof metadataResult === "string") {
      try {
        metadataResult = JSON.parse(metadataResult);
      } catch (error) {
        this.logger.warn("Failed to parse metadata JSON", {
          error: error instanceof Error ? error.message : String(error),
          metadataResult,
        });

        // 尝试清理 Markdown 代码块标记后再解析
        if (typeof metadataResult === "string") {
          try {
            // 移除开头的 ```json\n 和结尾的 ```
            let cleanedJson = metadataResult;
            if (cleanedJson.includes("```")) {
              this.logger.info(
                "Attempting to clean Markdown code block markers"
              );
              // 移除开始的 ```json 或其他代码块标记
              cleanedJson = cleanedJson.replace(/```[a-z]*\n/g, "");
              // 移除结束的 ```
              cleanedJson = cleanedJson.replace(/\n```/g, "");

              // 尝试解析清理后的 JSON
              metadataResult = JSON.parse(cleanedJson);
              this.logger.info(
                "Successfully parsed JSON after cleaning Markdown markers"
              );
            }
          } catch (cleanError) {
            this.logger.error("Failed to parse JSON even after cleaning", {
              error:
                cleanError instanceof Error
                  ? cleanError.message
                  : String(cleanError),
            });

            // 如果解析失败，创建一个基本的元数据对象
            metadataResult = this.createFallbackMetadata(
              primaryKeyword,
              keywords
            );
          }
        } else {
          // 如果解析失败，创建一个基本的元数据对象
          metadataResult = this.createFallbackMetadata(
            primaryKeyword,
            keywords
          );
        }
      }
    }

    return metadataResult;
  }

  /**
   * 生成文章内容
   */
  private async generateArticleContent(
    primaryKeyword: string,
    keywords: string[],
    modelService: string,
    apiKey: string,
    model: string,
    systemPrompt?: string,
    userPrompt?: string,
    max_tokens?: number
  ): Promise<string> {
    // 替换关键词占位符
    const contentPrompt = this.replaceKeywordPlaceholders(
      userPrompt
        ? userPrompt
        : `give me the whole blog post of with the main keyword ${primaryKeyword}.Please write about 3000 words and in well-designed html.I need longer writing for SEO optimization purposes. The main keyword density is aimed at around 1%, and other keywords should be 0.5%.Be extensively researched and include in-text citations from real and credible academic sources,websites and news. Provide deep insights into the topic. a Key Takeaways section at the beginning. Include a table of contents at the beginning for easy navigation. Discuss the topic comprehensively, covering all major aspects. Include a comprehensive FAQ section (at least 5 questions) addressing common concerns. Provide a full APA-style reference list with clickable links to sources. Incorporate relevant examples, case studies, and statistics to support key points. Include at least one well-designed visual table( Put the table more toward the front) in the writing to help people understand better, such as a comparison table. Be written in high-quality English, suitable for both enthusiasts and professionals. Include outbound links to reputable external resources for additional information. Be significantly longer and more detailed than a typical blog post, aiming for a comprehensive guide on the topic.Be written in HTML format, promoting trust and encouraging customers to continue shopping and reading on my website. Structure the blog with proper HTML heading tags like <h1>, <h2>, and <h3> to ensure good readability and organization. Incorporate an appealing design by suggesting CSS styling that enhances user experience and visual comfort.`,
      primaryKeyword
    );

    const contentSystemPrompt = this.replaceKeywordPlaceholders(
      systemPrompt,
      primaryKeyword
    );

    // 构建内容生成配置
    const contentConfig = {
      prompt: contentPrompt,
      keywords: keywords,
      serviceType: modelService,
      apiKey: apiKey,
      model: model,
      systemPrompt: contentSystemPrompt,
      temperature: 0.7,
      max_tokens: max_tokens || 8196,
    };

    // 打印内容生成配置信息
    this.logger.info("Content generation config:", contentConfig);

    // 调用AI服务生成内容
    let contentResult = await generateContent(contentConfig);
    this.logger.info("Content generation successful");

    // 处理返回的内容结果
    let articleContent = "";
    if (typeof contentResult === "string") {
      // 如果直接返回字符串
      articleContent = contentResult;

      // 1. 首先尝试提取JSON中的content字段
      try {
        const jsonContent = JSON.parse(articleContent);
        if (jsonContent && typeof jsonContent.content === "string") {
          articleContent = jsonContent.content;
          this.logger.warn("Extracted content from JSON response");
        }
      } catch (e) {
        // 如果不是JSON格式，继续使用原始内容
        this.logger.warn("Response is not in JSON format, using as-is");
      }

      // 2. 移除开头的解释性文本
      if (articleContent.includes("<!DOCTYPE html>")) {
        const doctypeIndex = articleContent.indexOf("<!DOCTYPE html>");
        articleContent = articleContent.substring(doctypeIndex);
        this.logger.warn("Removed explanatory text before DOCTYPE");
      }

      // 3. 移除Markdown代码块标记
      if (articleContent.includes("```")) {
        this.logger.warn("Removing Markdown code block markers from content");

        // 更全面的正则表达式处理
        // 处理开头的代码块标记 (```html, ```javascript 等)
        articleContent = articleContent.replace(/```[a-z]*\n/g, "");
        articleContent = articleContent.replace(/\n\s*```\s*/g, "");
        articleContent = articleContent.replace(/```[a-z]*\s(.*?)\s```/g, "$1");
        articleContent = articleContent.replace(/```/g, "");
      }

      // 4. 处理HTML结尾后的额外内容
      if (articleContent.includes("</html>")) {
        const htmlEndIndex = articleContent.indexOf("</html>") + 7;
        articleContent = articleContent.substring(0, htmlEndIndex);
        this.logger.warn("Removed content after HTML end tag");
      }

      // 检查是否返回了Markdown格式而非HTML
      if (articleContent.startsWith("#") && !articleContent.startsWith("<")) {
        this.logger.warn(
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
    } else {
      // 无法获取内容，使用备用内容
      this.logger.warn(
        "Could not extract content from response, using fallback"
      );
      articleContent = `
        <h1>${primaryKeyword}</h1>
        <p>This is an article about ${primaryKeyword}.</p>
        <p>Keywords: ${keywords.join(", ")}</p>
      `;
    }

    return articleContent;
  }

  /**
   * 替换文本中的关键词占位符
   * @param text 文本
   * @param primaryKeyword 主关键词
   * @returns 替换后的文本
   */
  private replaceKeywordPlaceholders(
    text: string | undefined,
    primaryKeyword: string
  ): string {
    if (!text) return "";
    text = text ? text.toString() : "";
    // 检查是否包含${primaryKeyword}占位符
    if (text.includes("${primaryKeyword}")) {
      return text.replace(/\${primaryKeyword}/g, primaryKeyword);
    }
    return text;
  }

  /**
   * 创建备用元数据
   * @param primaryKeyword 主关键词
   * @param keywords 关键词数组
   * @returns 备用元数据
   */
  private createFallbackMetadata(
    primaryKeyword: string,
    keywords: string[]
  ): any {
    return {
      title: `Ultimate Guide to ${primaryKeyword}`,
      slug: primaryKeyword.toLowerCase().replace(/\s+/g, "-"),
      excerpt: `Discover everything you need to know about ${primaryKeyword} in this comprehensive guide.`,
      categories: ["Fishing"],
      tags: keywords,
      focus_keywords: keywords,
      image_keywords: [primaryKeyword],
    };
  }

  /**
   * 创建备用内容
   * @param primaryKeyword 主关键词
   * @param keywords 关键词数组
   * @returns 备用内容
   */
  private createFallbackContent(
    primaryKeyword: string,
    keywords: string[]
  ): GeneratedContent {
    const fallbackMetadata = this.createFallbackMetadata(
      primaryKeyword,
      keywords
    );

    return {
      ...fallbackMetadata,
      content: `
<h1>${fallbackMetadata.title}</h1>

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
