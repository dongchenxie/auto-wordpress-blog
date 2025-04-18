import {
  handler,
  formatResponse,
  normalizeTaxonomyName,
  validateRequest,
  getTaxonomyIds,
  fetchAllTaxonomies,
} from "./index";
import axios from "axios";
import { generateContent } from "../claude-service";

// 模拟axios和claude-service
jest.mock("axios");
jest.mock("../claude-service");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedGenerateContent = generateContent as jest.MockedFunction<
  typeof generateContent
>;

describe("WordPress发布Lambda函数", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认模拟Claude API返回结果
    mockedGenerateContent.mockResolvedValue({
      content: "<p>这是由Claude生成的测试内容</p>",
      title: "测试文章标题",
    });
    // 默认设置axios.isAxiosError为false
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  describe("请求验证", () => {
    it("当请求体为空时应返回错误", async () => {
      const event = { body: null } as any;
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Request body cannot be empty"
      );
    });

    it("当JSON格式无效时应返回错误", async () => {
      const event = { body: "invalid-json" } as any;
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Invalid request body JSON format"
      );
    });

    it("当请求体为空对象时应返回错误", async () => {
      const event = { body: JSON.stringify({}) } as any;
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Request body cannot be empty"
      );
    });

    it("当URL缺失时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          username: "user",
          password: "pass",
          keywords: ["test"],
        }),
      } as any;
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "WordPress URL(url) cannot be empty"
      );
    });

    it("当URL格式无效时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "invalid-url",
          username: "user",
          password: "pass",
          keywords: ["test"],
        }),
      } as any;
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Invalid WordPress URL format"
      );
    });
  });
});

// 添加一个新的测试组，用于测试内部工具函数
describe("内部工具函数测试", () => {
  // 测试响应格式化函数(行45-53)
  it("应正确格式化API响应", () => {
    const response = formatResponse(201, { test: "data" });
    expect(response).toEqual({
      statusCode: 201,
      body: JSON.stringify({ test: "data" }),
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
      },
    });
  });

  it("应正确处理空的分类名称", () => {
    expect(normalizeTaxonomyName("")).toBe("");
  });

  // 特别针对normalizeTaxonomyName函数的各种Unicode和HTML实体情况
  it("应正确规范化包含各种特殊字符的分类名称", () => {
    // 测试HTML实体
    expect(normalizeTaxonomyName("Cat &amp; Dog")).toBe("cat & dog");
    expect(normalizeTaxonomyName("This &lt; That")).toBe("this < that");
    expect(normalizeTaxonomyName("a &gt; b")).toBe("a > b");
    expect(normalizeTaxonomyName("&quot;quoted&quot;")).toBe('"quoted"');
    expect(normalizeTaxonomyName("O&#039;Connor")).toBe("o'connor");
    expect(normalizeTaxonomyName("dash&ndash;here")).toBe("dash-here");
    expect(normalizeTaxonomyName("long&mdash;dash")).toBe("long--dash");
    expect(normalizeTaxonomyName("ellipsis&hellip;etc")).toBe("ellipsis...etc");

    // 测试Unicode字符
    expect(normalizeTaxonomyName("smart'quotes")).toBe("smart'quotes");
    expect(normalizeTaxonomyName('smart"quotes')).toBe('smart"quotes');
    expect(normalizeTaxonomyName("ellipsis…etc")).toBe("ellipsis...etc");
    expect(normalizeTaxonomyName("en–dash")).toBe("en-dash");
    expect(normalizeTaxonomyName("em—dash")).toBe("em--dash");
    expect(normalizeTaxonomyName("non breaking space")).toBe(
      "non breaking space"
    );

    // 测试多个空格
    expect(normalizeTaxonomyName("  multiple    spaces  ")).toBe(
      "multiple spaces"
    );
  });
});

// 添加直接导出函数的测试
describe("直接导出函数测试", () => {
  // 模拟axios.get实现，用于测试fetchAllTaxonomies函数
  const mockAxiosGet = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get = mockAxiosGet;
  });

  // 测试fetchAllTaxonomies函数的非常规类型参数(覆盖潜在的类型转换问题)
  it("应处理items项中非标准数据类型", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: [
        { id: 1, name: "正常分类" },
        { id: 2, name: null }, // name为null
        { id: null, name: "ID为null" }, // id为null
        { slug: "no-id-or-name" }, // 没有id和name
        { id: 3, name: "有slug", slug: "with-slug" }, // 完整项
      ],
    });

    // 创建一个测试缓存对象
    const testCache: Record<string, number> = {};

    await fetchAllTaxonomies(
      "https://example.com",
      { username: "test", password: "test" },
      "categories",
      testCache
    );

    // 验证处理了正常数据
    expect(testCache["正常分类"]).toBe(1);
    // 验证忽略了异常数据
    expect(testCache["null"]).toBeUndefined();
    expect(testCache["id为null"]).toBeUndefined();
    // 验证处理了slug
    expect(testCache["有slug"]).toBe(3);
    expect(testCache["with-slug"]).toBe(3);
  });
});
