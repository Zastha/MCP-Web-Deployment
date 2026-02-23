import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { env } from './config/environment.js';
import chatRoutes from './routes/chatRoutes.js';
import errorHandler from './middlewares/errorHandler.js';
import { mcpService } from './services/mcpService.js';
import { logger } from './utils/logger.js';

const app = express();

app.use(cors());
app.use(express.json());

// Inicializar MCPs (y Docker si está disponible)
try {
  await mcpService.initialize();
} catch (error) {
  logger.error('Failed to initialize MCPs:', error);
  process.exit(1);
}

// Routes
app.use('/api/chat', chatRoutes);

// Error handler
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.success(`🚀 Server running on port ${env.PORT}`);
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  // Cerrar servidor HTTP
  server.close(async () => {
    logger.info('✅ HTTP server closed');
    
    // Limpiar MCPs y Docker
    await mcpService.cleanup();
    
    logger.success('✅ Shutdown complete');
    process.exit(0);
  });
  
  // Forzar cierre después de 10 segundos
  setTimeout(() => {
    logger.error('⚠️  Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  shutdown('EXCEPTION');
});