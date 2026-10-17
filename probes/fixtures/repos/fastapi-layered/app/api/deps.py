from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session

from app.core.db import engine
from app.models import User
from app.services.billing import BillingService


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]


def get_current_user(session: SessionDep) -> User:
    return session.get(User, 1)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_admin(user: CurrentUser) -> User:
    return user


def get_billing():
    client = BillingService()
    try:
        yield client
    finally:
        client.close()
