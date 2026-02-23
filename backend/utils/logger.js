const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function getTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, data) {
  const timestamp = getTimestamp();
  let formattedMessage = `[${timestamp}] [${level}] ${message}`;
  
  if (data) {
    formattedMessage += '\n' + JSON.stringify(data, null, 2);
  }
  
  return formattedMessage;
}

export const logger = {
  info: (message, data = null) => {
    const formatted = formatMessage('INFO', message, data);
    console.log(`${colors.blue}${formatted}${colors.reset}`);
  },

  error: (message, data = null) => {
    const formatted = formatMessage('ERROR', message, data);
    console.error(`${colors.red}${formatted}${colors.reset}`);
  },

  warn: (message, data = null) => {
    const formatted = formatMessage('WARN', message, data);
    console.warn(`${colors.yellow}${formatted}${colors.reset}`);
  },

  success: (message, data = null) => {
    const formatted = formatMessage('SUCCESS', message, data);
    console.log(`${colors.green}${formatted}${colors.reset}`);
  },

  debug: (message, data = null) => {
    if (process.env.NODE_ENV === 'development') {
      const formatted = formatMessage('DEBUG', message, data);
      console.log(`${colors.cyan}${formatted}${colors.reset}`);
    }
  },
};

export default logger;