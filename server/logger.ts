/**
 * Simple logging utility with levels and timestamps
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: Record<string, unknown>;
}

class Logger {
    private name: string;
    private minLevel: LogLevel;
    private levelPriority: Record<LogLevel, number> = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
    };

    constructor(name: string, minLevel: LogLevel = 'INFO') {
        this.name = name;
        this.minLevel = minLevel;
    }

    private shouldLog(level: LogLevel): boolean {
        return this.levelPriority[level] >= this.levelPriority[this.minLevel];
    }

    private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';
        return `[${timestamp}] [${level}] [${this.name}] ${message}${contextStr}`;
    }

    private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
        if (!this.shouldLog(level)) return;

        const formatted = this.formatMessage(level, message, context);

        switch (level) {
            case 'ERROR':
                console.error(formatted);
                break;
            case 'WARN':
                console.warn(formatted);
                break;
            case 'DEBUG':
                console.debug(formatted);
                break;
            default:
                console.log(formatted);
        }
    }

    debug(message: string, context?: Record<string, unknown>): void {
        this.log('DEBUG', message, context);
    }

    info(message: string, context?: Record<string, unknown>): void {
        this.log('INFO', message, context);
    }

    warn(message: string, context?: Record<string, unknown>): void {
        this.log('WARN', message, context);
    }

    error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
        const errorContext: Record<string, unknown> = { ...context };

        if (error instanceof Error) {
            errorContext.error = {
                name: error.name,
                message: error.message,
                stack: error.stack?.split('\n').slice(0, 3).join('\n'),
            };
        } else if (error) {
            errorContext.error = String(error);
        }

        this.log('ERROR', message, errorContext);
    }
}

// Create module-specific loggers
export const createLogger = (name: string, minLevel?: LogLevel): Logger => {
    return new Logger(name, minLevel);
};

// Pre-configured loggers for common use
export const apiLogger = createLogger('API');
export const dbLogger = createLogger('DB');
export const serverLogger = createLogger('Server');

export { Logger };
