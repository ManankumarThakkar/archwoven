from fastapi import APIRouter

router = APIRouter()


@router.delete("/cache")
def clear_cache():
    return None
