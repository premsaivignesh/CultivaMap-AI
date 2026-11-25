from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app.api.routes import router
from backend.app.services import data_service

@asynccontextmanager
async def lifespan(_app):
    data_service.load_sample()          # demo dataset ready on first launch
    yield


app = FastAPI(title="CultivaMap AI API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5180", "http://127.0.0.1:5180"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
app.include_router(router, prefix="/api")


DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():                       # `npm run build` -> served at http://127.0.0.1:8010
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
else:
    @app.get("/")
    def root():
        return {"message": "CultivaMap AI API is running", "docs": "/docs"}
