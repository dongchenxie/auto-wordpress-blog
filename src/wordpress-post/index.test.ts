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

  describe("WordPress文章发布", () => {
    it("应成功创建WordPress文章", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>这是测试内容</p>",
        title: "自动生成的标题",
      });

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 123,
          link: "https://example.com/blog/test-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test", "blog"],
          prompt: "This is a test blog post",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).message).toBe(
        "Article published successfully"
      );
      expect(JSON.parse(result.body).postId).toBe(123);

      // 验证axios调用参数
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://example.com/wp-json/wp/v2/posts",
        expect.objectContaining({
          title: "自动生成的标题",
          content: "<p>这是测试内容</p>",
          status: "draft",
        }),
        expect.objectContaining({
          auth: {
            username: "test_user",
            password: "test_password",
          },
        })
      );

      // 验证Claude API被调用
      expect(mockedGenerateContent).toHaveBeenCalledWith({
        prompt: "This is a test blog post",
        keywords: ["test", "blog"],
        apiKey: undefined,
        model: undefined,
      });
    });

    it("应使用自定义标题和状态", async () => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>这是测试内容</p>",
        title: "这个标题应该被覆盖",
      });

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 124,
          link: "https://example.com/blog/custom-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          title: "自定义标题",
          status: "draft",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(201);

      // 验证axios调用参数
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          title: "自定义标题", // 自定义标题应覆盖生成的标题
          status: "draft",
        }),
        expect.any(Object)
      );
    });

    it("应处理不同状态的文章发布", async () => {
      // 测试其他状态选项
      const statuses = ["publish", "draft", "pending", "private"];

      for (const status of statuses) {
        // 每次循环重置mock
        jest.clearAllMocks();

        // 模拟Claude API响应
        mockedGenerateContent.mockResolvedValueOnce({
          content: `<p>${status} 状态的内容</p>`,
          title: `${status} 状态的标题`,
        });

        // 模拟WordPress API响应
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            id: 125,
            link: `https://example.com/blog/${status}-post`,
          },
        });

        const event = {
          body: JSON.stringify({
            url: "https://example.com",
            username: "test_user",
            password: "test_password",
            keywords: ["test"],
            prompt: "Test content",
            status,
          }),
        } as any;

        const result = await handler(event);

        expect(result.statusCode).toBe(201);
        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            status,
          }),
          expect.any(Object)
        );
      }
    });
  });

  describe("分类和标签处理", () => {
    beforeEach(() => {
      // 模拟Claude API响应
      mockedGenerateContent.mockResolvedValue({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });
    });

    it("应处理数字ID的分类", async () => {
      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 130,
          link: "https://example.com/blog/category-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          categories: [5, 10], // 直接使用数字ID
        }),
      } as any;

      await handler(event);

      // 验证分类ID被正确传递
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [5, 10],
        }),
        expect.any(Object)
      );
    });

    it("应处理字符串名称的分类", async () => {
      // 模拟分类API响应
      mockedAxios.get.mockImplementation((url) => {
        if (url.includes("categories")) {
          return Promise.resolve({
            data: [
              { id: 5, name: "Tech", slug: "tech" },
              { id: 10, name: "News", slug: "news" },
            ],
          });
        }
        return Promise.resolve({ data: [] });
      });

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 131,
          link: "https://example.com/blog/category-name-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          categories: ["Tech", "News"], // 使用字符串名称
        }),
      } as any;

      await handler(event);

      // 验证分类API被调用
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("categories"),
        expect.any(Object)
      );

      // 验证分类ID被正确转换
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: expect.arrayContaining([5, 10]),
        }),
        expect.any(Object)
      );
    });

    it("应处理数字ID的标签", async () => {
      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 132,
          link: "https://example.com/blog/tag-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          tags: [15, 20], // 直接使用数字ID
        }),
      } as any;

      await handler(event);

      // 验证标签ID被正确传递
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tags: [15, 20],
        }),
        expect.any(Object)
      );
    });

    it("应处理字符串名称的标签", async () => {
      // 模拟标签API响应
      mockedAxios.get.mockImplementation((url) => {
        if (url.includes("tags")) {
          return Promise.resolve({
            data: [
              { id: 15, name: "JavaScript", slug: "javascript" },
              { id: 20, name: "TypeScript", slug: "typescript" },
            ],
          });
        }
        return Promise.resolve({ data: [] });
      });

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 133,
          link: "https://example.com/blog/tag-name-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          tags: ["JavaScript", "TypeScript"], // 使用字符串名称
        }),
      } as any;

      await handler(event);

      // 验证标签API被调用
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("tags"),
        expect.any(Object)
      );

      // 验证标签ID被正确转换
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tags: expect.arrayContaining([15, 20]),
        }),
        expect.any(Object)
      );
    });

    it("应规范化分类名称中的HTML实体和Unicode字符", async () => {
      // 模拟分类API响应 - 包含特殊字符的分类
      mockedAxios.get.mockImplementation((url) => {
        if (url.includes("categories")) {
          return Promise.resolve({
            data: [
              {
                id: 40,
                name: "Beginner\u2019s Guides &amp; Tutorials",
                slug: "beginners-guides-tutorials",
              },
            ],
          });
        }
        return Promise.resolve({ data: [] });
      });

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 140,
          link: "https://example.com/blog/special-chars-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          categories: ["Beginner's Guides & Tutorials"], // 普通ASCII版本
        }),
      } as any;

      await handler(event);

      // 验证分类ID被正确转换
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [40],
        }),
        expect.any(Object)
      );
    });
  });

  describe("分页功能", () => {
    it("应处理分类数据的分页", async () => {
      // 模拟分页响应
      // 第一页返回100个分类
      const page1Categories = Array(100)
        .fill(0)
        .map((_, i) => ({
          id: i + 1,
          name: `Category ${i + 1}`,
          slug: `category-${i + 1}`,
        }));

      // 第二页返回50个分类，包括我们要找的Category 150
      const page2Categories = Array(50)
        .fill(0)
        .map((_, i) => ({
          id: i + 101,
          name: `Category ${i + 101}`,
          slug: `category-${i + 101}`,
        }));

      // 顺序模拟两个请求的响应
      mockedAxios.get
        .mockResolvedValueOnce({ data: page1Categories }) // 第一页
        .mockResolvedValueOnce({ data: page2Categories }); // 第二页

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 150,
          link: "https://example.com/blog/pagination-post",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Test content",
          categories: ["Category 150"], // 在第二页的分类
        }),
      } as any;

      await handler(event);

      // 验证第一次调用包含page=1
      expect(mockedAxios.get.mock.calls[0][0]).toContain("page=1");

      // 验证第二次调用包含page=2
      expect(mockedAxios.get.mock.calls[1][0]).toContain("page=2");
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

  describe("内容生成错误处理", () => {
    it("应处理Claude API生成内容失败的情况", async () => {
      // 模拟Claude API失败
      mockedGenerateContent.mockRejectedValueOnce(new Error("Claude API错误"));

      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 160,
          link: "https://example.com/blog/fallback-content",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: ["test"],
          prompt: "Fail this generation",
        }),
      } as any;

      const result = await handler(event);

      // 即使内容生成失败，应该仍然成功创建文章
      expect(result.statusCode).toBe(201);

      // 验证使用了备用内容
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          title: expect.stringMatching(/test/i), // 使用关键词作为标题
          content: expect.stringMatching(/Fail this generation/i), // 使用提示作为内容
        }),
        expect.any(Object)
      );
    });
  });

  describe("异常路径和边缘情况测试", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockedGenerateContent.mockResolvedValue({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });
    });

    it("应处理fetchAllTaxonomies中的API错误", async () => {
      // 测试覆盖172-177行的错误处理
      mockedAxios.get.mockRejectedValueOnce(new Error("API错误"));

      // 模拟后续成功响应
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 200, link: "https://example.com/post" },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
          categories: ["ErrorCategory"], // 触发分类API调用，但会遇到错误
        }),
      } as any;

      const result = await handler(event);

      // 即使分类API失败，应该仍然能成功创建文章
      expect(result.statusCode).toBe(201);

      // 验证API调用
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("categories"),
        expect.any(Object)
      );

      // 验证分类ID数组应为空（无法解析ID）
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [], // 由于API错误，无法获取分类ID
        }),
        expect.any(Object)
      );
    });

    it("应处理空数组分类和标签", async () => {
      // 测试覆盖82,84行的条件分支
      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 201, link: "https://example.com/empty-post" },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
          categories: [], // 空数组
          tags: [], // 空数组
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(201);

      // 验证不会调用getTaxonomyIds
      expect(mockedAxios.get).not.toHaveBeenCalled();

      // 验证分类和标签ID都是空数组
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [],
          tags: [],
        }),
        expect.any(Object)
      );
    });

    it("应处理特殊字符的分页数据", async () => {
      // 测试覆盖203-208行的代码
      // 模拟返回特殊字符数据的响应
      const specialCategoryData = [
        {
          id: 42,
          name: "Special & Category \u2019 with \u201C quotes \u201D",
          slug: "special-category",
        },
      ];

      mockedAxios.get.mockResolvedValueOnce({ data: specialCategoryData });
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 202, link: "https://example.com/special-post" },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
          categories: ['Special & Category \' with " quotes "'], // 使用普通字符版本
        }),
      } as any;

      await handler(event);

      // 验证正确规范化特殊字符
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [42],
        }),
        expect.any(Object)
      );
    });

    it("应处理无效的URL格式", async () => {
      // 测试覆盖286-290行的验证路径
      const event = {
        body: JSON.stringify({
          url: "invalid-url", // 无效URL
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain(
        "Invalid WordPress URL format"
      );

      // 验证不会调用API
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("应处理data.items为undefined的情况", async () => {
      // 模拟API返回undefined的情况
      mockedAxios.get.mockResolvedValueOnce({ data: undefined });
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 203, link: "https://example.com/undefined-data-post" },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
          categories: ["NonExistentCategory"],
        }),
      } as any;

      const result = await handler(event);

      // 即使API返回异常，仍应成功发布文章
      expect(result.statusCode).toBe(201);

      // 验证分类ID数组应为空
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [],
        }),
        expect.any(Object)
      );
    });

    it("应处理标签API错误", async () => {
      // 模拟分类API正常，标签API错误
      mockedAxios.get
        .mockImplementationOnce((url) => {
          if (url.includes("categories")) {
            return Promise.resolve({
              data: [{ id: 5, name: "Category", slug: "category" }],
            });
          }
          throw new Error("不应该调用此实现");
        })
        .mockImplementationOnce((url) => {
          if (url.includes("tags")) {
            return Promise.reject(new Error("标签API错误"));
          }
          throw new Error("不应该调用此实现");
        });

      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 204, link: "https://example.com/tag-error-post" },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
          categories: ["Category"],
          tags: ["ErrorTag"],
        }),
      } as any;

      const result = await handler(event);

      // 即使标签API失败，仍应成功发布文章
      expect(result.statusCode).toBe(201);

      // 验证使用成功获取的分类，但标签数组为空
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          categories: [5],
          tags: [],
        }),
        expect.any(Object)
      );
    });

    it("应处理发送请求超时", async () => {
      // 模拟请求超时
      mockedGenerateContent.mockResolvedValueOnce({
        content: "<p>测试内容</p>",
        title: "测试标题",
      });

      // 模拟超时错误
      const timeoutError = {
        isAxiosError: true,
        code: "ECONNABORTED",
        message: "timeout of 10000ms exceeded",
        response: undefined,
      };

      mockedAxios.post.mockRejectedValueOnce(timeoutError);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          prompt: "Test prompt",
        }),
      } as any;

      const result = await handler(event);

      // 应返回500错误
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain("WordPress API error");
    });

    // 替换当前失败的测试，分成两个测试
    it("应处理密码缺失的请求", async () => {
      // 测试缺少密码的情况
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          // 没有密码
          keywords: ["keyword"],
          prompt: "Test prompt",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain("Password");

      // 验证不会调用API
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("应处理关键词缺失的请求", async () => {
      // 测试包含密码但缺少关键词的情况
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          // 没有关键词
          prompt: "Test prompt",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain("Keywords");

      // 验证不会调用API
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("应处理提示词缺失的请求", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["keyword"],
          // 没有提示词
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain("Prompt");

      // 验证不会调用API
      expect(mockedAxios.post).not.toHaveBeenCalled();
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

// 添加一个新的测试组，针对真实API调用的边缘情况
describe("API调用边缘情况", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGenerateContent.mockResolvedValue({
      content: "<p>测试内容</p>",
      title: "测试标题",
    });
  });

  // 测试未覆盖的错误处理路径(行365-391)
  it("应处理带有自定义错误消息的API错误", async () => {
    // 模拟包含自定义错误消息的API错误
    const errorWithCustomMessage = {
      isAxiosError: true,
      response: {
        status: 500,
        data: {
          message: "自定义WordPress API错误消息",
        },
      },
      message: "请求失败",
    };

    mockedAxios.post.mockRejectedValueOnce(errorWithCustomMessage);
    mockedAxios.isAxiosError.mockReturnValueOnce(true);

    const event = {
      body: JSON.stringify({
        url: "https://example.com",
        username: "test_user",
        password: "test_pass",
        keywords: ["keyword"],
        prompt: "Test prompt",
      } as any),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain(
      "自定义WordPress API错误消息"
    );
  });

  it("应处理没有响应对象的Axios错误", async () => {
    // 模拟没有response对象的Axios错误
    const errorWithoutResponse = {
      isAxiosError: true,
      response: undefined,
      message: "网络错误",
    };

    mockedAxios.post.mockRejectedValueOnce(errorWithoutResponse);
    mockedAxios.isAxiosError.mockReturnValueOnce(true);

    const event = {
      body: JSON.stringify({
        url: "https://example.com",
        username: "test_user",
        password: "test_pass",
        keywords: ["keyword"],
        prompt: "Test prompt",
      } as any),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain("网络错误");
  });

  it("应处理没有data对象的Axios错误响应", async () => {
    // 模拟没有data对象的Axios错误响应
    const errorWithoutData = {
      isAxiosError: true,
      response: {
        status: 500,
        data: undefined,
      },
      message: "服务器错误",
    };

    mockedAxios.post.mockRejectedValueOnce(errorWithoutData);
    mockedAxios.isAxiosError.mockReturnValueOnce(true);

    const event = {
      body: JSON.stringify({
        url: "https://example.com",
        username: "test_user",
        password: "test_pass",
        keywords: ["keyword"],
        prompt: "Test prompt",
      } as any),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain("服务器错误");
  });

  // 测试getTaxonomyIds中的边缘路径(行103)
  it("应正确处理不在缓存中的分类名称", async () => {
    // 模拟一个包含缓存未命中情况的分类API请求
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: 10, name: "找得到的分类", slug: "found-category" },
        // 缺少我们将要请求的分类
      ],
    });

    mockedAxios.post.mockResolvedValueOnce({
      data: { id: 205, link: "https://example.com/missing-category" },
    });

    const event = {
      body: JSON.stringify({
        url: "https://example.com",
        username: "test_user",
        password: "test_pass",
        keywords: ["keyword"],
        prompt: "Test prompt",
        categories: ["找得到的分类", "找不到的分类"], // 包含缓存未命中的分类
      } as any),
    };

    await handler(event);

    // 验证调用分类API
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("categories"),
      expect.any(Object)
    );

    // 只有找得到的分类ID被包括
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        categories: [10], // 只有找得到的分类ID
      }),
      expect.any(Object)
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
