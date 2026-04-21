from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./llm_playground.db"
    UPLOADS_DIR: str = "./uploads"
    # Persistent locations for post-training artifacts (NOT /tmp which is
    # cleared on reboot).  Relative paths resolve from the backend working dir.
    ARTIFACTS_DIR: str = "./artifacts"
    ENCRYPTION_KEY: str = ""
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def sft_artifacts_dir(self) -> str:
        import os
        return os.path.join(self.ARTIFACTS_DIR, "post_training", "sft")

    @property
    def fusion_artifacts_dir(self) -> str:
        import os
        return os.path.join(self.ARTIFACTS_DIR, "post_training", "fusions")


settings = Settings()
