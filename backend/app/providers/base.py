from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class LLMResponse:
    content: str
    input_tokens: int
    output_tokens: int
    model: str
    latency_ms: int = 0


@runtime_checkable
class LLMProvider(Protocol):
    async def generate(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> LLMResponse: ...

    async def stream(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncIterator[str]: ...
