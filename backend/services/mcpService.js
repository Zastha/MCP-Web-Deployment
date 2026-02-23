import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpConfig } from '../config/mcpConfig.js';
import { dockerService } from './dockerService.js';
import { whitelistService } from './whitelistService.js';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

class MCPService {
  constructor() {
    this.clients = new Map();
    this.tools = [];
    this.initialized = false;
    this.dockerAvailable = false;
  }

  async initialize() {
    if (this.initialized) {
      logger.info('MCPs already initialized');
      return;
    }

    logger.info('🔄 Initializing MCP connections...');

    // Verificar si Docker está disponible
    this.dockerAvailable = await dockerService.isDockerAvailable();
    
    if (this.dockerAvailable) {
      logger.success('✅ Docker disponible');
    } else {
      logger.warn('⚠️  Docker no disponible - MCPs con Docker serán omitidos');
    }

    for (const config of mcpConfig.servers) {
      try {
        // Si es un MCP de Docker y Docker no está disponible, saltar
        if (config.type === 'docker' && !this.dockerAvailable) {
          logger.warn(`⏭️  Saltando ${config.name} (requiere Docker)`);
          continue;
        }

        await this.connectMCP(config);
      } catch (error) {
        logger.error(`❌ Failed to connect ${config.name}:`, error.message);
      }
    }

    this.initialized = true;
    logger.success(`✅ ${this.clients.size} MCPs initialized`);
  }

  async connectMCP(config) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
    });

    const client = new Client({
      name: config.name,
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    const { tools } = await client.listTools();
    
    this.clients.set(config.name, client);
    
    this.tools.push(...tools.map(tool => ({
      ...tool,
      mcpSource: config.name
    })));
    
    logger.success(`  ✓ ${config.name}: ${tools.length} tools`);
  }

  getAvailableTools() {
    return this.tools;
  }

  normalizeJsonSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return {
        type: 'object',
        properties: {},
      };
    }

    const cloned = JSON.parse(JSON.stringify(schema));

    const normalizeNode = (node) => {
      if (!node || typeof node !== 'object') {
        return node;
      }

      if (Array.isArray(node)) {
        return node.map(normalizeNode);
      }

      const result = { ...node };

      if (Object.prototype.hasOwnProperty.call(result, 'id') && !result.$id) {
        result.$id = result.id;
        delete result.id;
      }

      if (result.definitions && !result.$defs) {
        result.$defs = result.definitions;
        delete result.definitions;
      }

      if (result.nullable === true) {
        if (typeof result.type === 'string') {
          result.type = [result.type, 'null'];
        } else if (Array.isArray(result.type) && !result.type.includes('null')) {
          result.type = [...result.type, 'null'];
        }
        delete result.nullable;
      }

      if (Array.isArray(result.items)) {
        result.prefixItems = result.items.map(normalizeNode);
        delete result.items;
      }

      if (typeof result.exclusiveMinimum === 'boolean') {
        if (result.exclusiveMinimum === false) {
          delete result.exclusiveMinimum;
        } else if (typeof result.minimum === 'number') {
          result.exclusiveMinimum = result.minimum;
          delete result.minimum;
        }
      }

      if (typeof result.exclusiveMaximum === 'boolean') {
        if (result.exclusiveMaximum === false) {
          delete result.exclusiveMaximum;
        } else if (typeof result.maximum === 'number') {
          result.exclusiveMaximum = result.maximum;
          delete result.maximum;
        }
      }

      if (result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
        const normalizedProperties = {};
        for (const [key, value] of Object.entries(result.properties)) {
          normalizedProperties[key] = normalizeNode(value);
        }
        result.properties = normalizedProperties;
      }

      if (result.items && typeof result.items === 'object') {
        result.items = normalizeNode(result.items);
      }

      if (result.additionalProperties && typeof result.additionalProperties === 'object') {
        result.additionalProperties = normalizeNode(result.additionalProperties);
      }

      if (result.$defs && typeof result.$defs === 'object') {
        const normalizedDefs = {};
        for (const [key, value] of Object.entries(result.$defs)) {
          normalizedDefs[key] = normalizeNode(value);
        }
        result.$defs = normalizedDefs;
      }

      for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(result[keyword])) {
          result[keyword] = result[keyword].map(normalizeNode);
        }
      }

      if (result.not && typeof result.not === 'object') {
        result.not = normalizeNode(result.not);
      }

      return result;
    };

    const normalized = normalizeNode(cloned);

    if (typeof normalized.type !== 'string' && !Array.isArray(normalized.type)) {
      normalized.type = 'object';
    }

    if (normalized.type === 'object' && (typeof normalized.properties !== 'object' || Array.isArray(normalized.properties))) {
      normalized.properties = {};
    }

    if (normalized.required && !Array.isArray(normalized.required)) {
      normalized.required = [];
    }

    return normalized;
  }

  getToolsForClaude() {
    return this.tools
      .filter((tool) => typeof tool?.name === 'string' && tool.name.trim().length > 0)
      .map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: this.normalizeJsonSchema(tool.inputSchema),
      }));
  }

  getToolsGroupedByMCP() {
    const groups = {};
    
    this.tools.forEach(tool => {
      const mcpName = tool.mcpSource || 'unknown';
      
      if (!groups[mcpName]) {
        groups[mcpName] = {
          mcpName: mcpName,
          tools: []
        };
      }
      
      groups[mcpName].tools.push(tool);
    });
    
    return groups;
  }

  async enforceWhitelistForToolCall(tool, args) {
    if (!env.WHITELIST_ENFORCEMENT_ENABLED) {
      return;
    }

    if (tool?.mcpSource === 'mongodb') {
      return;
    }

    const validation = await whitelistService.validateUrlsAgainstWhitelist(
      JSON.stringify(args ?? {})
    );

    if (!validation.ok) {
      throw new Error(
        `Whitelist Enforcement: tool "${tool.name}" bloqueado por dominios no permitidos (${validation.blockedHostnames.join(', ')}).`
      );
    }
  }

  async callTool(toolName, args) {
    const tool = this.tools.find(t => t.name === toolName);
    
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    const client = this.clients.get(tool.mcpSource);
    
    if (!client) {
      throw new Error(`MCP ${tool.mcpSource} not connected`);
    }

    await this.enforceWhitelistForToolCall(tool, args);

    const result = await client.callTool({
      name: toolName,
      arguments: args
    });

    return result;
  }

  async cleanup() {
    logger.info('🔄 Closing MCP connections...');
    
    for (const [name, client] of this.clients) {
      try {
        await client.close();
        logger.info(`  ✓ ${name} closed`);
      } catch (error) {
        logger.error(`  ❌ Error closing ${name}:`, error.message);
      }
    }
    
    // Detener contenedores de Docker
    if (this.dockerAvailable) {
      await dockerService.stopAllContainers();
    }
    
    this.clients.clear();
    this.tools = [];
    this.initialized = false;
  }
}

export const mcpService = new MCPService();