import OpenAI from 'openai';

const apiKey = process.env.NVIDIA_API_KEY;
const baseURL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

if (!apiKey) {
  // eslint-disable-next-line no-console
  console.warn('[warn] NVIDIA_API_KEY is not set. /api/askAI will fail until it is provided in .env');
}

export const openai = new OpenAI({
  apiKey: apiKey || 'missing-key',
  baseURL,
});

export const DEFAULT_MODEL =
  process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-pro';
