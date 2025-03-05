export class Logger {
    private context: string;
    private requestId?: string;
  
    constructor(context: string, requestId?: string) {
      this.context = context;
      this.requestId = requestId;
    }
  
    // 格式化日志信息为结构化JSON
    private formatLogMessage(level: string, message: string, data?: any): string {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        requestId: this.requestId,
        context: this.context,
        message,
        data
      };
      
      return JSON.stringify(logEntry);
    }
    
    info(message: string, data?: any): void {
      console.log(this.formatLogMessage('INFO', message, data));
    }
    
    error(message: string, data?: any): void {
      console.error(this.formatLogMessage('ERROR', message, data));
    }
    
    warn(message: string, data?: any): void {
      console.warn(this.formatLogMessage('WARN', message, data));
    }
  }
  
    // 创建默认日志实例
    export const createLogger = (context: string, event?: any): Logger => {
        const requestId = event?.requestContext?.requestId;        
        return new Logger(context, requestId);
    };