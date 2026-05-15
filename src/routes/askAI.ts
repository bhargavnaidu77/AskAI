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

router.post('/askAI', async (req: Request, res: Response) => {
  const {
    message,
    messages,
    model = DEFAULT_MODEL,
    temperature = 0.2,
    top_p = 0.7,
    max_tokens = 1024,
    stream = false,
  } = req.body || {};

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
        max_tokens,
        stream: true,
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let reasoningOpen = false;
      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta as
          | { content?: string; reasoning_content?: string }
          | undefined;
        if (!delta) continue;
        if (delta.reasoning_content) {
          if (!reasoningOpen) {
            res.write('<think>');
            reasoningOpen = true;
          }
          res.write(delta.reasoning_content);
        }
        if (delta.content) {
          if (reasoningOpen) {
            res.write('</think>');
            reasoningOpen = false;
          }
          res.write(delta.content);
        }
      }
      if (reasoningOpen) res.write('</think>');
      return res.end();
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: message }],
      temperature,
      top_p,
      max_tokens,
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
