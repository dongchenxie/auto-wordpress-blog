import { handler } from "./index";
import axios from "axios";

// Mock axios module
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("WordPress发布Lambda函数", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认设置axios.isAxiosError为false，在需要的测试中再覆盖
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
      const event = {
        body: "{非法JSON}",
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Invalid request body JSON format"
      );
    });

    it("当URL缺失时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          // url缺失
          username: "test_user",
          password: "test_pass",
          keywords: ["test"],
          prompt: "Test content",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "WordPress URL(url) cannot be empty"
      );
    });

    it("当缺少必填字段username时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          // username缺失
          password: "test_pass",
          keywords: ["test"],
          prompt: "Test content",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Username(username) cannot be empty"
      );
    });

    it("当缺少必填字段password时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          // password缺失
          keywords: ["test"],
          prompt: "Test content",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Password(password) cannot be empty"
      );
    });

    it("当URL格式无效时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "invalid-url",
          username: "test_user",
          password: "test_pass",
          keywords: ["test"],
          prompt: "Test content",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        "Invalid WordPress URL format"
      );
    });

    it("当关键词为空数组时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: [],
          prompt: "Test content",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain(
        "Keywords(keywords) must be a non-empty array"
      );
    });

    it("当关键词不是数组时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: "这不是数组",
          prompt: "Test content",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain(
        "Keywords(keywords) must be a non-empty array"
      );
    });

    it("当内容提示为空时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["test"],
          prompt: "",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain(
        "Content prompt(prompt) cannot be empty"
      );
    });

    it("当内容提示只有空白字符时应返回错误", async () => {
      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_pass",
          keywords: ["test"],
          prompt: "   ",
        }),
      } as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain(
        "Content prompt(prompt) cannot be empty"
      );
    });
  });

  describe("WordPress文章发布", () => {
    it("应成功创建WordPress文章", async () => {
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
          title: expect.any(String),
          content: expect.any(String),
          status: "draft",
        }),
        expect.objectContaining({
          auth: {
            username: "test_user",
            password: "test_password",
          },
        })
      );
    });

    it("应使用自定义标题和状态", async () => {
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
          title: "自定义标题",
          status: "draft",
        }),
        expect.any(Object)
      );
    });

    it("应处理不同状态的文章发布", async () => {
      // 测试其他状态选项
      const statuses = ["publish", "draft", "pending", "private"];

      for (const status of statuses) {
        mockedAxios.post.mockClear();
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

    it("应处理有特殊字符的标签", async () => {
      // 模拟WordPress API响应
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 126,
          link: "https://example.com/blog/special-tags",
        },
      });

      const event = {
        body: JSON.stringify({
          url: "https://example.com",
          username: "test_user",
          password: "test_password",
          keywords: [" test1 ", "", "test2", "  "],
          prompt: "Test with special tags",
        }),
      } as any;

      await handler(event);
    });
  });

  describe("错误处理", () => {
    it("应处理401认证失败错误", async () => {
      // 模拟API错误响应
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
      // 模拟API错误响应
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
      // 模拟API错误响应
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

    it("应处理一般API错误且错误消息来自response.data", async () => {
      // 模拟API错误响应
      const errorResponse = {
        response: {
          status: 500,
          data: {
            message: "服务器错误",
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

    it("应处理一般API错误且错误消息来自axiosError.message", async () => {
      // 模拟API错误响应，但没有data.message
      const errorResponse = {
        response: {
          status: 500,
          data: {},
        },
        message: "请求失败",
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
      // 模拟一般JavaScript错误
      mockedAxios.post.mockRejectedValueOnce(new Error("未知错误"));
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
      expect(JSON.parse(result.body).error).toBe("Internal server error");
    });
  });
});
