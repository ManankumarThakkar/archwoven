from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_admin

router = APIRouter(prefix="/users")


@router.get("/me")
def read_me(user: CurrentUser):
    return user


@router.get("/", dependencies=[Depends(get_current_admin)])
def list_users():
    return []
