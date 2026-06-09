import dotenv from 'dotenv';
dotenv.config();

export const mcpConfig = {
  servers: [
    {
      name: 'filesystem',
      type: 'stdio',
      command: 'npx',
      args: [
        '-y', 
        '@modelcontextprotocol/server-filesystem', 
        'C:/Users/Sarah/OneDrive/Documents/ProyectoServicio/backend',
        'C:/Users/Sarah/MCP/Work',
        'C:/Users/Sarah/MCP/Projects'
      ]
    },
    
    {
      name: 'pdf-reader',
      type: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@sylphlab/pdf-reader-mcp'
      ]
    },

    {
      name: 'pdf-vision',
      type: 'docker',
      docker: {
        image: 'pdf-vision-mcp:latest',
        env: {}
      },
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        'pdf-vision-mcp:latest'
      ]
    },
    
    {
      name: 'puppeteer',
      type: 'docker',
      docker: {
        image: 'mcp/puppeteer',
        env: {
          DOCKER_CONTAINER: 'true'
        }
      },
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        '--init',
        '-e',
        'DOCKER_CONTAINER=true',
        'mcp/puppeteer'
      ]
    },
    
    {
      name: 'mistral-ocr',
      type: 'docker',
      docker: {
        image: 'mcp-mistral-ocr:latest',
        ports: ['8403:8000'],
        volumes: ['C:/Users/Sarah/MCP/OCR_Files:/data/ocr'],
        env: {
          MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
          OCR_DIR: '/data/ocr'
        }
      },
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        '-p',
        '8403:8000',
        '-e',
        `MISTRAL_API_KEY=${process.env.MISTRAL_API_KEY}`,
        '-e',
        'OCR_DIR=/data/ocr',
        '-v',
        'C:/Users/Sarah/MCP/OCR_Files:/data/ocr',
        'mcp-mistral-ocr:latest'
      ]
    },
    
    {
      name: 'mongodb',
      type: 'docker',
      docker: {
        image: 'mongodb/mongodb-mcp-server:1.6.0-2026-02-21',
        env: {
          MDB_MCP_READ_ONLY: 'false',
          MDB_MCP_DISABLED_TOOLS: 'atlas-local-connect-deployment,atlas-local-create-deployment,atlas-local-delete-deployment,atlas-local-list-deployments',
          MDB_MCP_API_CLIENT_ID: process.env.MONGODB_CLIENT_ID,
          MDB_MCP_API_CLIENT_SECRET: process.env.MONGODB_CLIENT_SECRET
        }
      },
      command: 'docker',
      args: [
        'run',
        '--rm',
        '-i',
        '-e',
        'MDB_MCP_READ_ONLY=false',
        '-e',
        'MDB_MCP_DISABLED_TOOLS=atlas-local-connect-deployment,atlas-local-create-deployment,atlas-local-delete-deployment,atlas-local-list-deployments',
        '-e',
        `MDB_MCP_API_CLIENT_ID=${process.env.MONGODB_CLIENT_ID}`,
        '-e',
        `MDB_MCP_API_CLIENT_SECRET=${process.env.MONGODB_CLIENT_SECRET}`,
        'mongodb/mongodb-mcp-server:1.6.0-2026-02-21'
      ]
    },
    
    {
      name: 'csv-editor',
      type: 'docker',
      docker: {
        image: 'csv-editor-mcp',
        env: {}
      },
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        'csv-editor-mcp'
      ]
    }
  ]
};