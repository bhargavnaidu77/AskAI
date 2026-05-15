import swaggerJSDoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'NVIDIA Chat Assistant API',
      version: '1.0.0',
      description:
        'Express + TypeScript API that proxies chat completions to NVIDIA NIM (OpenAI-compatible).',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
});
