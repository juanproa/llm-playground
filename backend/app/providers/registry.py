from app.providers.anthropic import AnthropicProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.google import GoogleProvider
from app.providers.nvidia import NvidiaProvider
from app.providers.ollama import OllamaProvider
from app.providers.mlx_local import MlxLocalProvider
from app.providers.base import LLMProvider

_PROVIDERS: dict[str, type] = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "google": GoogleProvider,
    "nvidia": NvidiaProvider,
    "ollama": OllamaProvider,
    "mlx_local": MlxLocalProvider,
}


def get_provider(provider_name: str, api_key: str | None = None, base_url: str | None = None) -> LLMProvider:
    cls = _PROVIDERS.get(provider_name)
    if not cls:
        raise ValueError(f"Unknown provider: {provider_name}. Available: {list(_PROVIDERS.keys())}")
    return cls(api_key=api_key, base_url=base_url)
