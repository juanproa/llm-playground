#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() {
  echo ""
  echo -e "${CYAN}Shutting down...${NC}"
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo -e "${GREEN}Done.${NC}"
}
trap cleanup EXIT INT TERM

# Backend
echo -e "${CYAN}Starting backend...${NC}"
cd "$ROOT_DIR/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -q -r requirements.txt
else
  source .venv/bin/activate
fi
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

# Frontend
echo -e "${CYAN}Starting frontend...${NC}"
cd "$ROOT_DIR/frontend"
if [ ! -d node_modules ]; then
  npm install --silent
fi
npm run dev -- --port 5173 &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}LLM Playground is running:${NC}"
echo -e "  Frontend → http://localhost:5173"
echo -e "  Backend  → http://localhost:8000"
echo -e "  API Docs → http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

wait
