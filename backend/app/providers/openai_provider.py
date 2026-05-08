from collections.abc import AsyncIterator

import openai

from app.providers.base import LLMResponse


class OpenAIProvider:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        kwargs = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self.client = openai.AsyncOpenAI(**kwargs)

    async def generate(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> LLMResponse:
        response = await self.client.chat.completions.create(
            model=model_id,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        choice = response.choices[0]
        return LLMResponse(
            content=choice.message.content or "",
            input_tokens=response.usage.prompt_tokens if response.usage else 0,
            output_tokens=response.usage.completion_tokens if response.usage else 0,
            model=response.model,
        )

    async def stream(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncIterator[str]:
        stream = await self.client.chat.completions.create(
            model=model_id,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )
        # When the upstream is vLLM with --reasoning-parser, reasoning tokens
        # arrive as `delta.reasoning_content` instead of `delta.content`. If
        # we ignore them, the stream goes silent during the (long) thinking
        # phase and intermediate proxies (Cloudflare, RunPod) close the
        # connection on idle timeout. Wrap reasoning chunks in <think>…</think>
        # so the connection keeps flowing data and `_strip_think` can clean
        # them up downstream.
        in_thinking = False
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            reasoning = getattr(delta, "reasoning_content", None) or ""
            content = delta.content or ""

            if reasoning:
                if not in_thinking:
                    yield "<think>"
                    in_thinking = True
                yield reasoning

            if content:
                if in_thinking:
                    yield "</think>"
                    in_thinking = False
                yield content

        if in_thinking:
            yield "</think>"
