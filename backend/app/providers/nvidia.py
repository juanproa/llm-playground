from app.providers.openai_provider import OpenAIProvider


class NvidiaProvider(OpenAIProvider):
    DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        super().__init__(api_key=api_key, base_url=base_url or self.DEFAULT_BASE_URL)
