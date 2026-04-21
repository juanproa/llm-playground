import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import LLMResponse

DEFAULT_OLLAMA_URL = "http://localhost:11434"


async def list_ollama_models(base_url: str | None = None) -> list[dict]:
    """Fetch available models from Ollama."""
    url = (base_url or DEFAULT_OLLAMA_URL).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            return resp.json().get("models", [])
    except Exception:
        return []


class OllamaProvider:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.base_url = (base_url or DEFAULT_OLLAMA_URL).rstrip("/")

    def _build_options(self, max_tokens: int, temperature: float, **kwargs) -> dict:
        num_ctx = kwargs.pop("num_ctx", None)
        if not num_ctx:
            # Auto-size context: input needs room + output needs max_tokens
            # Default to 32k which most modern models support
            num_ctx = 32768
        return {
            "num_predict": max_tokens,
            "num_ctx": num_ctx,
            "temperature": temperature,
            **kwargs,
        }

    async def generate(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> LLMResponse:
        options = self._build_options(max_tokens, temperature, **kwargs)
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": model_id,
                    "messages": messages,
                    "stream": False,
                    "options": options,
                },
            )
            response.raise_for_status()
            data = response.json()

        return LLMResponse(
            content=data["message"]["content"],
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            model=model_id,
        )

    async def stream(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncIterator[str]:
        options = self._build_options(max_tokens, temperature, **kwargs)
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={
                    "model": model_id,
                    "messages": messages,
                    "stream": True,
                    "options": options,
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.strip():
                        data = json.loads(line)
                        if "message" in data and data["message"].get("content"):
                            yield data["message"]["content"]
