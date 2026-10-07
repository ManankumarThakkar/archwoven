from fastapi import FastAPI

from routers.orders import router as orders_router
from settings import settings

app = FastAPI(title="shop")

app.include_router(orders_router, prefix="/orders")

# GAP CASE: computed prefix cannot be resolved statically
app.include_router(orders_router, prefix=settings.ROUTER_PREFIX)


@app.get("/health")
def health():
    return {"ok": True}
