import Docker from 'dockerode';
import { logger } from '../utils/logger.js';

class DockerService {
  constructor() {
    this.docker = new Docker();
    this.containers = new Map();
  }

  async isDockerAvailable() {
    try {
      await this.docker.ping();
      return true;
    } catch (error) {
      logger.warn('Docker no está disponible:', error.message);
      return false;
    }
  }

  async pullImageIfNeeded(imageName) {
    try {
      logger.info(`Verificando imagen: ${imageName}`);
      
      // Verificar si la imagen existe
      const images = await this.docker.listImages();
      const imageExists = images.some(img => 
        img.RepoTags && img.RepoTags.some(tag => tag.includes(imageName.split(':')[0]))
      );

      if (!imageExists) {
        logger.info(`Descargando imagen: ${imageName}...`);
        
        return new Promise((resolve, reject) => {
          this.docker.pull(imageName, (err, stream) => {
            if (err) return reject(err);

            this.docker.modem.followProgress(stream, (err, output) => {
              if (err) return reject(err);
              logger.success(`✅ Imagen descargada: ${imageName}`);
              resolve(output);
            });
          });
        });
      } else {
        logger.info(`✅ Imagen ya existe: ${imageName}`);
      }
    } catch (error) {
      logger.error(`Error al verificar/descargar imagen ${imageName}:`, error);
      throw error;
    }
  }

  async isPortAvailable(port) {
  try {
    const containers = await this.docker.listContainers();
    
    for (const container of containers) {
      if (container.Ports) {
        for (const portInfo of container.Ports) {
          if (portInfo.PublicPort === parseInt(port)) {
            logger.warn(`⚠️  Puerto ${port} ya está en uso por contenedor ${container.Names[0]}`);
            return false;
          }
        }
      }
    }
    
    return true;
  } catch (error) {
    return true; // Si hay error, asumir que está disponible
  }
}


  async startContainer(config) {
    try {
      const { name, image, env = {}, volumes = [], ports = [] } = config;


      for (const portMapping of ports) {
      const [hostPort] = portMapping.split(':');
      const available = await this.isPortAvailable(hostPort);
      
      if (!available) {
        throw new Error(`Puerto ${hostPort} ya está en uso. Usa otro puerto o detén el contenedor que lo está usando.`);
      }
    }

      // Verificar si el contenedor ya existe
      const existingContainer = await this.findContainer(name);
      
      if (existingContainer) {
        const containerInfo = await existingContainer.inspect();
        
        if (containerInfo.State.Running) {
          logger.info(`✅ Contenedor ${name} ya está corriendo`);
          this.containers.set(name, existingContainer);
          return existingContainer;
        } else {
          // Iniciar contenedor existente
          await existingContainer.start();
          logger.success(`✅ Contenedor ${name} iniciado`);
          this.containers.set(name, existingContainer);
          return existingContainer;
        }
      }

      // Descargar imagen si es necesario
      await this.pullImageIfNeeded(image);

      // Crear y arrancar el contenedor
      logger.info(`Creando contenedor: ${name}`);

      const createOptions = {
        Image: image,
        name: name,
        Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: false,
        Tty: false,
        HostConfig: {
          AutoRemove: true,
        }
      };

      // Agregar volúmenes si existen
      if (volumes.length > 0) {
        createOptions.HostConfig.Binds = volumes;
      }

      // Agregar puertos si existen
      if (ports.length > 0) {
        createOptions.ExposedPorts = {};
        createOptions.HostConfig.PortBindings = {};
        
        ports.forEach(portMapping => {
          const [hostPort, containerPort] = portMapping.split(':');
          createOptions.ExposedPorts[`${containerPort}/tcp`] = {};
          createOptions.HostConfig.PortBindings[`${containerPort}/tcp`] = [
            { HostPort: hostPort }
          ];
        });
      }

      const container = await this.docker.createContainer(createOptions);
      await container.start();
      
      this.containers.set(name, container);
      logger.success(`✅ Contenedor ${name} creado e iniciado`);
      
      return container;
    } catch (error) {
      logger.error(`Error al iniciar contenedor ${config.name}:`, error);
      throw error;
    }
  }

  async findContainer(name) {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const containerInfo = containers.find(c => 
        c.Names.some(n => n === `/${name}` || n === name)
      );
      
      if (containerInfo) {
        return this.docker.getContainer(containerInfo.Id);
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async stopContainer(name) {
    try {
      const container = this.containers.get(name);
      
      if (container) {
        await container.stop();
        this.containers.delete(name);
        logger.info(`✅ Contenedor ${name} detenido`);
      }
    } catch (error) {
      logger.error(`Error al detener contenedor ${name}:`, error);
    }
  }

  async stopAllContainers() {
    logger.info('Deteniendo todos los contenedores...');
    
    const stopPromises = Array.from(this.containers.keys()).map(name => 
      this.stopContainer(name)
    );
    
    await Promise.all(stopPromises);
  }
}

export const dockerService = new DockerService();