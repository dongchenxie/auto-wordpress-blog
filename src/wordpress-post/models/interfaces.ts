/**
 * WordPress API 接口定义文件
 * 包含所有与WordPress API交互相关的数据结构
 */

// 基础接口，包含共同的属性
export interface BaseWordPressConfig {
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
export interface WordPressPostRequest extends BaseWordPressConfig {
  username: string;
  password: string;
}

// 配置接口，继承基础接口
export interface WordPressPostConfig extends BaseWordPressConfig {
  auth: { username: string; password: string };
}

// WordPress文章数据接口
export interface WordPressPostData {
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  rank_math_focus_keyword: string;
  categories: number[];
  tags: number[];
  featured_media?: number;
  status?: string;
}

// 生成的内容接口
export interface GeneratedContent {
  content: string;
  slug: string;
  title: string;
  excerpt: string;
  categories?: string[];
  tags?: string[];
  focus_keywords?: string[] | string;
  image_keywords?: string[] | string;
}

// 分类和标签ID结果接口
export interface TaxonomyIdsResult {
  categoryIds: number[];
  tagIds: number[];
}

// 转换函数
export const convertRequestToConfig = (
  request: WordPressPostRequest
): WordPressPostConfig => {
  const { username, password, ...baseConfig } = request;
  return {
    ...baseConfig,
    auth: { username, password },
  };
};