import { Router, Request, Response } from 'express';
import { openai, DEFAULT_MODEL } from '../openaiClient';

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     AskAIRequest:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           description: Single user message (shortcut for a one-turn chat).
 *           example: can you generate basic express app server
 *         messages:
 *           type: array
 *           description: Full conversation history. Takes precedence over "message".
 *           items:
 *             type: object
 *             required: [role, content]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [system, user, assistant]
 *               content:
 *                 type: string
 *         model:
 *           type: string
 *           description: Override the default model
 *           example: google/gemma-2-2b-it
 *         temperature:
 *           type: number
 *           example: 0.2
 *         top_p:
 *           type: number
 *           example: 0.7
 *         max_tokens:
 *           type: integer
 *           example: 1024
 *         stream:
 *           type: boolean
 *           description: When true, response is streamed as text/plain chunks
 *           example: false
 *     AskAIResponse:
 *       type: object
 *       properties:
 *         model:
 *           type: string
 *         reply:
 *           type: string
 *
 * /api/askAI:
 *   post:
 *     summary: Ask the AI assistant a question
 *     description: Sends a single user message to the NVIDIA-hosted model and returns the assistant reply.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AskAIRequest'
 *     responses:
 *       200:
 *         description: Assistant reply
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AskAIResponse'
 *           text/plain:
 *             schema:
 *               type: string
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Upstream model error
 */
type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

const MODEL_MAX_TOKENS: Record<string, number> = {
  'google/gemma-2-2b-it': 4096,
  'google/gemma-3n-e4b-it': 4096,
  'openai/gpt-oss-20b': 16384,
  'openai/gpt-oss-120b': 16384,
};
const DEFAULT_MAX_TOKENS = 4096;

router.post('/askAI', async (req: Request, res: Response) => {
  const {
    message,
    messages,
    model = DEFAULT_MODEL,
    temperature = 0.2,
    top_p = 0.7,
    max_tokens,
    stop,
    stream = false,
  } = req.body || {};

  const resolvedMaxTokens =
    typeof max_tokens === 'number' && max_tokens > 0
      ? Math.min(max_tokens, MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS)
      : MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS;

  const stopList = Array.isArray(stop)
    ? stop.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0).slice(0, 4)
    : typeof stop === 'string' && stop.length > 0
    ? [stop]
    : undefined;

  let chat: ChatMsg[] = [];
  if (Array.isArray(messages) && messages.length > 0) {
    chat = messages
      .filter(
        (m: unknown): m is ChatMsg =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as ChatMsg).content === 'string' &&
          ['system', 'user', 'assistant'].includes((m as ChatMsg).role),
      )
      .map((m) => ({ role: m.role, content: m.content }));
  } else if (typeof message === 'string' && message.trim()) {
    chat = [{ role: 'user', content: message }];
  }

  if (chat.length === 0) {
    return res
      .status(400)
      .json({ error: 'Provide "message" (string) or "messages" (array of {role,content}).' });
  }

  try {
    if (stream) {
      const completion = await openai.chat.completions.create({
        model,
        messages: chat,
        temperature,
        top_p,
        max_tokens: resolvedMaxTokens,
        ...(stopList && stopList.length ? { stop: stopList } : {}),
        stream: true,
      });

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      // Open the stream immediately so proxies don't hold it
      res.write(': open\n\n');

      const send = (text: string) => {
        res.write(`data: ${JSON.stringify({ t: text })}\n\n`);
      };

      let reasoningOpen = false;
      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta as
          | { content?: string; reasoning_content?: string }
          | undefined;
        if (!delta) continue;
        if (delta.reasoning_content) {
          if (!reasoningOpen) {
            send('<think>');
            reasoningOpen = true;
          }
          send(delta.reasoning_content);
        }
        if (delta.content) {
          if (reasoningOpen) {
            send('</think>');
            reasoningOpen = false;
          }
          send(delta.content);
        }
      }
      if (reasoningOpen) send('</think>');
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: chat,
      temperature,
      top_p,
      max_tokens: resolvedMaxTokens,
      ...(stopList && stopList.length ? { stop: stopList } : {}),
      stream: false,
    });

    const reply = completion.choices[0]?.message?.content ?? '';
    return res.json({ model, reply });
  } catch (err: unknown) {
    const messageText = err instanceof Error ? err.message : 'Unknown error';
    if (res.headersSent) {
      try { res.end(`\n\n[stream error] ${messageText}`); } catch { /* ignore */ }
      return;
    }
    return res.status(500).json({ error: 'Model request failed', detail: messageText });
  }
});

export default router;
