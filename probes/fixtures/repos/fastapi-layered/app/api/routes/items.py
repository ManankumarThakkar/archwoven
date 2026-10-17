from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, get_billing
from app.services.audit import AuditService
from app.services.billing import BillingService

router = APIRouter(prefix="/items", tags=["items"])


@router.get("/")
def list_items(session: SessionDep):
    return []


@router.api_route("/{item_id}", methods=["GET", "HEAD"])
def read_item(item_id: int, session: SessionDep):
    return {}


@router.post(path="/", status_code=201)
def create_item(audit: Annotated[AuditService, Depends()], billing: BillingService = Depends(get_billing)):
    return billing.charge()
