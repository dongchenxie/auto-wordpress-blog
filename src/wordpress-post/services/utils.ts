import { APIGatewayProxyResult } from "aws-lambda";
import { WordPressPostRequest } from "../models/interfaces";

/**
 * 工具函数模块
 * 包含请求验证、响应格式化等通用功能
 */

// 错误响应函数
export const createErrorResponse = (
  message: string,
  statusCode = 400
): APIGatewayProxyResult => {
  return formatResponse(statusCode, { error: message });
};

// 成功响应函数
export const createSuccessResponse = (
  data: any,
  statusCode = 200
): APIGatewayProxyResult => {
  return formatResponse(statusCode, data);
};

// 响应格式化函数
export const formatResponse = (
  statusCode: number,
  body: any
): APIGatewayProxyResult => {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
  };
};

// 验证请求字段
export const validateRequest = (request: WordPressPostRequest): string | null => {
  const { url, username, password, keywords, apiKey } = request;
  // 修改验证逻辑，检查trim后的值
  if (!url || url.trim() === "") return "WordPress URL(url) cannot be empty";
  if (!username || username.trim() === "")
    return "Username(username) cannot be empty";
  if (!password || password.trim() === "")
    return "Password(password) cannot be empty";
  if (!Array.isArray(keywords) || keywords.length === 0)
    return "Keywords(keywords) must be a non-empty array";

  // URL格式验证
  try {
    new URL(url);
  } catch (e) {
    return "Invalid WordPress URL format";
  }

  return null;
};