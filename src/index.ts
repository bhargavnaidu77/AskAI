import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import askAIRouter from './routes/askAI';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', askAIRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/chat', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'chat.html')));

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/swagger.json', (_req, res) => res.json(swaggerSpec));

app.get('/', (_req, res) => res.redirect('/chat'));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger UI at  http://localhost:${PORT}/docs`);
});
