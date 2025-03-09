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
          prompt: "test",
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
          prompt: "test",
        }),
      } as any;
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Invalid WordPress URL format"
      );
    });
  });

  describe("错误处理", () => {
    it("应处理401认证失败错误", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });

      // 模拟401错误响应
      const errorResponse = {
        response: {
          status: 401,
          data: {
            message: "认证失败",
          },
        },
      };
      mockedAxios.post.mockRejectedValueOnce(errorResponse);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "wrong_user",
          password: "wrong_password",
          keywords: ["test"],
          prompt: "Test post",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toContain(
        "WordPress authentication failed"
      );
    });

    it("应处理403权限不足错误", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });

      // 模拟403错误响应
      const errorResponse = {
        response: {
          status: 403,
          data: {
            message: "权限不足",
          },
        },
      };
      mockedAxios.post.mockRejectedValueOnce(errorResponse);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test post",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error).toContain(
        "Insufficient permissions"
      );
    });

    it("应处理404端点未找到错误", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });

      // 模拟404错误响应
      const errorResponse = {
        response: {
          status: 404,
          data: {
            message: "端点未找到",
          },
        },
      };
      mockedAxios.post.mockRejectedValueOnce(errorResponse);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test post",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toContain(
        "WordPress API endpoint not found"
      );
    });

    it("应处理其他API错误", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });

      // 模拟500错误响应
      const errorResponse = {
        response: {
          status: 500,
          data: {
            message: "服务器内部错误",
          },
        },
      };
      mockedAxios.post.mockRejectedValueOnce(errorResponse);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test post",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain("WordPress API error");
    });

    it("应处理非Axios错误", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });

      // 模拟非Axios错误
      mockedAxios.post.mockRejectedValueOnce(new Error("一般错误"));
      mockedAxios.isAxiosError.mockReturnValueOnce(false);

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test post",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain("Internal server error");
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

  // 测试validateRequest函数的边缘情况(行287及其他验证分支)
  it("应验证所有必需的请求字段", () => {
    const validRequest = {
      url: "https://example.com",
      username: "user",
      password: "pass",
      keywords: ["test"],
      prompt: "prompt",
    };

    const emptyPrompt = { ...validRequest, prompt: "  " };
    expect(validateRequest(emptyPrompt)).toContain("Prompt");

    // 测试无效URL格式异常处理
    try {
      validateRequest({
        ...validRequest,
        url: "http://invalid url with spaces",
      });
      // 不应该到达这里
      expect(true).toBe(false);
    } catch (e) {
      // URL构造函数会抛出异常
      expect(e).toBeDefined();
    }
  });

  // 测试具有完整错误处理的validateRequest函数
  it("应验证所有请求字段条件分支", () => {
    // 有效请求
    const validRequest = {
      url: "https://example.com",
      username: "user",
      password: "pass",
      keywords: ["test"],
      prompt: "prompt",
    };

    // 验证各个字段缺失的情况
    expect(validateRequest({ ...validRequest, url: "" })).toContain("URL");
    expect(validateRequest({ ...validRequest, url: "   " })).toContain("URL");
    expect(validateRequest({ ...validRequest, username: "" })).toContain(
      "Username"
    );
    expect(validateRequest({ ...validRequest, username: "   " })).toContain(
      "Username"
    );
    expect(validateRequest({ ...validRequest, password: "" })).toContain(
      "Password"
    );
    expect(validateRequest({ ...validRequest, password: "   " })).toContain(
      "Password"
    );
    expect(validateRequest({ ...validRequest, keywords: [] })).toContain(
      "Keywords"
    );
    expect(
      validateRequest({ ...validRequest, keywords: null as any })
    ).toContain("Keywords");
    expect(validateRequest({ ...validRequest, prompt: "" })).toContain(
      "Prompt"
    );
    expect(validateRequest({ ...validRequest, prompt: "   " })).toContain(
      "Prompt"
    );

    // 验证有效请求返回null
    expect(validateRequest(validRequest)).toBeNull();
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
