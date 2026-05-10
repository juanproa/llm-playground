import logging
from collections.abc import AsyncIterator

import openai

from app.providers.base import LLMResponse

logger = logging.getLogger(__name__)


def _delta_field(delta, *names: str) -> str:
    """Robustly fetch a delta field that may not be in the OpenAI SDK's
    typed schema. vLLM with --reasoning-parser emits reasoning under
    `reasoning_content` in some versions and `reasoning` in others; the
    OpenAI SDK silently drops both because they aren't on `ChoiceDelta`.
    We probe several locations and accept any of the supplied names.
    """
    for name in names:
        # 1. Typed attribute (works if SDK version recognizes the field)
        val = getattr(delta, name, None)
        if val:
            return val
        # 2. Pydantic v2 stores unknown fields in model_extra
        extra = getattr(delta, "model_extra", None) or {}
        val = extra.get(name)
        if val:
            return val
        # 3. Last-resort: dump to dict (handles older pydantic / SDK quirks)
        try:
            dumped = delta.model_dump(exclude_unset=False) if hasattr(delta, "model_dump") else None
        except Exception:
            dumped = None
        if dumped:
            val = dumped.get(name)
            if val:
                return val
    return ""


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
        chunk_count = 0
        yielded_anything = False
        async for chunk in stream:
            chunk_count += 1
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            # vLLM uses "reasoning_content" in some versions and "reasoning"
            # in others (e.g., QuantTrio's Qwen3.5-27B-AWQ build). Accept both.
            reasoning = _delta_field(delta, "reasoning_content", "reasoning")
            content = _delta_field(delta, "content")

            if reasoning:
                if not in_thinking:
                    yield "<think>"
                    in_thinking = True
                yield reasoning
                yielded_anything = True

            if content:
                if in_thinking:
                    yield "</think>"
                    in_thinking = False
                yield content
                yielded_anything = True

        if in_thinking:
            yield "</think>"
            yielded_anything = True

        if chunk_count > 0 and not yielded_anything:
            logger.warning(
                "OpenAI stream had %d chunks but yielded 0 — neither "
                "`content` nor `reasoning_content` was readable. SDK may be "
                "stripping unknown fields. Check `openai` package version.",
                chunk_count,
            )
