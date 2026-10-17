from fastapi import FastAPI

from app.api.main import api_router
from app.api.routes import admin
from app.core.config import settings

app = FastAPI(title="layered")

app.include_router(api_router, prefix=settings.API_PREFIX)

# GAP CASE: a settings prefix without a declared default cannot be resolved statically
app.include_router(admin.router, prefix=settings.ADMIN_PREFIX)


@app.get("/healthz")
def healthz():
    return {"ok": True}
