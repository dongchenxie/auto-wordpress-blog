import { createLogger } from "../logger";
import { ImageLoader, ImageResult } from "../../image-service/pexels";
import axios from "axios";

/**
 * 图片服务类
 * 负责处理图片获取和插入的逻辑
 */
export class ImageService {
  private url: string;
  private auth: { username: string; password: string };
  private logger = createLogger("image-service");

  constructor(url: string, auth: { username: string; password: string }) {
    this.url = url;
    this.auth = auth;
  }

  /**
   * 获取图片并插入到文章内容中
   * @param content 文章内容
   * @param imageKeywords 图片关键词
   * @param imgNum 图片数量
   * @returns 插入图片后的内容
   */
  async insertImagesIntoContent(
    content: string,
    imageKeywords: string[] | string,
    imgNum: number = 3
  ): Promise<string> {
    // 确保imageKeywords是数组
    if (!Array.isArray(imageKeywords)) {
      if (typeof imageKeywords === "string") {
        imageKeywords = imageKeywords.split(",").map((k) => k.trim());
      } else {
        imageKeywords = [];
      }
    }

    if (imageKeywords.length === 0) {
      this.logger.warn("No image keywords provided, skipping image insertion");
      return content;
    }

    try {
      // 首先从WordPress Media库搜索图片
      const wpMediaImages = await this.getWordPressMediaImages(imageKeywords);

      // 随机打乱WordPress图片
      const shuffledWPImages = [...wpMediaImages].sort(
        () => Math.random() - 0.5
      );

      // 如果WordPress Media库中的图片不够，才使用Pexels
      let allImages = [...shuffledWPImages];
      if (allImages.length < imgNum) {
        this.logger.info(
          `WordPress Media Library only has ${allImages.length} images, fetching more from Pexels...`
        );
        const remainingCount = imgNum - allImages.length;

        // 随机打乱关键词顺序
        const shuffledKeywords = [...imageKeywords].sort(
          () => Math.random() - 0.5
        );

        // 获取Pexels图片
        const imageLoader = new ImageLoader();
        for (const keyword of shuffledKeywords) {
          if (allImages.length >= imgNum) break;

          try {
            const pexelsImages = await imageLoader.getImages(
              keyword,
              remainingCount
            );
            if (pexelsImages && pexelsImages.length > 0) {
              allImages.push(...pexelsImages);
              this.logger.info(
                `Found ${pexelsImages.length} additional images from Pexels for keyword: ${keyword}`
              );
            }
          } catch (error) {
            this.logger.warn(
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
        .slice(0, imgNum)
        .sort(() => Math.random() - 0.5);

      // 如果没有找到图片，直接返回原内容
      if (allImages.length === 0) {
        this.logger.warn("No images found for any of the keywords", {
          imageKeywords,
        });
        return content;
      }

      // 图片插入逻辑
      return this.insertImagesAtHeadings(content, allImages, imageKeywords);
    } catch (error) {
      this.logger.error("Failed to insert images into content", {
        error: error instanceof Error ? error.message : String(error),
      });
      return content;
    }
  }

  /**
   * 从WordPress媒体库获取图片
   * @param keywords 关键词数组
   * @returns 图片数组
   */
  private async getWordPressMediaImages(keywords: string[]): Promise<any[]> {
    const wpMediaImages: any[] = [];

    // 随机打乱关键词顺序
    const shuffledKeywords = [...keywords].sort(() => Math.random() - 0.5);

    // 尝试从WordPress Media库获取图片
    for (const keyword of shuffledKeywords) {
      try {
        const mediaEndpoint = `${this.url}/wp-json/wp/v2/media?search=${encodeURIComponent(
          keyword
        )}&per_page=5`;
        const response = await axios.get(mediaEndpoint, { auth: this.auth });
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
          this.logger.info(
            `Found ${mediaItems.length} images in WordPress Media Library for keyword: ${keyword}`
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get images from WordPress Media Library for keyword: ${keyword}`,
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    return wpMediaImages;
  }

  /**
   * 在标题后插入图片
   * @param content 文章内容
   * @param images 图片数组
   * @param keywords 关键词数组
   * @returns 插入图片后的内容
   */
  private insertImagesAtHeadings(
    content: string,
    images: any[],
    keywords: string[]
  ): string {
    const headingEndPositions: { index: number; length: number }[] = [];
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
        images.length,
        headingEndPositions.length
      );
      const selectedPositions = [...Array(headingEndPositions.length).keys()]
        .sort(() => Math.random() - 0.5)
        .slice(0, maxInserts);

      // 按位置从后向前插入，避免位置错乱
      selectedPositions.sort((a, b) => b - a);

      for (const posIndex of selectedPositions) {
        const pos = headingEndPositions[posIndex];

        // 查找未使用的图片
        const unusedImage = images.find((img) => {
          const imgUrl = img.sizes.large2x || img.sizes.large || img.url;
          return !usedImageUrls.has(imgUrl);
        });

        if (!unusedImage) {
          this.logger.warn("No unused images available, skipping insertion");
          continue;
        }

        const imageUrl =
          unusedImage.sizes.large2x ||
          unusedImage.sizes.large ||
          unusedImage.url;
        usedImageUrls.add(imageUrl); // 记录已使用的图片URL

        const keyword = keywords[posIndex % keywords.length];
        const imgHtml = `
<figure class="wp-block-image">
  <img src="${imageUrl}" alt="${keyword}" class="wp-image"/>
</figure>`;

        const insertPosition = pos.index + pos.length;
        content =
          content.slice(0, insertPosition) +
          imgHtml +
          content.slice(insertPosition);

        this.logger.info(`Inserted unique image at position ${insertPosition}`, {
          imageUrl,
          keyword,
        });
      }

      return content;
    } else {
      // 如果没有找到标题标签，只插入一张图片在开头
      const imageData = images[0];
      const imageUrl =
        imageData.sizes.large2x || imageData.sizes.large || imageData.url;
      const keyword = keywords[0];

      const imgHtml = `
<figure class="wp-block-image">
  <img src="${imageUrl}" alt="${keyword}" class="wp-image"/>
</figure>`;

      content = imgHtml + content;
      this.logger.info("Inserted single image at the beginning of content", {
        imageUrl,
        keyword,
      });

      return content;
    }
  }
}