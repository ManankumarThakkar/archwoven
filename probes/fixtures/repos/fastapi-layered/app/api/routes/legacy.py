from fastapi import APIRouter

# GAP CASE: never included by an application in the analyzed source
router = APIRouter(prefix="/legacy")


@router.get("/ping")
def ping():
    return "pong"
