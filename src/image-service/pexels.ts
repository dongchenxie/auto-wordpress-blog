import { createHash } from "crypto";

interface ImageService {
  getImages: (query: string, count: number) => Promise<ImageResult[]>;
}

export interface ImageResult {
  url: string;
  sizes: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
  };
  attribution: {
    photographer: string;
    photographerUrl: string;
    source: string;
    sourceUrl: string;
  };
}

class PexelsImageService implements ImageService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getImages(query: string, count: number): Promise<ImageResult[]> {
    try {
      // 第 1 次请求: 拿 total_results
      const initialResponse = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(
          query
        )}&per_page=1`,
        {
          headers: {
            Authorization: this.apiKey,
          },
        }
      );
      if (!initialResponse.ok) {
        throw new Error(`Pexels API error: ${initialResponse.statusText}`);
      }

      const initialData = (await initialResponse.json()) as any;
      const totalResults = initialData.total_results;
      if (totalResults === 0) {
        return [];
      }

      // 计算最大可用页码; 随机取一个(最多不超过第 5 页)
      const maxPage = Math.ceil(totalResults / count);
      const randomPage = Math.floor(Math.random() * Math.min(maxPage, 5)) + 1;

      // 第 2 次请求: 取指定 count, page=randomPage
      const response = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(
          query
        )}&per_page=${count}&page=${randomPage}`,
        {
          headers: {
            Authorization: this.apiKey,
          },
        }
      );
      if (!response.ok) {
        throw new Error(`Pexels API error: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      // 随机打散后再映射
      return data.photos
        .sort(() => Math.random() - 0.5)
        .map((photo: any) => ({
          url: photo.src.large2x,
          sizes: {
            original: photo.src.original,
            large2x: photo.src.large2x,
            large: photo.src.large,
            medium: photo.src.medium,
            small: photo.src.small,
          },
          attribution: {
            photographer: photo.photographer,
            photographerUrl: photo.photographer_url,
            source: "Pexels",
            sourceUrl: "https://www.pexels.com",
          },
        }));
    } catch (error) {
      console.error("Error fetching images from Pexels:", error);
      return [];
    }
  }
}

export class ImageLoader {
  private services: ImageService[];
  private cache: Map<string, ImageResult[]>;

  constructor() {
    // 从环境变量中读取 PEXELS_API_KEY
    this.services = [new PexelsImageService(process.env.PEXELS_API_KEY || "")];
    this.cache = new Map();
  }

  private getCacheKey(query: string, count: number): string {
    return createHash("md5").update(`${query}-${count}`).digest("hex");
  }

  async getImages(query: string, count: number = 1): Promise<ImageResult[]> {
    // 若缓存已有，则直接返回
    const cacheKey = this.getCacheKey(query, count);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || [];
    }

    // 否则依次从可用服务查询 (这里只有 Pexels)
    for (const service of this.services) {
      const images = await service.getImages(query, count);
      if (images.length > 0) {
        this.cache.set(cacheKey, images);
        return images;
      }
    }

    // 若都取不到，则空数组
    return [];
  }
}

// 导出一个全局实例，方便直接导入使用
export const imageLoader = new ImageLoader();
